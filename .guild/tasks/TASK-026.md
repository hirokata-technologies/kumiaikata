---
id: TASK-026
title: "Fix: Validate ObjectId route params early — return 422 for malformed IDs"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
depends-on: []
priority: medium
created: 2026-05-23
---

## Objective

Route params like `:cardId`, `:columnId`, `:boardId` are passed to Mongoose queries without ObjectId validation. A malformed ID silently returns 404 instead of a descriptive 422. Add a shared middleware or helper that validates params are valid MongoDB ObjectIds and throws VALIDATION_ERROR (422) if not.

## Context

- Requirement: .guild/requirements/REQ-002.md
- Plan: .guild/plans/PLAN-002.md
- Review: TASK-019 (reviewer-edge-case finding #3)
- Most route files in `apps/api/src/routes/`

## Acceptance Criteria

- [x] Malformed ObjectId route params (e.g., `not-a-valid-id`) return 422 with code VALIDATION_ERROR
- [x] Valid ObjectIds continue to work normally
- [x] `pnpm --filter @kata/api check` passes

## Work Log

### 2026-05-23 — developer
- Added `validateObjectId(value, name)` helper to `apps/api/src/http/validate.ts` using `mongoose.isValidObjectId()`, throws `AppError("VALIDATION_ERROR", "${name} must be a valid id")` on invalid input.
- Applied to `loadBoardAccess` in `apps/api/src/auth/middleware.ts` for `:boardId` — now throws 422 instead of silently returning null and producing a 404.
- Applied to all sub-resource params across all board route files:
  - `apps/api/src/routes/cards.ts`: `:cardId`, `:columnId`
  - `apps/api/src/routes/columns.ts`: `:columnId`
  - `apps/api/src/routes/card-comments.ts`: `:cardId`, `:commentId`
  - `apps/api/src/routes/card-checklists.ts`: `:cardId`, `:checklistId`, `:itemId`
  - `apps/api/src/routes/card-assignees.ts`: `:cardId`
  - `apps/api/src/routes/card-labels.ts`: `:cardId`, `:labelId`
  - `apps/api/src/routes/card-attachments.ts`: `:cardId`, `:attachmentId` (replaced prior manual null-check)
  - `apps/api/src/routes/labels.ts`: `:labelId`
  - `apps/api/src/routes/teams.ts`: `:teamId`, `:userId`
- `pnpm --filter @kata/api check` passes with zero errors.

## Follow-up Tasks
