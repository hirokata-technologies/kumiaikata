---
id: TASK-028
title: "Fix: Refactor checklist item creation to use updateOne with $push"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
depends-on: []
priority: medium
created: 2026-05-23
---

## Objective

`apps/api/src/routes/card-checklists.ts` creates checklist items by manually pushing onto the in-memory array with `as never` and then calling `card.save()`. This bypasses Mongoose schema validation. Replace with `Card.findOneAndUpdate()` + `$push` so Mongoose handles subdocument creation, validation, and the atomic write.

## Context

- Requirement: .guild/requirements/REQ-002.md
- Plan: .guild/plans/PLAN-002.md
- Review: TASK-019 (reviewer-edge-case finding #9)
- File to fix: `apps/api/src/routes/card-checklists.ts` item creation handler (~line 95–120)

## Acceptance Criteria

- [x] Checklist item creation uses `$push` via `findOneAndUpdate`, no manual array mutation
- [x] `as never` cast is removed
- [x] Schema validation for new items is enforced by Mongoose
- [x] `pnpm --filter @kata/api check` passes (only pre-existing `disk.ts` errors unrelated to this task)

## Work Log

### 2026-05-23 — developer
- Replaced manual `checklist.items.push(item as never)` + `card.save()` with `Card.findOneAndUpdate()` + `$push` in the POST `/:checklistId/items` handler in `apps/api/src/routes/card-checklists.ts` (lines 95-133)
- Pre-generate `newItemId` as a `mongoose.Types.ObjectId`, use it in the `$push` update, then retrieve the created item via `updated.checklists.id(checklistId)?.items.id(newItemId)` for the response payload
- Removed the `as never` cast entirely
- Pre-existing TypeScript errors in `src/storage/disk.ts` (Dirent type mismatch) are unrelated to this task and were present before this change

## Follow-up Tasks
