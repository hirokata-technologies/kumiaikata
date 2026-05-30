import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("[kata/db] DATABASE_URL is not set");

export const pool = new Pool({ connectionString, max: 3 });
export const db = drizzle(pool, { schema });
