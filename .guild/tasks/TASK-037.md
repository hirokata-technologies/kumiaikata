---
id: TASK-037
title: "Implement Zod schemas + typed collection accessors"
agent: developer
status: done
requirement: REQ-003
plan: PLAN-003
plan-slice: .guild/plans/PLAN-003/slice-schemas.md
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Create db/schemas/ with one Zod schema per collection; add typed collection accessor functions; update http/validate and http/types; delete db/models/.

## Context

- Requirement: .guild/requirements/REQ-003.md
- Plan: .guild/plans/PLAN-003.md
- Plan slice: .guild/plans/PLAN-003/slice-schemas.md
- Parent task: TASK-035

## Acceptance Criteria

- [x] `apps/api/src/db/schemas/` contains nine files (eight collection schemas + `index.ts`).
- [x] Each collection file exports a schema, a `z.infer<>` alias, and a `<NAME>_COLLECTION` string constant matching the Mongoose-pluralised collection name.
- [x] `db/schemas/index.ts` exports the `COLLECTIONS` constant and a typed accessor function per collection.
- [x] `apps/api/src/db/models/` no longer exists.
- [x] `http/validate.ts` uses `ObjectId.isValid` and exports `validateObjectId` with the exact same signature.
- [x] `http/types.ts` imports `ObjectId` from `mongodb`, not `mongoose`.
- [x] No file in this slice imports from `mongoose`.
- [x] `z.infer<typeof BoardSchema>` etc. produces types compatible with the driver's `Collection<DocType>` generic constraint.
- [x] Task completed successfully

## Work Log

### 2026-05-23 — developer

- Created `apps/api/src/db/schemas/board.ts`, `card.ts`, `column.ts`, `label.ts`, `attachment.ts`, `team.ts`, `team-member.ts`, `user.ts` — one Zod schema per collection, each exporting a schema, inferred type alias, and `<NAME>_COLLECTION` constant using Mongoose-preserved collection names (notably `TEAM_MEMBERS_COLLECTION = "teammembers"`).
- Created `apps/api/src/db/schemas/index.ts` with `COLLECTIONS` const object, typed accessor functions (`boards()`, `cards()`, `columns()`, `labels()`, `attachments()`, `teams()`, `teamMembers()`, `users()`), and re-exports for all schemas and types.
- Modified `apps/api/src/http/validate.ts`: replaced `mongoose` import with `ObjectId` from `mongodb`; replaced `mongoose.isValidObjectId()` with `ObjectId.isValid()`. Exported signature unchanged.
- Modified `apps/api/src/http/types.ts`: replaced `import type mongoose from "mongoose"` with `import type { ObjectId } from "mongodb"`; updated `ContextBoard` interface field types accordingly.
- Deleted `apps/api/src/db/models/` directory (all 8 files + index).
- Key decisions: `user.ts` uses `_id: z.string()` (Better Auth stores UUIDs, not ObjectIds) with `.passthrough()` for additional BA fields; `attachment.ts` has only `createdAt` (no `updatedAt`) matching original Mongoose `{ createdAt: true, updatedAt: false }` config; `label.ts` has no timestamps.

## Follow-up Tasks
