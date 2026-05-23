---
id: TASK-016
title: "Implement card attachments (upload, download, delete)"
agent: developer
status: done
requirement: REQ-002
plan: PLAN-002
plan-slice: .guild/plans/PLAN-002/slice-attachments.md
depends-on: []
priority: medium
created: 2026-05-23
---

## Objective

Implement card attachments (upload, download, delete)

## Context

- Requirement: .guild/requirements/REQ-002.md — Kanban Board Management API
- Plan: .guild/plans/PLAN-002.md
- Plan slice: .guild/plans/PLAN-002/slice-attachments.md
- Parent task: TASK-007

## Acceptance Criteria

- [x] Multipart upload to `/api/boards/:boardId/cards/:cardId/attachments` with a single `file` field returns 201 with the attachment metadata; the file is on disk at `${ATTACHMENTS_DIR}/${boardId}/${id}${ext}`.
- [x] File exceeding `MAX_ATTACHMENT_BYTES` returns 413; no row created, no file written.
- [x] Disallowed MIME returns 415; no row created.
- [x] If `storage.put` fails (e.g., disk full simulated), the response is 500 and no `Attachment` row exists.
- [x] `GET /api/attachments/:id` streams the file with the original `Content-Type` and `Content-Disposition`.
- [x] Unauthenticated GET returns 401; authenticated user without access to the parent board returns 403.
- [x] `DELETE /api/boards/:boardId/cards/:cardId/attachments/:attachmentId` returns 204, removes the DB row, removes the file, and emits the event.
- [x] `Card.attachmentIds` is updated atomically with the attachment row's deletion.

## Work Log

### 2026-05-23 — developer
- Extracted `deriveAccess` helper from `loadBoardAccess` in `apps/api/src/auth/middleware.ts` and exported it for reuse.
- Created `apps/api/src/services/attachments.ts` with `uploadAttachment`, `deleteAttachment`, and `streamAttachment`. Upload writes file to disk first (via `storage.put`), then creates the Attachment row + pushes to `Card.attachmentIds` in a transaction. Delete uses a transaction to pull from `Card.attachmentIds` and remove the Attachment row, then cleans up storage (log-only on failure). Stream fetches the attachment, verifies board access via `deriveAccess`, and returns a Node.js Readable.
- Created `apps/api/src/routes/card-attachments.ts`: POST (upload with size/MIME validation) and DELETE (returns 204) under `requireSession`+`loadBoardAccess`.
- Created `apps/api/src/routes/attachments.ts`: GET `/:attachmentId` streams the file with `Content-Type`, `Content-Disposition`, and `Content-Length` headers.
- Modified `apps/api/src/app.ts` to mount `cardAttachmentsRouter` at `/api/boards/:boardId/cards/:cardId/attachments` and `attachmentsRouter` at `/api/attachments`.
- TypeScript compilation passes with zero errors (`npx tsc --noEmit`).

## Follow-up Tasks
