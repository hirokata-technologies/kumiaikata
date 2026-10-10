import "./instrument.js";
import * as Sentry from "@sentry/node";
import { serve } from "@hono/node-server";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";
import { fileURLToPath } from "url";
import { app } from "./app.js";
import { markReady } from "./readiness.js";
import { env } from "./env.js";
import { db, pool } from "@kata/db";
import { cleanStaleTempFiles } from "./storage/disk.js";
import { storage, DiskStorage } from "./storage/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
	// Bind the port first so /healthz can answer while migrations run; a slow
	// first-deploy migration must not consume Railway's healthcheck window.
	serve({ fetch: app.fetch, port: env.PORT }, (info) => {
		console.log(`kata/api listening on http://localhost:${info.port.toString()}`);
	});

	// Run pending migrations. Idempotent — drizzle tracks applied migrations
	// in its own __drizzle_migrations table.
	const migrationsFolder = path.resolve(__dirname, "../drizzle");
	await migrate(db, { migrationsFolder });
	console.log("[db] migrations up to date");
	markReady();

	// Smoke-test the pool so a misconfigured DATABASE_URL fails fast at startup.
	await pool.query("select 1");
	console.log("[db] connected");

	if (storage instanceof DiskStorage) {
		void cleanStaleTempFiles(env.ATTACHMENTS_DIR, 60 * 60 * 1000);
	}
}

main().catch((err) => {
	Sentry.captureException(err);
	console.error("[server] startup failed:", err);
	void Sentry.flush(2000).finally(() => process.exit(1));
});

async function shutdown(signal: string): Promise<void> {
	console.log(`[server] received ${signal}, shutting down…`);
	try {
		await pool.end();
	} catch (err) {
		Sentry.captureException(err);
		console.error("[server] error during shutdown:", err);
	}
	await Sentry.flush(2000);
	process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
