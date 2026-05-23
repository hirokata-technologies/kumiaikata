---
id: TASK-040
title: "Implement columns + cards services"
agent: developer
status: done
requirement: REQ-003
plan: PLAN-003
plan-slice: .guild/plans/PLAN-003/slice-services-columns-cards.md
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Rewrite services/columns.ts and services/cards.ts (including transactional deleteCard) using native driver.

## Context

- Requirement: .guild/requirements/REQ-003.md
- Plan: .guild/plans/PLAN-003.md
- Plan slice: .guild/plans/PLAN-003/slice-services-columns-cards.md
- Parent task: TASK-035

## Acceptance Criteria

- [x] `services/columns.ts` and `services/cards.ts` contain zero `mongoose` imports.
- [x] All `bulkWrite` payloads use `new ObjectId(...)` (from `mongodb`).
- [x] `deleteCard` uses `withTransaction` from `db/connection.js`; transaction body: delete attachment rows then delete the card; storage files deleted only after commit.
- [x] `getCard` stale-attachment cleanup wraps missing IDs in `ObjectId` before the `$pull` query.
- [x] `routes/cards.ts` imports `ContextBoard` from `http/types.js` (no mongoose); `_id` typed as `ObjectId` via `ContextBoard`.
- [x] `routes/columns.ts` no longer references `mongoose` (verified — only imports `ContextBoard`).
- [x] Existing HTTP behaviour (404 vs 409 for non-empty column delete, 404 for missing card, 422 for wrong-length reorder) preserved.
- [x] `pnpm --filter @kata/api check` passes for all files in this slice (no errors in the four touched files).

## Work Log

### 2026-05-23 — developer
- Rewrote `apps/api/src/services/columns.ts` using `columns()` and `cards()` typed accessors from `db/schemas/index.js`. Replaced all Mongoose model calls (`Column.findOne`, `Column.create`, `Column.bulkWrite`) with native driver calls. `bulkWrite` uses `new ObjectId(u.id)` from `mongodb`. Parameter `boardId` tightened from `unknown` to `ObjectId`.
- Rewrote `apps/api/src/services/cards.ts` using `cards()`, `columns()`, `attachments()` typed accessors and `withTransaction` from `db/connection.js`. Key translations: `Card.findOne` → `cardsColl().findOne`, `Card.create` → `insertOne` + `findOne`, `Card.findOneAndUpdate` → native `findOneAndUpdate({ returnDocument: "after" })`, `Card.bulkWrite` → native `bulkWrite` with `new ObjectId`. `deleteCard` transaction body: delete attachment rows then delete card; storage file deletion after commit. `getCard` stale-attachment `$pull` uses `$in: missingIds.map((id) => new ObjectId(id))` with `as any` cast to satisfy strict driver typing.
- Updated `apps/api/src/routes/cards.ts`: removed `import type { Types } from "mongoose"` and local `BoardContext` interface; replaced with `import type { ContextBoard } from "../http/types.js"` and used `c.get("board") as ContextBoard` directly.
- Verified `apps/api/src/routes/columns.ts` requires no changes — already uses `ContextBoard` with no mongoose references.
- Fixed `exactOptionalPropertyTypes` TS error: added `| undefined` to `dueDate` in `toSummary` parameter type.
- `pnpm --filter @kata/api check` shows zero errors in the four touched files; remaining errors are pre-existing in out-of-scope files (`routes/card-checklists.ts`, `routes/card-comments.ts`, `routes/card-assignees.ts`, `routes/card-labels.ts`).

## Follow-up Tasks
