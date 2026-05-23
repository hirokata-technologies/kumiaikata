---
id: TASK-032
title: "Fix: Validate userId in card-assignees POST body and DELETE param"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Two missing `validateObjectId` calls in `apps/api/src/routes/card-assignees.ts`:
1. POST body `userId` — validate after `c.req.valid("json")` extraction
2. DELETE route param `:userId` — validate via `validateObjectId(c.req.param("userId"), "userId")`

## Context

- Requirement: .guild/requirements/REQ-002.md
- Plan: .guild/plans/PLAN-002.md
- Review: TASK-031 (reviewer-edge-case round 2, findings #1 and #2)
- File: `apps/api/src/routes/card-assignees.ts` lines ~22 and ~69

## Acceptance Criteria

- [x] Invalid userId in POST body returns 422 VALIDATION_ERROR
- [x] Invalid userId in DELETE route param returns 422 VALIDATION_ERROR
- [x] `pnpm --filter @kata/api check` passes

## Work Log

### 2026-05-23 — developer
- POST handler: extracted `rawUserId` from `c.req.valid("json")`, then passed through `validateObjectId(rawUserId, "userId")` in `apps/api/src/routes/card-assignees.ts` (~line 23)
- DELETE handler: replaced bare `c.req.param("userId")` with `validateObjectId(c.req.param("userId"), "userId")` (~line 70)
- `validateObjectId` was already imported; no import change needed
- `pnpm --filter @kata/api check` passes with no errors

## Follow-up Tasks
