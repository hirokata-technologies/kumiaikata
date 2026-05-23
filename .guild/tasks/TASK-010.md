---
id: TASK-010
title: "Implement cross-cutting primitives (errors, validation, ordering, event bus, storage)"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
plan-slice: .guild/plans/PLAN-002/slice-primitives.md
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Implement cross-cutting primitives (errors, validation, ordering, event bus, storage)

## Context

- Requirement: .guild/requirements/REQ-002.md — Kanban Board Management API
- Plan: .guild/plans/PLAN-002.md
- Plan slice: .guild/plans/PLAN-002/slice-primitives.md
- Parent task: TASK-007

## Acceptance Criteria

- [x] Throwing `new AppError('NOT_FOUND', 'no')` from any route produces `{ "error": { "code": "NOT_FOUND", "message": "no" } }` with status 404.
- [x] An unknown thrown error produces `{ "error": { "code": "INTERNAL_ERROR", ... } }` with status 500 and the original error is logged.
- [x] `zValidator` rejects malformed bodies with status 422 and the error envelope.
- [x] `reorderToMatch` returns only the rows whose computed position differs.
- [x] `eventBus.subscribe(boardId, listener)` returns an unsubscribe function and the listener fires only for matching `boardId`.
- [x] `DiskStorage.put` creates parent directories as needed and writes the file atomically (no half-written file visible at the final path on crash).
- [x] `pnpm --filter @kata/api check` passes.

## Work Log

### 2026-05-23 — developer
- Implemented `apps/api/src/http/error.ts` — `AppError` class, `ErrorCode` enum, `errorHandler` for Hono `onError`.
- Implemented `apps/api/src/http/validate.ts` — `zValidator` wrapper over `@hono/zod-validator` that throws `AppError('VALIDATION_ERROR', ...)` on schema failure.
- Implemented `apps/api/src/http/responders.ts` — `ok`, `created`, `noContent` response helpers.
- Implemented `apps/api/src/ordering/fractional.ts` — `appendAfter`, `insertBetween`, `reorderToMatch` wrappers over `fractional-indexing`.
- Implemented `apps/api/src/events/types.ts` — `BoardEvent` discriminated union.
- Implemented `apps/api/src/events/bus.ts` — `BoardEventBus` interface + `InProcessEventBus` singleton via Node `EventEmitter`.
- Implemented `apps/api/src/storage/adapter.ts` — `StorageAdapter` interface.
- Implemented `apps/api/src/storage/disk.ts` — `DiskStorage` with atomic write (temp file + rename) and parent-dir creation.
- Implemented `apps/api/src/storage/index.ts` — module-level `storage` singleton.
- Modified `apps/api/src/app.ts` — added `app.onError(errorHandler)` after route stubs.
- `pnpm --filter @kata/api check` passes with no type errors.

## Follow-up Tasks
