import "./setup-env.js";
import { execSync } from "child_process";
import { Pool } from "pg";
import type { TestProject } from "vitest/node";
import { createTestDbIfMissing, resetDatabaseOn } from "./helpers/db.js";
import {
	databaseNameOf,
	quoteIdent,
	templateDatabaseName,
	withDatabase,
	workerDatabaseName,
} from "./helpers/worker-db.js";

declare module "vitest" {
	export interface ProvidedContext {
		/** False when PostgreSQL was unreachable: DB-dependent tests will fail, pure unit tests still run. */
		dbReady: boolean;
	}
}

/**
 * Runs once per `vitest run`, before any test file. It creates the test database if needed,
 * applies the migrations (so the tests only ever see the latest schema), empties it, and clones it
 * once per worker (`<name>_w1` … `<name>_wN`) so test files can run in parallel, each worker on its
 * own copy. Cloning a template takes tens of milliseconds, so migrations still run only once.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
	const url = process.env["DATABASE_URL"] ?? "";
	// The reset below deletes every row and the clones are dropped and recreated: refuse to point
	// that at anything that is not plainly a test database.
	if (!/test/i.test(databaseNameOf(url))) {
		throw new Error(`Refusing to run tests against "${databaseNameOf(url)}": the database name must contain "test".`);
	}

	const template = templateDatabaseName(url);
	const workers = Math.max(1, Number(project.config.maxWorkers) || 1);
	const admin = new Pool({ connectionString: withDatabase(url, "postgres") });
	const clones = Array.from({ length: workers }, (_, i) => workerDatabaseName(url, i + 1));

	let ready = false;
	try {
		await createTestDbIfMissing();
		execSync("pnpm drizzle-kit migrate", { env: { ...process.env }, stdio: "inherit" });

		const pool = new Pool({ connectionString: withDatabase(url, template) });
		try {
			await resetDatabaseOn(pool);
		} finally {
			await pool.end();
		}

		// One at a time: CREATE DATABASE refuses a template that another session is copying.
		for (const clone of clones) {
			await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(clone)} WITH (FORCE)`);
			await admin.query(`CREATE DATABASE ${quoteIdent(clone)} TEMPLATE ${quoteIdent(template)}`);
		}
		ready = true;
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		console.warn(`\n⚠️  PostgreSQL unavailable (${reason}) — DB-dependent tests will fail; pure unit tests will still run.\n`);
	}
	project.provide("dbReady", ready);

	return async () => {
		try {
			for (const clone of clones) await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(clone)} WITH (FORCE)`);
		} catch {
			// Best effort: the next run drops and recreates them anyway.
		} finally {
			await admin.end().catch(() => undefined);
		}
	};
}
