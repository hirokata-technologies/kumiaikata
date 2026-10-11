// Standalone migration entry point: applies pending drizzle migrations to
// DATABASE_URL and exits. Plain ESM on purpose — it ships in the runtime image
// next to the `drizzle/` folder and runs with no build step:
//
//   node migrate.js
//
// Idempotent: drizzle tracks applied migrations in its own migrations table.
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.error("[migrate] DATABASE_URL is not set");
	process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = process.env.MIGRATIONS_FOLDER ?? path.join(here, "drizzle");

// DATABASE_URL may use a Cloud SQL unix socket (`?host=/cloudsql/<connection-name>`).
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

try {
	await migrate(drizzle(pool), { migrationsFolder });
	console.log(`[migrate] migrations up to date (${migrationsFolder})`);
} catch (err) {
	console.error("[migrate] failed:", err);
	process.exitCode = 1;
} finally {
	await pool.end();
}
