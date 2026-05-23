---
plan: PLAN-002
slice: attachments
title: "Card attachments: upload, authenticated download, delete"
complexity: 2
---

# Card attachments

## Goal

Implement file uploads to a card, an authenticated download endpoint for the stored files, and a delete operation that removes both the DB row and the file on disk. Enforce a size cap and a MIME allowlist.

## Files to Create / Modify

- `apps/api/src/routes/card-attachments.ts` — create. POST upload, DELETE.
- `apps/api/src/routes/attachments.ts` — create. GET `/api/attachments/:attachmentId` for authenticated download.
- `apps/api/src/services/attachments.ts` — create. `uploadAttachment(boardId, cardId, file, user)`, `deleteAttachment(attachmentId)`, `streamAttachment(attachmentId, user)` with auth check.
- `apps/api/src/app.ts` — modify. Mount card-attachments under `/api/boards/:boardId/cards/:cardId/attachments` and standalone attachments under `/api/attachments`.

## Constraints (from US-10 edge cases — architect-chosen)

- Max file size: `env.MAX_ATTACHMENT_BYTES` (default 25 MB). Exceeded → 413 `PAYLOAD_TOO_LARGE`.
- MIME allowlist (architect's choice): `image/png, image/jpeg, image/gif, image/webp, image/svg+xml, application/pdf, text/plain, text/markdown, application/zip, application/json, application/octet-stream`. Disallowed → 415 `UNSUPPORTED_MEDIA_TYPE`. Centralise in `attachments.ts`.

## Implementation Steps

### Upload

```ts
// card-attachments.ts
const r = new Hono();
r.use('*', requireSession, loadBoardAccess);

r.post('/', async (c) => {
  const form = await c.req.parseBody({ all: false });
  const file = form['file'];
  if (!(file instanceof File)) throw new AppError('VALIDATION_ERROR', 'Field "file" is required.');
  if (file.size > env.MAX_ATTACHMENT_BYTES) {
    throw new AppError('PAYLOAD_TOO_LARGE', `File exceeds ${env.MAX_ATTACHMENT_BYTES} bytes.`);
  }
  if (!ALLOWED_MIMES.has(file.type)) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', `MIME type "${file.type}" is not permitted.`);
  }
  const att = await uploadAttachment({
    boardId: c.get('board')._id, cardId: c.req.param('cardId'), file, user: c.get('user')
  });
  return created(c, att);
});

r.delete('/:attachmentId', async (c) => {
  await deleteAttachment(c.get('board')._id, c.req.param('cardId'), c.req.param('attachmentId'));
  return noContent(c);
});
```

`uploadAttachment` service:
1. Verify the card exists and belongs to the board (404 if not).
2. Generate `attachmentId = new ObjectId()`.
3. Derive `storageKey = ${boardId}/${attachmentId}${path.extname(file.name)}`.
4. Stream `file.stream()` (Web Streams) to `storage.put(storageKey, ...)`. The disk adapter writes to `${ATTACHMENTS_DIR}/${storageKey}` via `pipeline()` + `Readable.fromWeb()`.
5. On storage failure, throw `INTERNAL_ERROR` — DO NOT create the DB row (per US-10 edge case).
6. After storage write succeeds, create the `Attachment` row and `Card.updateOne({ _id: cardId }, { $push: { attachmentIds: attachmentId } })` in a transaction.
7. Emit `card.attachment.added`.
8. Return `{ id, filename, mimeType, sizeBytes, url, uploadedBy, createdAt }` where `url` is `/api/attachments/${id}`.

### Authenticated download

```ts
// attachments.ts
const r = new Hono();
r.get('/:attachmentId', requireSession, async (c) => {
  const att = await Attachment.findById(c.req.param('attachmentId'));
  if (!att) throw new AppError('NOT_FOUND', 'Attachment not found.');
  // Verify access by loading the board it belongs to.
  const board = await Board.findById(att.boardId);
  if (!board) throw new AppError('NOT_FOUND', 'Attachment\'s board not found.');
  const access = await deriveAccess(board, c.get('user'));   // helper extracted from loadBoardAccess
  if (!access) throw new AppError('FORBIDDEN', 'You do not have access to this attachment.');

  c.header('Content-Type', att.mimeType);
  c.header('Content-Disposition', `inline; filename="${encodeURIComponent(att.filename)}"`);
  c.header('Content-Length', String(att.sizeBytes));
  const stream = await storage.get(att.storageKey);
  return c.body(Readable.toWeb(stream));   // Hono accepts ReadableStream
});
```

Factor `deriveAccess(board, user)` out of `loadBoardAccess` so this route can compute access for a board we already have a reference to, without going through `c.req.param('boardId')`. Update the auth slice's middleware file to export it.

> Implementation note for the developer: this requires a small change to `auth/middleware.ts` exported from the auth slice — extract the access-derivation logic into a reusable helper. Do not duplicate the logic here.

### Delete

`deleteAttachment` service:
1. Find `Attachment` scoped to `{ _id, boardId }`. 404 if missing.
2. Run a transaction: pull `attachmentId` from card's `attachmentIds`; delete the `Attachment` row.
3. After commit, call `storage.delete(att.storageKey)`. Log on failure but do not error the response — DB is the source of truth.
4. Emit `card.attachment.removed`.

## Interface Contract

Exposed:

- Attachment response shape: `{ id, filename, mimeType, sizeBytes, url, uploadedBy, createdAt }`. The `getCard` route (cards slice) also returns this shape inside the card's `attachments` array — keep field names identical.
- Constant `ALLOWED_MIMES` is local to this slice.

Consumes:

- `requireSession`, `loadBoardAccess`, `deriveAccess` from auth slice (note the new helper export).
- `storage` singleton, `eventBus`, `AppError`, responders from primitives slice.
- `Attachment`, `Card`, `Board` models.
- `env.MAX_ATTACHMENT_BYTES`, `env.ATTACHMENTS_DIR` from scaffolding slice.

Events emitted:

- `card.attachment.added`, `card.attachment.removed`.

## Acceptance Criteria

- [ ] Multipart upload to `/api/boards/:boardId/cards/:cardId/attachments` with a single `file` field returns 201 with the attachment metadata; the file is on disk at `${ATTACHMENTS_DIR}/${boardId}/${id}${ext}`.
- [ ] File exceeding `MAX_ATTACHMENT_BYTES` returns 413; no row created, no file written.
- [ ] Disallowed MIME returns 415; no row created.
- [ ] If `storage.put` fails (e.g., disk full simulated), the response is 500 and no `Attachment` row exists.
- [ ] `GET /api/attachments/:id` streams the file with the original `Content-Type` and `Content-Disposition`.
- [ ] Unauthenticated GET returns 401; authenticated user without access to the parent board returns 403.
- [ ] `DELETE /api/boards/:boardId/cards/:cardId/attachments/:attachmentId` returns 204, removes the DB row, removes the file, and emits the event.
- [ ] `Card.attachmentIds` is updated atomically with the attachment row's deletion.
