---
id: TASK-015
title: "Implement card detail routes (comments, checklists, assignees, labels)"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
plan-slice: .guild/plans/PLAN-002/slice-card-detail-routes.md
depends-on: []
priority: medium
created: 2026-05-23
---

## Objective

Implement card detail routes (comments, checklists, assignees, labels)

## Context

- Requirement: .guild/requirements/REQ-002.md — Kanban Board Management API
- Plan: .guild/plans/PLAN-002.md
- Plan slice: .guild/plans/PLAN-002/slice-card-detail-routes.md
- Parent task: TASK-007

## Acceptance Criteria

- [x] Board label CRUD requires admin/owner; member gets 403 (requireBoardAdmin guard on all label mutations)
- [x] Deleting a label removes it from every card's labelIds on that board (transaction in deleteLabel service)
- [x] Hex color validation rejects invalid formats with 422 (zValidator with regex on hexColor field)
- [x] Comment edit by non-author returns 403; comment delete by author OR admin/owner returns 204
- [x] Empty comment body returns 422; body > 10000 chars returns 422 (bodyField = z.string().min(1).max(10000))
- [x] Checklist item edits flip checked and update text independently (optional fields in PATCH schema)
- [x] Assignee add for a non-team-member (team board) returns 422; personal board only owner can be assigned
- [x] Idempotent operations (re-add same label, re-add same assignee) return 200 without duplicates ($addToSet)
- [x] Every mutation emits exactly one event with the correct type and board id
- [x] Task completed successfully

## Work Log

### 2026-05-23 — developer
- Created `apps/api/src/services/labels.ts` with createLabel, updateLabel, deleteLabel (deleteLabel uses a transaction to atomically remove label from all card.labelIds and delete the Label document)
- Created `apps/api/src/routes/labels.ts` for board-level label CRUD (POST/PATCH/DELETE), all guarded by requireBoardAdmin
- Created `apps/api/src/routes/card-labels.ts` for card-label association (POST adds via $addToSet for idempotency, DELETE removes via $pull)
- Created `apps/api/src/routes/card-comments.ts` with POST/PATCH/DELETE; PATCH is author-only, DELETE allows author or board admin/owner
- Created `apps/api/src/routes/card-checklists.ts` with checklist CRUD and item CRUD nested under checklist; uses Mongoose subdoc .id() pattern
- Created `apps/api/src/routes/card-assignees.ts` with team-member validation for team boards and owner-only validation for personal boards
- Modified `apps/api/src/app.ts` to mount all five new routers at their correct paths
- All new files pass TypeScript check with no errors (pre-existing errors in card-attachments.ts and services/attachments.ts unchanged)

## Follow-up Tasks
