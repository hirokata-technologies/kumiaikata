// One shared pool for the whole process. Better Auth, the middleware and every
// service must use the same connection pool as @kata/db — Cloud SQL has a small
// connection budget and a second pool would silently double the usage.
export { db, pool } from "@kata/db";
