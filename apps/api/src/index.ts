import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { env } from "./env.js";
import { connectDB, disconnect } from "./db/connection.js";
import { ensureIndexes } from "./db/indexes.js";
import { cleanStaleTempFiles } from "./storage/disk.js";
import { storage, DiskStorage } from "./storage/index.js";

async function main(): Promise<void> {
	await connectDB();
	await ensureIndexes();

	if (storage instanceof DiskStorage) {
		void cleanStaleTempFiles(env.ATTACHMENTS_DIR, 60 * 60 * 1000);
	}

	serve({ fetch: app.fetch, port: env.PORT }, (info) => {
		console.log(`kata/api listening on http://localhost:${info.port.toString()}`);
	});
}

main().catch((err) => {
	console.error("[server] startup failed:", err);
	process.exit(1);
});

async function shutdown(signal: string): Promise<void> {
	console.log(`[server] received ${signal}, shutting down…`);
	try {
		await disconnect();
	} catch (err) {
		console.error("[server] error during shutdown:", err);
	}
	process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
