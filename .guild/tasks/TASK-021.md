---
id: TASK-021
title: "Fix: Make board access derivation atomic to eliminate race condition"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

`deriveAccess()` in `apps/api/src/auth/middleware.ts` performs two separate DB queries (board lookup, then team membership lookup). A user whose membership is revoked between the two queries could slip through. Combine into a single aggregation pipeline or run inside a Mongoose session.

## Context

- Requirement: .guild/requirements/REQ-002.md
- Plan: .guild/plans/PLAN-002.md
- Review: TASK-019 (reviewer-security finding #2)
- File to fix: `apps/api/src/auth/middleware.ts` lines 36–63

## Acceptance Criteria

- [x] Board existence and team membership are resolved in one atomic operation (aggregate with $lookup or explicit session)
- [x] A user revoked from the team between the two old queries no longer gets access
- [x] `pnpm --filter @kata/api check` passes

## Work Log

### 2026-05-23 — developer
- Added `fetchBoardWithMembership(boardId, userId)` in `apps/api/src/auth/middleware.ts`: uses a `Board.aggregate` pipeline with a correlated `$lookup` on the `teammembers` collection to fetch the board and the user's team membership in a single round-trip.
- Changed `deriveAccess` from `async` (with an internal `TeamMember.findOne`) to a pure synchronous function that reads the preloaded `membership` field from the board object returned by the aggregate.
- Updated `loadBoardAccess` middleware to call `fetchBoardWithMembership` instead of `Board.findById` + separate membership query.
- Updated `streamAttachment` in `apps/api/src/services/attachments.ts` to call `fetchBoardWithMembership` instead of `Board.findById` + `deriveAccess`, closing the same race in the attachment download path.
- Removed unused `Board` import from `attachments.ts` and unused `TeamMember` import from `middleware.ts`.
- `pnpm --filter @kata/api check` passes with no errors.

## Follow-up Tasks
