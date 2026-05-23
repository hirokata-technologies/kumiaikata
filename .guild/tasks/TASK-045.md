---
id: TASK-045
title: "Fix: Better Auth user.id type mismatch in card-comments and card-assignees"
agent: developer
status: done
requirement: REQ-003
plan: PLAN-003
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Better Auth user._id is a string (UUID/CUID), never a hex ObjectId. Two routes incorrectly wrap it in `new ObjectId(user.id)`:

1. **card-comments.ts** — `authorId: new ObjectId(user.id)` on POST (creates comment) and `"comments.authorId": new ObjectId(user.id)` on PATCH/DELETE queries. Should use `user.id as unknown as ObjectId` (matching the provisioning.ts type-cast pattern) or raw string.

2. **card-assignees.ts** — `validateObjectId(rawUserId, "userId")` rejects UUIDs (returns 422). Then `new ObjectId(userIdStr)` throws BSONError on UUID strings. Fix: skip ObjectId validation for Better Auth user IDs; use the string directly in `$addToSet`/`$pull`/`$in` queries (stored as string in DB via type cast).

## Context

- Requirement: .guild/requirements/REQ-003.md
- Plan: .guild/plans/PLAN-003.md
- Review: TASK-044 (reviewer-security findings #1, #2, #3, #4)
- Files: `apps/api/src/routes/card-comments.ts`, `apps/api/src/routes/card-assignees.ts`

## Acceptance Criteria

- [x] `authorId` in new comments is stored as `user.id` (string cast), not `new ObjectId(user.id)`
- [x] Comment PATCH/DELETE queries match stored string authorId correctly
- [x] card-assignees no longer calls `validateObjectId` or `new ObjectId` on Better Auth user IDs
- [x] Assignee add/remove operations work for UUIDs
- [x] `pnpm --filter @kata/api check` passes

## Work Log

### 2026-05-23 — developer
- Fixed `card-comments.ts`: changed `authorId: new ObjectId(user.id)` to `user.id as unknown as ObjectId` in POST handler, and `"comments.authorId": new ObjectId(user.id)` to raw `user.id` string in PATCH query filter. DELETE already used `String(comment.authorId) === String(user.id)` comparison so no change needed there.
- Fixed `card-assignees.ts` POST: removed `validateObjectId(rawUserId, "userId")` and `new ObjectId(userIdStr)`, now uses raw `userId` string directly. Applied `as unknown as ObjectId` cast for `$addToSet` and `teamMembers().findOne` to satisfy TypeScript schema types. Personal board owner comparison simplified to `String(board.ownerId) !== userId`.
- Fixed `card-assignees.ts` DELETE: removed `validateObjectId` on `:userId` param and `new ObjectId(userIdStr)`, now uses raw `c.req.param("userId")` string with cast for `$pull`.
- Followed `user.id as unknown as ObjectId` pattern from `apps/api/src/auth/provisioning.ts`.
- `pnpm --filter @kata/api check` passes with no errors.

## Follow-up Tasks
