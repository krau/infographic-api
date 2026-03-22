import { renderToString } from "@antv/infographic/ssr";
import { serve } from "@hono/node-server";
import { Resvg } from "@resvg/resvg-js";
import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => {
	return c.json({
		message: "Infographic API Server",
		endpoints: {
			"POST /render": "Render infographic syntax to image",
		},
	});
});

app.post("/render", async (c) => {
	try {
		const body = await c.req.json();
		const { syntax, width = 800, height = 600, format = "png", dpr = 2 } = body;

		if (!syntax) {
			return c.json({ error: "Missing required field: syntax" }, 400);
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
		const svgString = await renderToString(syntax, {
			width,
			height,
		});

		// If SVG format requested, return directly
		if (format === "svg") {
			return c.body(svgString, 200, {
				"Content-Type": "image/svg+xml",
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

		// Return image using Response with proper typing
		return new Response(pngBuffer as unknown as BodyInit, {
			status: 200,
			headers: {
				"Content-Type": "image/png",
			},
		});
	} catch (error) {
		console.error("Render error:", error);
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
	return c.json({ status: "ok" });
});

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

serve(
	{
		fetch: app.fetch,
		port,
	},
	(info) => {
		console.log(`Server is running on http://localhost:${info.port}`);
	},
);
