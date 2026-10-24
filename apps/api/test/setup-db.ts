import { afterEach, afterAll, inject } from "vitest";
import { pool } from "../src/db/client.js";
import { resetDatabase } from "./helpers/db.js";

// Migrations and the initial clean-up happen once, in global-setup.ts.
const dbReady = inject("dbReady");

// Every test starts from an empty database because the one before it emptied it.
afterEach(async () => {
	if (dbReady) await resetDatabase();
});

afterAll(async () => {
	if (dbReady) await pool.end();
});
