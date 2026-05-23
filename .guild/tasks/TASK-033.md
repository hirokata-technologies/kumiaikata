---
id: TASK-033
title: "Fix: Validate attachmentId in standalone GET /api/attachments/:id route"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
depends-on: []
priority: medium
created: 2026-05-23
---

## Objective

`apps/api/src/routes/attachments.ts` GET handler passes `:attachmentId` directly to `streamAttachment()` without calling `validateObjectId`. A malformed ID returns 404 instead of 422, inconsistent with all other routes.

## Context

- Requirement: .guild/requirements/REQ-002.md
- Plan: .guild/plans/PLAN-002.md
- Review: TASK-031 (reviewer-edge-case round 2, finding #3)
- File: `apps/api/src/routes/attachments.ts` line ~14

## Acceptance Criteria

- [x] Malformed `:attachmentId` returns 422 VALIDATION_ERROR (not 404)
- [x] Valid attachment IDs continue to stream correctly
- [x] `pnpm --filter @kata/api check` passes

## Work Log

### 2026-05-23 — developer
- Added `import { validateObjectId } from "../http/validate.js"` to `apps/api/src/routes/attachments.ts`
- GET handler: added `const attachmentId = validateObjectId(c.req.param("attachmentId"), "attachmentId")` before the `streamAttachment` call, and passed `attachmentId` instead of the raw param
- `pnpm --filter @kata/api check` passes with no errors

## Follow-up Tasks
