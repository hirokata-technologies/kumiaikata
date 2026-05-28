import { beforeAll, afterEach, afterAll } from "vitest";
import { execSync } from "child_process";
import { pool } from "../src/db/client.js";
import { createTestDbIfMissing, truncateAll } from "./helpers/db.js";

let dbReady = false;

beforeAll(async () => {
	try {
		await createTestDbIfMissing();
		// Run migrations against kata_test
		execSync("pnpm drizzle-kit migrate", {
			env: { ...process.env },
			stdio: "inherit",
		});
		dbReady = true;
	} catch {
		console.warn("\n⚠️  PostgreSQL unavailable — DB-dependent tests will fail; pure unit tests will still run.\n");
	}
}, 60_000);

afterEach(async () => {
	if (dbReady) await truncateAll();
});

afterAll(async () => {
	if (dbReady) await pool.end();
});
