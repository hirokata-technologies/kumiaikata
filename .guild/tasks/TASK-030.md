---
id: TASK-030
title: "Fix: Clarify reorder error message to indicate all IDs must be included"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
depends-on: []
priority: low
created: 2026-05-23
---

## Objective

The column and card reorder endpoints throw a generic VALIDATION_ERROR when `orderedIds` does not include every item on the board. The message should clearly state "orderedIds must include every column/card on the board" to guide clients.

## Context

- Requirement: .guild/requirements/REQ-002.md
- Plan: .guild/plans/PLAN-002.md
- Review: TASK-019 (reviewer-edge-case finding #5)
- Files to fix: `apps/api/src/services/columns.ts` and `apps/api/src/services/cards.ts` reorder functions

## Acceptance Criteria

- [x] Reorder 422 error message explicitly says all IDs must be included
- [x] `pnpm --filter @kata/api check` passes

## Work Log

### 2026-05-23 — developer
- Updated `reorderColumns` error message in `apps/api/src/services/columns.ts` to include actual vs expected count
- Updated `reorderCardsInColumn` error message in `apps/api/src/services/cards.ts` to include actual vs expected count
- `pnpm --filter @kata/api check` passes with no errors

## Follow-up Tasks
