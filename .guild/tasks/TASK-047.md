---
id: TASK-047
title: "Fix: Null assertions after insertOne + AppError in getBoardWithColumnsAndCards"
agent: developer
status: done
requirement: REQ-003
plan: PLAN-003
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Three null-safety bugs introduced during the native driver migration:

1. **services/columns.ts ~line 60** — After `columns().insertOne(doc)`, code does `await columns().findOne({ _id: insert.insertedId })` then uses `doc!` non-null assertion. If the findOne returns null (replication lag, driver bug), this crashes. Replace with: `if (!doc) throw new AppError("INTERNAL_ERROR", "Column was created but could not be fetched.")`.

2. **services/cards.ts ~line 151** — Same `card!` pattern after `cards().insertOne()` + `findOne`. Add null check + AppError.

3. **services/boards.ts getBoardWithColumnsAndCards** — Throws `new Error("Board not found")` instead of `new AppError("NOT_FOUND", "Board not found")`. The generic Error bypasses the central error handler's AppError check, returning 500 instead of 404.

## Context

- Requirement: .guild/requirements/REQ-003.md
- Plan: .guild/plans/PLAN-003.md
- Review: TASK-044 (reviewer-edge-case findings #1, #2, #12)
- Files: `apps/api/src/services/columns.ts`, `apps/api/src/services/cards.ts`, `apps/api/src/services/boards.ts`

## Acceptance Criteria

- [x] `createColumn` does not use `!` assertion; null result throws AppError INTERNAL_ERROR
- [x] `createCard` does not use `!` assertion; null result throws AppError INTERNAL_ERROR
- [x] `getBoardWithColumnsAndCards` throws `AppError("NOT_FOUND", ...)` not generic `Error`
- [x] `pnpm --filter @kata/api check` passes

## Work Log

### 2026-05-23 — developer
- Fixed `createColumn` in `apps/api/src/services/columns.ts`: replaced `doc!` non-null assertion with explicit null guard throwing `AppError("INTERNAL_ERROR", ...)`.
- Fixed `createCard` in `apps/api/src/services/cards.ts`: replaced `card!` non-null assertion with explicit null guard throwing `AppError("INTERNAL_ERROR", ...)`.
- Fixed `getBoardWithColumnsAndCards` in `apps/api/src/services/boards.ts`: replaced generic `throw new Error(...)` with `throw new AppError("NOT_FOUND", "Board not found.")` and added the missing `AppError` import from `../http/error.js`.
- `pnpm --filter @kata/api check` passes with no type errors.

## Follow-up Tasks
