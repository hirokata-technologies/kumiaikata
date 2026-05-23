---
id: TASK-042
title: "Implement card-detail route rewrites"
agent: developer
status: done
requirement: REQ-003
plan: PLAN-003
plan-slice: .guild/plans/PLAN-003/slice-routes-card-detail.md
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Rewrite routes/card-comments.ts, routes/card-checklists.ts, routes/card-assignees.ts, routes/card-labels.ts — replacing inline Mongoose subdocument calls with native driver positional $, arrayFilters, and $elemMatch patterns.

## Context

- Requirement: .guild/requirements/REQ-003.md
- Plan: .guild/plans/PLAN-003.md
- Plan slice: .guild/plans/PLAN-003/slice-routes-card-detail.md
- Parent task: TASK-035

## Acceptance Criteria

- [x] Task completed successfully

## Work Log

### 2026-05-23 — developer
- Rewrote `apps/api/src/routes/card-comments.ts`: replaced `mongoose` + `Card` model with `ObjectId` from `mongodb` and `cards()` accessor from `../db/schemas/index.js`. POST uses `$push`, PATCH uses two-stage `findOne` existence check + `findOneAndUpdate` with positional `$` and `$elemMatch` projection, DELETE uses `$elemMatch` projection + `$pull`.
- Rewrote `apps/api/src/routes/card-checklists.ts`: replaced all Mongoose subdocument helpers (`checklists.id()`, `items.id()`, `deleteOne()`, `card.save()`) with native driver positional `$`, `arrayFilters`, and `$elemMatch` projection patterns. Preserved all four distinct 404 messages for item delete via a two-step existence check.
- Rewrote `apps/api/src/routes/card-assignees.ts`: replaced `TeamMember.exists` with `teamMembers().findOne({...}, { projection: { _id: 1 } })` and `Card.updateOne` with `cards().updateOne`. Used `board.teamId!` non-null assertion inside `board.kind === "team"` branch to satisfy `exactOptionalPropertyTypes`.
- Rewrote `apps/api/src/routes/card-labels.ts`: replaced `Label.findOne().lean()` with `labels().findOne()` and `Card.updateOne` with `cards().updateOne`. Added `validateObjectId` call on the body `labelId` field.
- All four files have zero `mongoose` imports; `pnpm --filter @kata/api check` passes with no errors.
- Event payload IDs are emitted as strings using `String(objectId)` or the validated string variable.

## Follow-up Tasks
