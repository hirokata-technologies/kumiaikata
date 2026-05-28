import { config } from "dotenv";

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
