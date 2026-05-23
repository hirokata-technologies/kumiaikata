---
id: TASK-049
title: "Fix: user.id string guard in provisioning + ensureIndexes error handling"
agent: developer
status: done
requirement: REQ-003
plan: PLAN-003
depends-on: []
priority: medium
created: 2026-05-23
---

## Objective

Two medium-priority robustness improvements:

1. **auth/provisioning.ts** — Add a runtime guard before storing `user.id as unknown as ObjectId`: `if (typeof user.id !== "string" || !user.id) throw new AppError("INTERNAL_ERROR", "user.id must be a non-empty string")`. This protects against any future Better Auth version that might change the ID type.

2. **db/indexes.ts ensureIndexes** — Wrap the `createIndex` calls in a try/catch that logs a descriptive error message (e.g., `"Index conflict on collection X — drop the conflicting index manually"`) before re-throwing. This makes startup failures diagnosable. The error should still propagate to abort startup.

Also add a JSDoc comment on `TEAM_MEMBERS_COLLECTION` and the `ownerId`/`userId` type cast in schemas and provisioning explaining the Better Auth string ID invariant, so future developers don't accidentally introduce `new ObjectId(user.id)` again.

## Context

- Requirement: .guild/requirements/REQ-003.md
- Plan: .guild/plans/PLAN-003.md
- Review: TASK-044 (reviewer-security findings #9, #10; reviewer-edge-case finding #6)
- Files: `apps/api/src/auth/provisioning.ts`, `apps/api/src/db/indexes.ts`

## Acceptance Criteria

- [x] provisioning.ts guards `user.id` is a non-empty string before type-casting
- [x] ensureIndexes wraps createIndex errors with descriptive context before re-throwing
- [x] Type invariant comment added at the type cast sites
- [x] `pnpm --filter @kata/api check` passes

## Work Log

### 2026-05-23 — developer
- Added `user.id` non-empty string guard at the top of `provisionUser` in `apps/api/src/auth/provisioning.ts`, throwing `AppError("INTERNAL_ERROR", ...)` if the value is not a non-empty string. Imported `AppError` from `../http/error.js`.
- Replaced the existing note comment at `ownerId: user.id as unknown as ObjectId` with a clearer JSDoc-style comment explaining the Better Auth string ID invariant and the prohibition on `new ObjectId(user.id)`.
- Wrapped each `createIndex` call in `apps/api/src/db/indexes.ts` with its own try/catch that re-throws with a descriptive `[ensureIndexes] Failed to create index on "<colName>": ...` prefix, making startup failures diagnosable.
- Added a comment to `userId: z.instanceof(ObjectId)` in `apps/api/src/db/schemas/team-member.ts` explaining the Better Auth string ID invariant and the same query constraint.
- `pnpm --filter @kata/api check` passes with zero errors.

## Follow-up Tasks
