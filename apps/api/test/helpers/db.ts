import { Pool } from "pg";
import { databaseNameOf, quoteIdent, withDatabase } from "./worker-db.js";

export { pool } from "../../src/db/client.js";

/**
 * Create the test database named by DATABASE_URL if it does not already exist.
 * Connects to the default "postgres" admin database using the same
 * host/port/credentials as DATABASE_URL.
 */
export async function createTestDbIfMissing(): Promise<void> {
	const dataUrl = process.env["DATABASE_URL"] ?? "";
	const adminPool = new Pool({ connectionString: withDatabase(dataUrl, "postgres") });
	try {
		await adminPool.query(`CREATE DATABASE ${quoteIdent(databaseNameOf(dataUrl))}`);
	} catch (err: unknown) {
		// Ignore "database already exists" error (code 42P04)
		if (
			err instanceof Error &&
			"code" in err &&
			(err as NodeJS.ErrnoException).code !== "42P04"
		) {
			throw err;
		}
	} finally {
		await adminPool.end();
	}
}

/** What the reset needs from a connection pool: `pg.Pool` and the app's pool both fit. */
type ResetPool = Pick<Pool, "query" | "connect">;

/**
 * The statement that empties every table, built once per process from the catalog so a new
 * migration's tables are reset without anyone remembering to list them.
 *
 * It runs as DELETEs under `session_replication_role = replica`, which skips triggers and
 * foreign-key checks: table order does not matter and the guild's delete-event triggers do
 * not write new rows into the tables just emptied. (Needs a superuser, as the test role is.)
 * Identity sequences are not restarted, so tests must not assert absolute ids.
 */
let resetScript: Promise<string> | undefined;

function buildResetScript(pool: ResetPool): Promise<string> {
	resetScript ??= pool
		.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")
		.then(({ rows }) => {
			const deletes = rows.map(({ tablename }) => `DELETE FROM "${tablename.replaceAll('"', '""')}";`).join("\n");
			return `BEGIN;\nSET LOCAL session_replication_role = replica;\n${deletes}\nCOMMIT;`;
		});
	return resetScript;
}

/** Empty every table of `pool`'s database. One round trip: DELETE costs ~7ms, TRUNCATE ~50ms. */
export async function resetDatabaseOn(pool: ResetPool): Promise<void> {
	const script = await buildResetScript(pool);
	const client = await pool.connect();
	try {
		await client.query(script);
	} catch (err) {
		await client.query("ROLLBACK").catch(() => undefined);
		throw err;
	} finally {
		client.release();
	}
}

/** Empty every table of the app's database. `setup-db.ts` runs it after each test. */
export async function resetDatabase(): Promise<void> {
	const { pool } = await import("../../src/db/client.js");
	await resetDatabaseOn(pool);
}
