import "./setup-env.js";
import { execSync } from "child_process";
import { Pool } from "pg";
import type { TestProject } from "vitest/node";
import { createTestDbIfMissing, resetDatabaseOn } from "./helpers/db.js";

declare module "vitest" {
	export interface ProvidedContext {
		/** False when PostgreSQL was unreachable: DB-dependent tests will fail, pure unit tests still run. */
		dbReady: boolean;
	}
}

/**
 * Runs once per `vitest run`, before any test file: creates kata_test if needed, applies the
 * migrations (so the tests only ever see the latest schema), and empties the database in case an
 * interrupted run left rows behind. Each test file then resets the data after every test.
 */
export default async function setup(project: TestProject): Promise<void> {
	let ready = false;
	try {
		await createTestDbIfMissing();
		execSync("pnpm drizzle-kit migrate", { env: { ...process.env }, stdio: "inherit" });
		const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });
		try {
			await resetDatabaseOn(pool);
		} finally {
			await pool.end();
		}
		ready = true;
	} catch {
		console.warn("\n⚠️  PostgreSQL unavailable — DB-dependent tests will fail; pure unit tests will still run.\n");
	}
	project.provide("dbReady", ready);
}
