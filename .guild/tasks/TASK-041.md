---
id: TASK-041
title: "Implement labels + attachments services"
agent: developer
status: done
requirement: REQ-003
plan: PLAN-003
plan-slice: .guild/plans/PLAN-003/slice-services-labels-attachments.md
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Rewrite services/labels.ts and services/attachments.ts using native driver.

## Context

- Requirement: .guild/requirements/REQ-003.md
- Plan: .guild/plans/PLAN-003.md
- Plan slice: .guild/plans/PLAN-003/slice-services-labels-attachments.md
- Parent task: TASK-035

## Acceptance Criteria

- [x] `services/labels.ts` and `services/attachments.ts` contain zero `mongoose` imports.
- [x] Both transaction sites use `withTransaction` from `db/connection.js`.
- [x] `deleteLabel` removes `labelId` from all cards on the board (via `$pull`) and deletes the label in a single transaction.
- [x] `uploadAttachment` writes to storage before opening the transaction; storage failure aborts before DB write.
- [x] `deleteAttachment` deletes the storage file after the transaction commits and tolerates storage-delete failures (logs, does not throw).
- [x] `routes/card-attachments.ts` no longer imports anything from `mongoose`.
- [x] `pnpm --filter @kata/api check` produces no errors in files touched by this slice.

## Work Log

### 2026-05-23 — developer
- Rewrote `apps/api/src/services/labels.ts` using native driver: replaced `Label.create`, `Label.findOneAndUpdate`, `Label.findOne`, `Label.deleteOne`, and Mongoose session/transaction with `labelsColl()`, `cardsColl()`, and `withTransaction` from `db/connection.js`.
- Rewrote `apps/api/src/services/attachments.ts` using native driver: replaced `Attachment.create`, `Attachment.findOne`, `Attachment.findById`, `Card.updateOne`, and Mongoose sessions with native collection accessors and `withTransaction`.
- Modified `apps/api/src/routes/card-attachments.ts`: removed `import type { Types } from "mongoose"` and the `BoardContext` shim; now reads `board` directly from `c.get("board")` typed as `ContextBoard` (already typed with `ObjectId._id`).
- Followed patterns from `slice-services-labels-attachments.md` plan slice.
- Verified no errors in modified files via `pnpm --filter @kata/api check` (remaining errors are in other files not in scope for this slice).

## Follow-up Tasks
