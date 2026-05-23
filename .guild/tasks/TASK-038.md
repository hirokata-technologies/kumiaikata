---
id: TASK-038
title: "Implement index bootstrap (ensureIndexes)"
agent: developer
status: done
requirement: REQ-003
plan: PLAN-003
plan-slice: .guild/plans/PLAN-003/slice-indexes.md
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Create ensureIndexes() that recreates all 14 MongoDB indexes (including the two partial-unique board indexes) using the native driver's createIndex API.

## Context

- Requirement: .guild/requirements/REQ-003.md
- Plan: .guild/plans/PLAN-003.md
- Plan slice: .guild/plans/PLAN-003/slice-indexes.md
- Parent task: TASK-035

## Acceptance Criteria

- [x] Task completed successfully

## Work Log

### 2026-05-23 — developer
- Replaced the stub `export async function ensureIndexes(): Promise<void> {}` in `apps/api/src/db/indexes.ts` with the full implementation
- All 14 indexes created via native `createIndex` calls: teams (1), teamMembers (3), boards (2 partial-unique), columns (2), cards (3), labels (1), attachments (2)
- The two board partial-unique indexes use `partialFilterExpression` matching `kind: "personal"` and `kind: "team"` respectively
- Errors from other files (services/routes still using old `db/models/`) are the responsibility of other slices and are unrelated to this task
- `apps/api/src/index.ts` was already wired by the connection slice — no further changes needed here
- `apps/api/src/db/schemas/index.ts` was already in place with typed collection accessors

## Follow-up Tasks
