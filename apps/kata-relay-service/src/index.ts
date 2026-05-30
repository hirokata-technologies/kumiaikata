import "./instrument.js";
import * as Sentry from "@sentry/node";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { errorHandler } from "@kata/http";
import { emailWorker } from "@kata/queues/workers";
import sseRouter from "./routes/sse.js";
import { env } from "./env.js";

const app = new Hono();

app.use("*", cors({ origin: env.ALLOWED_ORIGINS, credentials: true }));
app.route("/api/boards", sseRouter);
app.get("/healthz", (c) => c.json({ ok: true }));
app.onError(errorHandler);

emailWorker.on("failed", (_job, err) => {
	Sentry.captureException(err);
	console.error("[worker] email job failed:", err instanceof Error ? err.message : String(err));
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
	console.log(`kata/relay-service listening on http://localhost:${info.port.toString()}`);
});

async function shutdown(signal: string): Promise<void> {
	console.log(`[relay] received ${signal}, shutting down…`);
	try {
		await emailWorker.close();
	} catch (err) {
		Sentry.captureException(err);
		console.error("[relay] error during shutdown:", err);
	}
	await Sentry.flush(2000);
	process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
