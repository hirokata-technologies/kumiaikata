---
id: TASK-013
title: "Implement column CRUD and reorder routes"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
plan-slice: .guild/plans/PLAN-002/slice-columns-routes.md
depends-on: []
priority: medium
created: 2026-05-23
---

## Objective

Implement column CRUD and reorder routes

## Context

- Requirement: .guild/requirements/REQ-002.md — Kanban Board Management API
- Plan: .guild/plans/PLAN-002.md
- Plan slice: .guild/plans/PLAN-002/slice-columns-routes.md
- Parent task: TASK-007

## Acceptance Criteria

- [x] `POST /api/boards/:boardId/columns` with `{ "title": "In Progress" }` returns 201 and the column with a generated `position`.
- [x] `PATCH /api/boards/:boardId/columns/:columnId` renames; returns 200.
- [x] `DELETE /api/boards/:boardId/columns/:columnId` returns 204 when the column has no cards.
- [x] `DELETE` on a non-empty column returns 409.
- [x] `PATCH /api/boards/:boardId/columns/reorder` with the full set of IDs in new order updates positions and returns 200.
- [x] `PATCH .../reorder` with a missing or extra ID returns 422.
- [x] A team-member (non-admin) performing any of the above mutations on a team board gets 403.
- [x] Each successful mutation triggers exactly one matching `BoardEvent` on the bus for the board.

## Work Log

### 2026-05-23 — developer
- Implemented `createColumn`, `renameColumn`, `deleteColumn`, `reorderColumns` in `apps/api/src/services/columns.ts`
- Implemented columns router in `apps/api/src/routes/columns.ts` following the same pattern as `routes/cards.ts`
- Mounted columns router at `/api/boards/:boardId/columns` in `apps/api/src/app.ts` (before the cards router so both can coexist)
- `reorder` route defined before `/:columnId` so Hono matches it as a literal segment
- All mutations guarded by `requireSession`, `loadBoardAccess`, `requireBoardAdmin`; team-members are rejected with 403 via existing `requireBoardAdmin` middleware
- `deleteColumn` checks `Card.countDocuments({ columnId })` and throws CONFLICT (409) if > 0
- `reorderColumns` validates that `desiredIds` length and set matches current columns, throws VALIDATION_ERROR (422) on mismatch
- Each service function emits the corresponding `BoardEvent` on `eventBus`
- No TypeScript errors in new files; pre-existing error in `labels.ts` is unrelated

## Follow-up Tasks
