---
id: TASK-046
title: "Fix: Add validateObjectId for moveCard targetColumnId and card-labels body labelId"
agent: developer
status: done
requirement: REQ-003
plan: PLAN-003
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Two places pass user-supplied strings to `new ObjectId()` without prior validation:

1. **routes/cards.ts moveCard handler** — `targetColumnId` comes from `c.req.valid("json")` validated only as `z.string()`. Inside `services/cards.ts`, `new ObjectId(targetColumnId)` throws BSONError if the value is not a valid 24-hex string. Add `validateObjectId(targetColumnId, "targetColumnId")` in the route before calling `moveCard`.

2. **routes/card-labels.ts POST handler** — `labelId` from request body is used in `new ObjectId(labelId)` without ObjectId validation. Add `validateObjectId(labelId, "labelId")` after extracting it from the body.

## Context

- Requirement: .guild/requirements/REQ-003.md
- Plan: .guild/plans/PLAN-003.md
- Review: TASK-044 (reviewer-security findings #7, #8)
- Files: `apps/api/src/routes/cards.ts`, `apps/api/src/routes/card-labels.ts`

## Acceptance Criteria

- [x] Malformed `targetColumnId` in move-card body returns 422 (not 500)
- [x] Malformed `labelId` in card-labels POST body returns 422 (not 500)
- [x] Valid ObjectId values continue to work normally
- [x] `pnpm --filter @kata/api check` passes

## Work Log

### 2026-05-23 — developer
- Added `validateObjectId(targetColumnId, "targetColumnId")` in the move-card handler in `apps/api/src/routes/cards.ts` (line 79), passing the result `targetColId` to `moveCard(...)` instead of the raw string.
- `apps/api/src/routes/card-labels.ts` POST handler was already fixed (lines 23-25 contained `validateObjectId(rawLabelId, "labelId")` with the validated value used in the subsequent `new ObjectId()` call).
- `pnpm --filter @kata/api check` passes with no errors.

## Follow-up Tasks
