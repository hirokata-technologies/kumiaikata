---
id: TASK-027
title: "Fix: Add stale .tmp file cleanup for attachment storage"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
depends-on: []
priority: medium
created: 2026-05-23
---

## Objective

Failed uploads can leave orphaned `.tmp` files in the attachments directory. Add a startup cleanup pass in `apps/api/src/storage/disk.ts` or a periodic job that removes `.tmp` files older than a configurable threshold (e.g., 1 hour).

## Context

- Requirement: .guild/requirements/REQ-002.md
- Plan: .guild/plans/PLAN-002.md
- Review: TASK-019 (reviewer-security finding #5 minor, reviewer-edge-case finding #8)
- File to fix: `apps/api/src/storage/disk.ts` and/or `apps/api/src/index.ts`

## Acceptance Criteria

- [x] On startup (or on a periodic interval), `.tmp` files older than 1 hour in `ATTACHMENTS_DIR` are deleted
- [x] Cleanup errors are logged but do not prevent the server from starting
- [x] `pnpm --filter @kata/api check` passes

## Work Log

### 2026-05-23 — developer
- Added `cleanStaleTempFiles(dir, maxAgeMs)` export in `apps/api/src/storage/disk.ts`; uses a private `findFiles` helper that walks the directory tree recursively using `readdir` with `withFileTypes`.
- Each candidate `.tmp` file is stat'd and deleted only if `mtime` age exceeds `maxAgeMs`; per-file errors are caught and logged, never thrown.
- Called once at process startup in `apps/api/src/index.ts` with `env.ATTACHMENTS_DIR` and a 1-hour threshold (3,600,000 ms); fired with `void` so it does not block server startup.
- `pnpm --filter @kata/api check` passes.

## Follow-up Tasks
