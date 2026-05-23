---
plan: PLAN-003
title: "Connection module + startup wiring"
complexity: 2
---

# Connection module + startup wiring

## Objective

Replace `apps/api/src/db/connection.ts` with a native MongoDB connection
module that owns the shared `MongoClient` and `Db`, exports the
`withTransaction(cb)` helper, and is awaited from `src/index.ts` before the
HTTP server binds. Rewire `app.ts`'s `/healthz` and `auth/better-auth.ts`'s
adapter wiring to consume the shared `db`.

## Files to Touch

- `apps/api/src/db/connection.ts` — **rewrite** (replace mongoose
  implementation with native `MongoClient`)
- `apps/api/src/index.ts` — **modify** (await `connectDB()` and
  `ensureIndexes()` before `serve(...)`, swap `disconnect()` import)
- `apps/api/src/app.ts` — **modify** (rewrite `/healthz` to use native ping
  instead of `mongoose.connection.readyState`)
- `apps/api/src/auth/better-auth.ts` — **modify** (point the `Db` proxy at
  the new shared client, remove all `mongoose` imports)

## Approach

1. **Rewrite `db/connection.ts`** to export:

   ```ts
   import { MongoClient, type Db, type ClientSession } from "mongodb";
   import { env } from "../env.js";

   export const client = new MongoClient(env.MONGODB_URI);
   let connected = false;
   let dbInstance: Db | null = null;

   export async function connectDB(): Promise<Db> {
       if (connected && dbInstance) return dbInstance;
       await client.connect();
       dbInstance = client.db(); // default db from URI
       connected = true;
       console.log("[mongodb] connected");
       return dbInstance;
   }

   export function getDb(): Db {
       if (!dbInstance) throw new Error("[mongodb] connectDB() must be awaited before getDb()");
       return dbInstance;
   }

   // Convenience export for code that runs after startup completes.
   export const db: Db = new Proxy({} as Db, {
       get(_t, prop) {
           return Reflect.get(getDb(), prop);
       },
   });

   export async function withTransaction<T>(
       cb: (session: ClientSession) => Promise<T>,
   ): Promise<T> {
       const session = client.startSession();
       try {
           return await session.withTransaction(cb);
       } finally {
           await session.endSession();
       }
   }

   export async function disconnect(): Promise<void> {
       if (!connected) return;
       await client.close();
       connected = false;
       dbInstance = null;
       console.log("[mongodb] disconnected");
   }
   ```

   Notes:
   - `db` is exported as a `Proxy` so other modules that import `db` at
     module top-level still work — they only resolve the `Db` lazily on first
     access, which happens after `connectDB()` has been awaited in
     `src/index.ts`.
   - `connectDB()` is idempotent (REQ US-1 edge case).
   - `withTransaction` matches the REQ US-5 signature exactly.

2. **Rewrite `src/index.ts`** startup so the server only binds after both
   `connectDB()` and `ensureIndexes()` resolve:

   ```ts
   import { serve } from "@hono/node-server";
   import { app } from "./app.js";
   import { env } from "./env.js";
   import { connectDB, disconnect } from "./db/connection.js";
   import { ensureIndexes } from "./db/indexes.js";
   import { cleanStaleTempFiles } from "./storage/disk.js";

   async function main(): Promise<void> {
       await connectDB();
       await ensureIndexes();

       void cleanStaleTempFiles(env.ATTACHMENTS_DIR, 60 * 60 * 1000);

       serve({ fetch: app.fetch, port: env.PORT }, (info) => {
           console.log(`kata/api listening on http://localhost:${info.port.toString()}`);
       });
   }

   main().catch((err) => {
       console.error("[server] startup failed:", err);
       process.exit(1);
   });

   async function shutdown(signal: string): Promise<void> {
       console.log(`[server] received ${signal}, shutting down…`);
       try {
           await disconnect();
       } catch (err) {
           console.error("[server] error during shutdown:", err);
       }
       process.exit(0);
   }

   process.on("SIGTERM", () => void shutdown("SIGTERM"));
   process.on("SIGINT", () => void shutdown("SIGINT"));
   ```

   `./db/indexes.js` is created by `slice-indexes`; if that slice hasn't
   landed yet, stub it as `export async function ensureIndexes(): Promise<void> {}`
   so this slice builds in isolation.

3. **Rewrite the `/healthz` handler in `app.ts`** to ping the native driver:

   ```ts
   import { client } from "./db/connection.js";

   app.get("/healthz", async (c) => {
       try {
           await client.db().command({ ping: 1 });
           return c.json({ ok: true, db: true });
       } catch {
           return c.json({ ok: false, db: false }, 503);
       }
   });
   ```

   Remove the `mongoose` import from `app.ts`.

4. **Rewire `auth/better-auth.ts`**: drop the `mongoose` import and the
   `getClient().db()` proxy; pass the shared `db` directly:

   ```ts
   import { betterAuth } from "better-auth";
   import { mongodbAdapter } from "better-auth/adapters/mongodb";
   import "../db/connection.js"; // ensure module is loaded
   import { db } from "../db/connection.js";
   ...
   export const auth = betterAuth({
       database: mongodbAdapter(db),
       ...
   });
   ```

   The `db` export is a Proxy resolving lazily, so the construction-time
   reference is safe even though `connectDB()` runs later — Better Auth only
   exercises the adapter on HTTP requests, which can't arrive until
   `serve(...)` is called (which is after `connectDB()` resolves).

## Interface Contract

This slice publishes the module-level API consumed by every other slice:

```ts
// from apps/api/src/db/connection.ts
import type { MongoClient, Db, ClientSession } from "mongodb";

export const client: MongoClient;
export const db: Db; // Proxy — safe to import at top-level
export function connectDB(): Promise<Db>;
export function getDb(): Db; // throws if connectDB not yet awaited
export function withTransaction<T>(
    cb: (session: ClientSession) => Promise<T>,
): Promise<T>;
export function disconnect(): Promise<void>;
```

Other slices import from `"../db/connection.js"` exactly as they did before;
only the underlying implementation changes.

The new `src/index.ts` startup awaits `ensureIndexes()` (provided by
`slice-indexes`). If that slice merges after this one, the developer must
ship a stub.

## Acceptance Criteria

- [ ] `apps/api/src/db/connection.ts` exports `client`, `db`, `connectDB`,
      `getDb`, `withTransaction`, `disconnect` with the signatures above.
- [ ] `src/index.ts` awaits `connectDB()` before calling `serve(...)`; any
      failure exits with a non-zero code.
- [ ] `/healthz` returns 200 `{ ok: true, db: true }` when the driver
      responds to `ping`, otherwise 503 `{ ok: false, db: false }`.
- [ ] `auth/better-auth.ts` no longer imports `mongoose`.
- [ ] `connectDB()` called twice opens the connection at most once.
- [ ] `withTransaction(cb)` ends the session in a `finally` block on both
      success and failure paths, and rethrows the original error.
- [ ] `tsc --noEmit` (`pnpm --filter @kata/api check`) passes for the files
      touched in this slice once the schemas slice has landed.
