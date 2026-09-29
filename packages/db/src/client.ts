import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("[kata/db] DATABASE_URL is not set");

export const pool = new Pool({ connectionString, max: 3,
  // Fail fast when the database is unreachable so /healthz can return 503
  // instead of hanging until the platform healthcheck window closes.
  connectionTimeoutMillis: 3000,
});
export const db = drizzle(pool, { schema });
