---
id: TASK-048
title: "Fix: Health check client.db() + endSession error masking in withTransaction"
agent: developer
status: done
requirement: REQ-003
plan: PLAN-003
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Two infrastructure bugs:

1. **app.ts health check** — `/healthz` calls `client.db().command({ ping: 1 })` which creates a new Db instance on every request instead of using the shared `db` proxy. Change to use `getDb().command({ ping: 1 })` (or import `db` directly) so the health check reflects the same connection state used by route handlers. Wrap in try/catch returning 503.

2. **db/connection.ts withTransaction** — The `session.endSession()` call in `finally` can throw (e.g., network failure), which would mask the original callback error. Wrap `endSession()` in its own try/catch: if the callback already threw, swallow the `endSession` error and re-throw the original; if callback succeeded, propagate `endSession` errors normally.

## Context

- Requirement: .guild/requirements/REQ-003.md
- Plan: .guild/plans/PLAN-003.md
- Review: TASK-044 (reviewer-edge-case findings #5, #11)
- Files: `apps/api/src/app.ts`, `apps/api/src/db/connection.ts`

## Acceptance Criteria

- [x] `/healthz` uses the shared `db`/`getDb()` for the ping command, not `client.db()`
- [x] `withTransaction` endSession errors do not mask original callback errors
- [x] `pnpm --filter @kata/api check` passes

## Work Log

### 2026-05-23 — developer
- Fix 1: Replaced `import { client }` with `import { getDb }` in `apps/api/src/app.ts`; health check now calls `getDb().command({ ping: 1 })` using the shared db instance
- Fix 2: Wrapped `session.endSession()` in its own try/catch in `apps/api/src/db/connection.ts`; endSession errors are suppressed when the callback already threw, propagated normally otherwise
- `pnpm --filter @kata/api check` passes with no errors

## Follow-up Tasks
