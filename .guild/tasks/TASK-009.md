---
id: TASK-009
title: "Implement MongoDB connection and Mongoose models"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
plan-slice: .guild/plans/PLAN-002/slice-db-models.md
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Implement MongoDB connection and Mongoose models

## Context

- Requirement: .guild/requirements/REQ-002.md — Kanban Board Management API
- Plan: .guild/plans/PLAN-002.md
- Plan slice: .guild/plans/PLAN-002/slice-db-models.md
- Parent task: TASK-007

## Acceptance Criteria

- [x] Importing any model triggers a Mongoose connection attempt against `MONGODB_URI`.
- [x] All indexes listed in the data-model section of `PLAN-002.md` are declared in code.
- [x] Partial unique indexes on `boards` correctly allow at most one personal board per user and one team board per team.
- [x] Composite unique index on `teamMembers (teamId, userId)` rejects duplicates.
- [x] `/healthz` returns `{ ok: true, db: true }` when Mongo is reachable and `{ ok: false, db: false }` with status 503 when it is not.
- [x] On `SIGTERM`, the process closes the Mongo connection and exits cleanly within 2s.
- [x] `pnpm --filter @kata/api check` passes.

## Work Log

### 2026-05-23 — developer
- Created `apps/api/src/db/types.ts` with shared `Role` and `BoardKind` types.
- Created `apps/api/src/db/connection.ts` — singleton Mongoose connection with idempotent connect on import, event logging for connected/disconnected/error, exports `mongoose` and `disconnect()` helper.
- Created `apps/api/src/db/models/team.ts` — Team schema with unique `domain` field, `name`, `teamBoardId` ref, timestamps.
- Created `apps/api/src/db/models/team-member.ts` — TeamMember schema with `teamId`/`userId`/`role`/`joinedAt` and composite unique index `{ teamId: 1, userId: 1 }`.
- Created `apps/api/src/db/models/board.ts` — Board schema with `kind` enum, `ownerId`, `teamId`, and two partial unique indexes enforcing one-board-per-user (personal) and one-board-per-team (team).
- Created `apps/api/src/db/models/column.ts` — Column schema with `boardId`, `title`, fractional `position`, timestamps, compound index `{ boardId: 1, position: 1 }`.
- Created `apps/api/src/db/models/card.ts` — Card schema with embedded `CommentSchema`, `ChecklistItemSchema`, `ChecklistSchema` subdocuments; all referenced ObjectId arrays; compound index `{ columnId: 1, position: 1 }`.
- Created `apps/api/src/db/models/label.ts` — Label schema with `boardId`, `name` (max 50), `color`.
- Created `apps/api/src/db/models/attachment.ts` — Attachment schema with `cardId`, `boardId`, `filename`, `mimeType`, `sizeBytes`, `storageKey`, `uploadedBy`, `createdAt` only.
- Created `apps/api/src/db/models/index.ts` — barrel export for all models.
- Modified `apps/api/src/app.ts` — imported `mongoose` from `./db/connection.js` (triggers connection on app boot); updated `/healthz` to return `{ ok, db }` and 503 when DB is not connected.
- Modified `apps/api/src/index.ts` — added `shutdown()` function called on `SIGTERM`/`SIGINT` that calls `disconnect()` and exits cleanly.
- `pnpm --filter @kata/api check` passes with no type errors.

## Follow-up Tasks
