import { config } from "dotenv";
import { workerDatabaseUrl } from "./helpers/worker-db.js";

// Must run before any module that imports env.ts.
// This ensures DATABASE_URL and other required vars are set before env.ts
// calls process.exit(1) on parse failure.
config({ path: ".env.test" });

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Create apps/api/.env.test with a test database URL.\n' +
    'Example: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kata_test'
  );
}

// A vitest worker uses its own clone of the migrated test database (see global-setup.ts), so test
// files can run in parallel. The main process (global setup) keeps the template's URL.
const poolId = process.env.VITEST_POOL_ID;
if (poolId) process.env.DATABASE_URL = workerDatabaseUrl(process.env.DATABASE_URL, poolId);
