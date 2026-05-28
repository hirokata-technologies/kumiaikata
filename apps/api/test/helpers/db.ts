import { Pool } from "pg";

export { pool } from "../../src/db/client.js";

/**
 * Create the kata_test database if it does not already exist.
 * Connects to the default "postgres" admin database using the same
 * host/port/credentials as DATABASE_URL.
 */
export async function createTestDbIfMissing(): Promise<void> {
	const dataUrl = process.env["DATABASE_URL"] ?? "";
	// Parse the URL to extract connection info, then replace the database name
	// with the default "postgres" admin database.
	const adminUrl = dataUrl.replace(/\/[^/?]+(\?|$)/, "/postgres$1");

	const adminPool = new Pool({ connectionString: adminUrl });
	try {
		await adminPool.query("CREATE DATABASE kata_test");
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

/**
 * Truncate all application and auth tables in dependency order.
 * RESTART IDENTITY resets sequences; CASCADE handles any remaining FKs.
 */
export async function truncateAll(): Promise<void> {
	const { pool } = await import("../../src/db/client.js");
	await pool.query(`
		TRUNCATE TABLE
			attachments,
			cards,
			labels,
			columns,
			team_members,
			boards,
			teams,
			sessions,
			accounts,
			verifications,
			users
		RESTART IDENTITY CASCADE
	`);
}
