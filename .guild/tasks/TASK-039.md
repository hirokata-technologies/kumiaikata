---
id: TASK-039
title: "Implement boards + teams + auth services"
agent: developer
status: done
requirement: REQ-003
plan: PLAN-003
plan-slice: .guild/plans/PLAN-003/slice-services-boards-teams.md
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Rewrite services/boards.ts, services/teams.ts, auth/provisioning.ts, and auth/middleware.ts (fetchBoardWithMembership aggregate) using native driver.

## Context

- Requirement: .guild/requirements/REQ-003.md
- Plan: .guild/plans/PLAN-003.md
- Plan slice: .guild/plans/PLAN-003/slice-services-boards-teams.md
- Parent task: TASK-035

## Acceptance Criteria

- [x] No `mongoose` imports remain in any file touched by this slice.
- [x] `fetchBoardWithMembership` uses `boards().aggregate(...).toArray()` and returns the same shape as the current implementation.
- [x] `$lookup.from` value is `"teammembers"` (preserved Mongoose default).
- [x] `provisionUser` uses `withTransaction` and the upsert / count / insert sequence preserves the current first-member-becomes-admin semantics.
- [x] User-ID-vs-ObjectId hypothesis resolved: Better Auth user._id is a string (UUID/CUID), NOT an ObjectId. The `teamMembers.userId` and `boards.ownerId` fields store the string value via `as unknown as ObjectId` type cast, matching the previous Mongoose behavior (Hypothesis B). Queries against these fields use the raw string, not `new ObjectId(user.id)`.
- [x] `routes/boards.ts` and `routes/teams.ts` respond with identical HTTP status codes and JSON shapes as before.
- [x] `setMemberRole` returns `{ userId, role }` with the same value semantics as the current `target.save()` path.
- [x] `pnpm --filter @kata/api check` passes for all files in this slice (remaining errors are in out-of-scope files).

## Work Log

### 2026-05-23 — developer
- Rewrote `apps/api/src/services/boards.ts`: replaced `Board`, `Column`, `Card` Mongoose imports with `boards()`, `columns()`, `cards()` native accessors; used `new ObjectId(boardId)` for board lookup.
- Rewrote `apps/api/src/services/teams.ts`: replaced `Team`, `TeamMember` Mongoose imports with `teams()`, `teamMembers()` native accessors; used string userId with `as unknown as ObjectId` cast for Better Auth ID compatibility.
- Rewrote `apps/api/src/auth/provisioning.ts`: replaced `mongoose.startSession()` / `session.withTransaction()` with `withTransaction` from `db/connection.js`; replaced `Board.create`, `Team.findOneAndUpdate`, `TeamMember.updateOne` with native collection ops; used `findOneAndUpdate` with `returnDocument: "after"`.
- Rewrote `apps/api/src/auth/middleware.ts`: replaced `mongoose.Types.ObjectId` with `ObjectId` from `mongodb`; made `BoardWithMembership` interface exported; rewrote `fetchBoardWithMembership` using `boards().aggregate(...).toArray()`; preserved all exported names and signatures.
- Modified `apps/api/src/routes/boards.ts`: replaced `Board`, `TeamMember` Mongoose imports with `boardsColl()`, `teamMembersColl()` native accessors.
- Modified `apps/api/src/routes/teams.ts`: replaced `Team`, `TeamMember`, `User` Mongoose imports with `teamsColl()`, `teamMembersColl()`, `usersColl()` native accessors; Better Auth user IDs passed as strings for `$in` query against `user` collection.
- Key decision: Better Auth user._id is a string (Hypothesis B confirmed by schema inspection). Stored `userId`/`ownerId` as string via `as unknown as ObjectId` type cast; queried with raw string values to match stored form.

## Follow-up Tasks
