import { renderToString } from "@antv/infographic/ssr";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import {
	type Browser,
	type BrowserContext,
	chromium,
	type Page,
} from "playwright";

const app = new Hono();

// Configuration from environment variables
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || "0.0.0.0";
const AUTH_TOKEN = process.env.AUTH_TOKEN;

// Initialize Playwright browser
let browser: Browser | null = null;
let context: BrowserContext | null = null;
const PAGE_POOL_SIZE = process.env.PAGE_POOL_SIZE
	? Math.max(1, parseInt(process.env.PAGE_POOL_SIZE, 10))
	: 2;

type PageSlot = {
	page: Page;
	inUse: boolean;
};

const pagePool: PageSlot[] = [];
const pageWaiters: Array<() => void> = [];

async function getBrowser(): Promise<Browser> {
	if (!browser) {
		browser = await chromium.launch({
			headless: true,
			args: [
				"--no-sandbox",
				"--disable-setuid-sandbox",
				"--disable-dev-shm-usage",
				"--disable-accelerated-2d-canvas",
				"--no-first-run",
				"--no-zygote",
				"--disable-gpu",
			],
		});
		context = await browser.newContext();
		for (let i = 0; i < PAGE_POOL_SIZE; i += 1) {
			const page = await context.newPage();
			pagePool.push({ page, inUse: false });
		}
		console.log(`Playwright page pool initialized: ${PAGE_POOL_SIZE}`);
	}
	return browser;
}

async function acquirePageSlot(): Promise<PageSlot> {
	for (const slot of pagePool) {
		if (!slot.inUse) {
			slot.inUse = true;
			return slot;
		}
	}

	await new Promise<void>((resolve) => {
		pageWaiters.push(resolve);
	});

	return acquirePageSlot();
}

function releasePageSlot(slot: PageSlot): void {
	slot.inUse = false;
	const waiter = pageWaiters.shift();
	if (waiter) waiter();
}

// Render SVG to PNG using Playwright with @antv/infographic exportToPNGString
async function renderSVGToPNG(
	svgString: string,
	width: number,
	height: number,
	dpr = 2,
): Promise<Buffer> {
	await getBrowser();
	const slot = await acquirePageSlot();
	const page = slot.page;

	try {
		await page.goto("about:blank");
		await page.setViewportSize({ width, height });

		// Create HTML with embedded SVG and font styles
		const html = `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="UTF-8">
				<style>
					* { margin: 0; padding: 0; box-sizing: border-box; }
					body {
						width: ${width}px;
						height: ${height}px;
						background: white;
						font-family: "WenQuanYi Micro Hei", "Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", "Source Han Sans SC", sans-serif;
					}
					svg {
						display: block;
						width: 100%;
						height: 100%;
					}
				</style>
			</head>
			<body>
				${svgString}
			</body>
			</html>
		`;

		await page.setContent(html, { waitUntil: "domcontentloaded" });
		await page
			.evaluate(async () => {
				if (document.fonts?.ready) {
					await document.fonts.ready;
				}
			})
			.catch(() => undefined);

		// Use Canvas API in browser context to convert SVG to PNG
		const pngBase64 = await page.evaluate(
			async ({ dpr, targetWidth, targetHeight }) => {
				const svgElement = document.querySelector("svg") as SVGSVGElement;
				if (!svgElement) {
					throw new Error("SVG element not found");
				}

				const exportWidth = Number(targetWidth) || 800;
				const exportHeight = Number(targetHeight) || 600;

				// Create canvas
				const canvas = document.createElement("canvas");
				canvas.width = exportWidth * dpr;
				canvas.height = exportHeight * dpr;
				const ctx = canvas.getContext("2d");
				if (!ctx) {
					throw new Error("Failed to get canvas context");
				}

				// Apply DPR scaling
				ctx.scale(dpr, dpr);
				ctx.fillStyle = "white";
				ctx.fillRect(0, 0, exportWidth, exportHeight);

				// Force exported SVG size to requested dimensions
				svgElement.setAttribute("width", String(exportWidth));
				svgElement.setAttribute("height", String(exportHeight));
				svgElement.style.width = `${exportWidth}px`;
				svgElement.style.height = `${exportHeight}px`;

				// Convert SVG to data URL (base64 to avoid CORS issues with external fonts)
				const svgData = new XMLSerializer().serializeToString(svgElement);
				const base64Svg = btoa(unescape(encodeURIComponent(svgData)));
				const dataUrl = `data:image/svg+xml;base64,${base64Svg}`;

				// Load SVG as image and draw to canvas
				const img = new Image();
				img.crossOrigin = "anonymous";
				await new Promise((resolve, reject) => {
					img.onload = resolve;
					img.onerror = reject;
					img.src = dataUrl;
				});

				ctx.drawImage(img, 0, 0, exportWidth, exportHeight);

				// Export as PNG
				return canvas
					.toDataURL("image/png")
					.replace(/^data:image\/png;base64,/, "");
			},
			{ dpr, targetWidth: width, targetHeight: height },
		);

		return Buffer.from(pngBase64, "base64");
	} finally {
		releasePageSlot(slot);
	}
}

// Middleware: CORS
app.use(cors());

// Middleware: Request logging
app.use(
	logger((message: string) => {
		const timestamp = new Date().toISOString();
		console.log(`[${timestamp}] ${message}`);
	}),
);

// Middleware: Bearer token authentication (if AUTH_TOKEN is set)
if (AUTH_TOKEN) {
	console.log("Bearer token authentication enabled");
	app.use(
		"/render",
		bearerAuth({
			token: AUTH_TOKEN,
			noAuthenticationHeaderMessage: "Authentication required",
			invalidAuthenticationHeaderMessage: "Invalid token",
		}),
	);
}

app.get("/", (c) => {
	return c.json({
		message: "Infographic API Server",
		version: "1.0.0",
		endpoints: {
			"POST /render":
				"Render infographic syntax to image (requires Bearer token if set)",
			"GET /health": "Health check",
		},
		authentication: AUTH_TOKEN ? "Enabled" : "Disabled",
	});
});

app.post("/render", async (c) => {
	const startTime = Date.now();

	try {
		const body = await c.req.json();
		const { data, width = 800, height = 600, format = "png", dpr = 2 } = body;

		if (!data) {
			return c.json({ error: "Missing required field: data" }, 400);
		}

		// Validate format
		const validFormats = ["png", "svg"];
		if (!validFormats.includes(format)) {
			return c.json(
				{ error: `Invalid format. Must be one of: ${validFormats.join(", ")}` },
				400,
			);
		}

		// Render to SVG string
		const svgString = await renderToString(data, {
			width,
			height,
		});
		const sanitizedSvgString = svgString.replace(
			/<\?xml-stylesheet[^>]*\?>\s*/g,
			"",
		);

		// If SVG format requested, return directly
		if (format === "svg") {
			const duration = Date.now() - startTime;
			console.log(
				`[${new Date().toISOString()}] Rendered SVG in ${duration}ms (${width}x${height})`,
			);

			return c.body(sanitizedSvgString, 200, {
				"Content-Type": "image/svg+xml",
				"X-Render-Time": `${duration}ms`,
			});
		}

		// Render to PNG using Playwright with @antv/infographic exportToPNGString
		const pngBuffer = await renderSVGToPNG(
			sanitizedSvgString,
			width,
			height,
			dpr,
		);

		const duration = Date.now() - startTime;
		console.log(
			`[${new Date().toISOString()}] Rendered PNG in ${duration}ms (${width}x${height}, DPR: ${dpr})`,
		);

		return new Response(new Uint8Array(pngBuffer), {
			status: 200,
			headers: {
				"Content-Type": "image/png",
				"X-Render-Time": `${duration}ms`,
			},
		});
	} catch (error) {
		const duration = Date.now() - startTime;
		console.error(
			`[${new Date().toISOString()}] Render error after ${duration}ms:`,
			error,
		);

		return c.json(
			{
				error: "Failed to render infographic",
				message: error instanceof Error ? error.message : "Unknown error",
			},
			500,
		);
	}
});

// Health check endpoint
app.get("/health", (c) => {
	return c.json({
		status: "ok",
		timestamp: new Date().toISOString(),
	});
});

// 404 handler
app.notFound((c) => {
	return c.json({ error: "Not found" }, 404);
});

// Error handler
app.onError((err, c) => {
	if (err instanceof HTTPException) {
		return err.getResponse();
	}

	console.error(`[${new Date().toISOString()}] Unhandled error:`, err);
	return c.json(
		{
			error: "Internal server error",
			message: err.message,
		},
		500,
	);
});

// Cleanup browser on exit
process.on("SIGINT", async () => {
	for (const slot of pagePool) {
		await slot.page.close().catch(() => undefined);
	}
	if (browser) {
		await browser.close();
	}
	process.exit(0);
});

process.on("SIGTERM", async () => {
	for (const slot of pagePool) {
		await slot.page.close().catch(() => undefined);
	}
	if (browser) {
		await browser.close();
	}
	process.exit(0);
});

// Initialize browser and start server
getBrowser()
	.then(() => {
		serve(
			{
				fetch: app.fetch,
				port: PORT,
				hostname: HOST,
			},
			(info) => {
				console.log(`Server is running on http://${HOST}:${info.port}`);
				console.log(`Authentication: ${AUTH_TOKEN ? "Enabled" : "Disabled"}`);
				if (AUTH_TOKEN) {
					console.log(
						`Add Authorization: Bearer <token> header to /render requests`,
					);
				}
			},
		);
	})
	.catch((err) => {
		console.error("Failed to initialize browser:", err);
		process.exit(1);
	});
