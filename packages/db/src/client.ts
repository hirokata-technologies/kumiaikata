import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("[kata/db] DATABASE_URL is not set");

// DATABASE_URL may point at a Cloud SQL unix socket, e.g.
//   postgresql://user:pass@localhost/db?host=/cloudsql/<project>:<region>:<instance>
// node-postgres reads the `host` query parameter, so no special handling is needed.
export const pool = new Pool({
  connectionString,
  // One Cloud Run instance serves the whole app; keep the pool well under the
  // Cloud SQL connection limit while leaving headroom for concurrent requests.
  max: Number(process.env.DB_POOL_MAX ?? 10),
  // Fail fast when the database is unreachable so /healthz can return 503
  // instead of hanging until the platform healthcheck window closes.
  connectionTimeoutMillis: 3000,
});
export const db = drizzle(pool, { schema });
