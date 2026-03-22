import { renderToString } from "@antv/infographic/ssr";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import puppeteer from "puppeteer";

const app = new Hono();

// Configuration from environment variables
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || "0.0.0.0";
const AUTH_TOKEN = process.env.AUTH_TOKEN;

// Initialize Puppeteer browser
let browser: puppeteer.Browser | null = null;

async function getBrowser(): Promise<puppeteer.Browser> {
	if (!browser) {
		browser = await puppeteer.launch({
			headless: true,
			args: [
				"--no-sandbox",
				"--disable-setuid-sandbox",
				"--disable-dev-shm-usage",
				"--disable-accelerated-2d-canvas",
				"--no-first-run",
				"--no-zygote",
				"--disable-gpu",
				"--disable-crashpad",
				"--disable-breakpad",
				"--disable-features=Crashpad",
				"--disable-blink-features=Crashpad",
				"--disable-background-networking",
				"--disable-default-apps",
				"--disable-sync",
				"--disable-translate",
				"--hide-scrollbars",
				"--metrics-recording-only",
				"--mute-audio",
				"--no-default-browser-check",
				"--safebrowsing-disable-auto-update",
			],
		});
	}
	return browser;
}

// Render SVG to PNG using Puppeteer
async function renderSVGToPNG(
	svgString: string,
	width: number,
	height: number,
): Promise<Buffer> {
	const page = await (await getBrowser()).newPage();

	try {
		await page.setViewport({ width, height, deviceScaleFactor: 1 });

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
						font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
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

		await page.setContent(html, { waitUntil: "networkidle0" });

		// Wait for fonts to load
		await new Promise((resolve) => setTimeout(resolve, 500));

		// Take screenshot
		const screenshot = await page.screenshot({
			type: "png",
			omitBackground: false,
			encoding: "binary",
		});

		return Buffer.from(screenshot);
	} finally {
		await page.close();
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
		const { data, width = 800, height = 600, format = "png" } = body;

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

		// If SVG format requested, return directly
		if (format === "svg") {
			const duration = Date.now() - startTime;
			console.log(
				`[${new Date().toISOString()}] Rendered SVG in ${duration}ms (${width}x${height})`,
			);

			return c.body(svgString, 200, {
				"Content-Type": "image/svg+xml",
				"X-Render-Time": `${duration}ms`,
			});
		}

		// Render to PNG using Puppeteer
		const pngBuffer = await renderSVGToPNG(svgString, width, height);

		const duration = Date.now() - startTime;
		console.log(
			`[${new Date().toISOString()}] Rendered PNG in ${duration}ms (${width}x${height})`,
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
	if (browser) {
		await browser.close();
	}
	process.exit(0);
});

process.on("SIGTERM", async () => {
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
