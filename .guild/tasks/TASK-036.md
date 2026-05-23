---
id: TASK-036
title: "Implement connection module + startup wiring"
agent: developer
status: done
requirement: REQ-003
plan: PLAN-003
plan-slice: .guild/plans/PLAN-003/slice-connection.md
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Replace Mongoose connection module with native MongoClient. Rewire startup, health check, and Better Auth.

## Context

- Requirement: .guild/requirements/REQ-003.md
- Plan: .guild/plans/PLAN-003.md
- Plan slice: .guild/plans/PLAN-003/slice-connection.md
- Parent task: TASK-035

## Acceptance Criteria

- [x] `apps/api/src/db/connection.ts` exports `client`, `db`, `connectDB`, `getDb`, `withTransaction`, `disconnect` with the correct signatures.
- [x] `src/index.ts` awaits `connectDB()` before calling `serve(...)`; any failure exits with a non-zero code.
- [x] `/healthz` returns 200 `{ ok: true, db: true }` when the driver responds to `ping`, otherwise 503 `{ ok: false, db: false }`.
- [x] `auth/better-auth.ts` no longer imports `mongoose`.
- [x] `connectDB()` called twice opens the connection at most once (guarded by `connected` flag).
- [x] `withTransaction(cb)` ends the session in a `finally` block on both success and failure paths.
- [x] No TypeScript errors in the files touched by this slice.

## Work Log

### 2026-05-23 — developer

- Rewrote `apps/api/src/db/connection.ts` with native `MongoClient`. Exports `client`, `db` (Proxy), `connectDB`, `getDb`, `withTransaction`, `disconnect`. `connectDB()` is idempotent via `connected` flag. `withTransaction` ends session in `finally`.
- Rewrote `apps/api/src/index.ts` to run `main()` async: awaits `connectDB()` then `ensureIndexes()` before `serve(...)`. Startup failure exits with code 1.
- Created stub `apps/api/src/db/indexes.ts` (empty `ensureIndexes()`) since slice-indexes has not landed yet.
- Modified `apps/api/src/app.ts`: replaced `mongoose` import with `client` import, rewrote `/healthz` to use native `client.db().command({ ping: 1 })` with try/catch returning 503 on failure.
- Modified `apps/api/src/auth/better-auth.ts`: removed `mongoose` import, replaced Proxy construction with the shared `db` Proxy from `../db/connection.js`.
- Added `mongodb: ^6.0.0` to `apps/api/package.json` dependencies (was missing); ran `pnpm install`.
- Verified no TypeScript errors in the four files touched by this slice.

## Follow-up Tasks
