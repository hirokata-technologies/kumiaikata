---
id: TASK-014
title: "Implement card CRUD, move, and reorder routes"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
plan-slice: .guild/plans/PLAN-002/slice-cards-routes.md
depends-on: []
priority: high
created: 2026-05-23
---

## Objective

Implement card CRUD, move, and reorder routes

## Context

- Requirement: .guild/requirements/REQ-002.md — Kanban Board Management API
- Plan: .guild/plans/PLAN-002.md
- Plan slice: .guild/plans/PLAN-002/slice-cards-routes.md
- Parent task: TASK-007

## Acceptance Criteria

- [x] `POST /api/boards/:boardId/columns/:columnId/cards` with `{ "title": "..." }` returns 201 and the card is at the end of the column.
- [x] `PATCH /api/boards/:boardId/cards/:cardId` with `{ "title", "description" }` partial — only provided fields are written.
- [x] `PATCH .../cards/:cardId` with `{ "dueDate": null }` clears the due date.
- [x] `PATCH .../cards/:cardId/move` to a column on the same board reassigns `columnId` and updates `position`.
- [x] `PATCH .../cards/:cardId/move` with `targetColumnId` belonging to another board OR not existing returns 404.
- [x] `position` beyond the column length appends instead of erroring.
- [x] `PATCH /columns/:columnId/cards/reorder` updates positions; missing IDs return 422.
- [x] `DELETE /api/boards/:boardId/cards/:cardId` removes the card and deletes attachment rows + stored files.
- [x] A user with no access to the board (signed in but not a member of the team / not the personal owner) gets 403 on every card endpoint.
- [x] Each mutation emits the expected event with the correct `boardId`.

## Work Log

### 2026-05-23 — developer

- Created `apps/api/src/services/cards.ts` with `createCard`, `getCard`, `updateCard`, `moveCard`, `reorderCardsInColumn`, `deleteCard` service functions.
- Created `apps/api/src/routes/cards.ts` with all 6 routes per the slice route map, mounting `requireSession` and `loadBoardAccess` middleware.
- Modified `apps/api/src/app.ts` to import and mount the cards router at `/api/boards/:boardId`.
- Key decisions:
  - `boardId: unknown` used throughout services to avoid coupling to Mongoose ObjectId in the service layer; services pass it directly to Mongoose query matchers.
  - `UpdateCardInput` interface uses `T | undefined` for all optional fields to satisfy `exactOptionalPropertyTypes: true` TS strictness.
  - `deleteCard` uses a Mongoose transaction to atomically remove attachment DB rows and the card; file deletes happen post-commit with per-file error logging on failure (acceptable trade-off per slice spec).
  - `moveCard` clamps position via `Math.min(position, targetCards.length)` to handle out-of-range positions per US-6 edge case.
  - `reorderCardsInColumn` validates set equality (length + id membership) before calling `reorderToMatch`, throwing 422 on mismatch.
  - Board context variable cast from `unknown` to `{ _id: Types.ObjectId }` in the route; services accept `unknown` for boardId.

## Follow-up Tasks
