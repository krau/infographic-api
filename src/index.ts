import { renderToString } from "@antv/infographic/ssr";
import { serve } from "@hono/node-server";
import { Resvg } from "@resvg/resvg-js";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

const app = new Hono();

// Configuration from environment variables
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || "0.0.0.0";
const AUTH_TOKEN = process.env.AUTH_TOKEN;

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

		// Convert SVG to PNG using resvg
		const resvg = new Resvg(svgString, {
			fitTo: {
				mode: "width",
				value: width * dpr,
			},
		});

		const pngData = resvg.render();
		const pngBuffer = pngData.asPng();

		const duration = Date.now() - startTime;
		console.log(
			`[${new Date().toISOString()}] Rendered PNG in ${duration}ms (${width * dpr}x${resvg.height}, DPR: ${dpr})`,
		);

		// Return image using Response with proper typing
		return new Response(pngBuffer as unknown as BodyInit, {
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
	// Handle HTTPException (e.g., from bearerAuth) - return its response directly
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
