---
plan: PLAN-002
slice: cards-routes
title: "Card CRUD, move between columns, reorder within column"
complexity: 3
---

# Card CRUD, move between columns, reorder within column

## Goal

Implement create, fetch, edit (title + description + dueDate), move (to another column), reorder (within a column), and delete operations for cards. Deletion cascades to attachments (DB rows and stored files). All mutations emit events.

This slice is the core write path of the kanban experience; getting positions, cascade deletes, and the cross-column move right is the bulk of the work.

## Files to Create / Modify

- `apps/api/src/routes/cards.ts` — create.
- `apps/api/src/services/cards.ts` — create. `createCard`, `getCard`, `updateCard`, `moveCard`, `reorderCardsInColumn`, `deleteCard`.
- `apps/api/src/app.ts` — modify. Mount under `/api/boards/:boardId`.

## Route map

| Method | Path | Guard |
|--------|------|-------|
| POST   | `/api/boards/:boardId/columns/:columnId/cards` | any board access |
| PATCH  | `/api/boards/:boardId/columns/:columnId/cards/reorder` | any board access |
| GET    | `/api/boards/:boardId/cards/:cardId` | any board access |
| PATCH  | `/api/boards/:boardId/cards/:cardId/move` | any board access |
| PATCH  | `/api/boards/:boardId/cards/:cardId` | any board access |
| DELETE | `/api/boards/:boardId/cards/:cardId` | any board access |

"any board access" means `requireSession` + `loadBoardAccess`. Card mutations are open to all members per US-6.

## Implementation Steps

### Router

```ts
const r = new Hono();
r.use('*', requireSession, loadBoardAccess);

r.post('/columns/:columnId/cards',
  zValidator('json', z.object({ title: z.string().min(1).max(500) })),
  async (c) => created(c, await createCard({
    boardId: c.get('board')._id,
    columnId: c.req.param('columnId'),
    title: c.req.valid('json').title
  })));

r.patch('/columns/:columnId/cards/reorder',
  zValidator('json', z.object({ orderedIds: z.array(z.string()).min(1) })),
  async (c) => ok(c, await reorderCardsInColumn(
    c.get('board')._id, c.req.param('columnId'), c.req.valid('json').orderedIds)));

r.get('/cards/:cardId', async (c) => ok(c, await getCard(c.get('board')._id, c.req.param('cardId'))));

r.patch('/cards/:cardId/move',
  zValidator('json', z.object({
    targetColumnId: z.string(),
    position: z.number().int().min(0)
  })),
  async (c) => ok(c, await moveCard(
    c.get('board')._id, c.req.param('cardId'),
    c.req.valid('json').targetColumnId, c.req.valid('json').position)));

r.patch('/cards/:cardId',
  zValidator('json', z.object({
    title:       z.string().min(1).max(500).optional(),
    description: z.string().max(50000).nullable().optional(),
    dueDate:     z.string().datetime().nullable().optional()
  })),
  async (c) => ok(c, await updateCard(c.get('board')._id, c.req.param('cardId'), c.req.valid('json'))));

r.delete('/cards/:cardId', async (c) => {
  await deleteCard(c.get('board')._id, c.req.param('cardId'));
  return noContent(c);
});
```

### Service: `createCard`

1. Verify the target column exists and belongs to the board.
2. Find last card in column: `Card.findOne({ columnId }).sort({ position: -1 })`.
3. Compute new position via `appendAfter(last?.position ?? null)`.
4. Insert with empty arrays for labelIds, assigneeIds, attachmentIds, comments, checklists; null dueDate.
5. Emit `card.created`.
6. Return the full card document.

### Service: `getCard`

Fetch the card scoped by `{ _id: cardId, boardId }`. Throw 404 if missing. Resolve attachments via a separate `Attachment.find({ _id: { $in: card.attachmentIds } })` query and merge metadata into the response. Return the full detail shape used by US-8 / US-9 / US-10 (`comments`, `checklists`, `attachments`, etc.).

### Service: `updateCard`

1. Convert ISO `dueDate` string → `Date` (or `null` for clear). `z.string().datetime()` ensures format; explicit `null` is allowed by the schema for clear.
2. `Card.findOneAndUpdate({ _id, boardId }, { $set: patch }, { new: true, runValidators: true })`.
3. Emit `card.updated`.

### Service: `moveCard`

1. Verify the card exists and belongs to the board (404 otherwise).
2. Verify the target column belongs to the board (404 otherwise — US-6 edge case).
3. Fetch the target column's cards sorted by position, excluding the moving card.
4. Clamp the desired `position` index: `Math.min(position, targetCards.length)` — appends if out of range, per US-6 edge case.
5. Compute new position via `insertBetween(prev?.position ?? null, next?.position ?? null)`.
6. Update card: `{ columnId: targetColumnId, position: newPos }`.
7. Emit `card.moved` with `{ id, fromColumnId, toColumnId, position }`.
8. Return the updated card.

### Service: `reorderCardsInColumn`

Mirrors column reorder. Fetch cards in the column, verify set match, compute updates via `reorderToMatch`, bulkWrite. Emit `cards.reordered` with `{ columnId, orderedIds }`.

### Service: `deleteCard`

1. Fetch the card scoped by board. 404 if missing.
2. For each attachment id, call `storage.delete(attachmentRecord.storageKey)` then delete the `Attachment` row. Log and continue per-attachment on storage failure (the DB row still goes).
3. Delete the card.
4. Emit `card.deleted` with `{ id, columnId }`.

All steps wrapped in a Mongo transaction. File deletes happen after the transaction commits to avoid orphaning data on rollback. If a file delete fails post-commit, log it; the row is gone but the file lingers — acceptable trade-off.

## Interface Contract

Exposed:

- Card list-summary shape returned by `createCard` and used in board listings: `{ id, boardId, columnId, title, position, dueDate, labelIds, assigneeIds, attachmentIds, commentsCount, checklistsCount, createdAt, updatedAt }`.
- Card detail shape returned by `getCard`: list-summary + `description`, `comments[]`, `checklists[]`, `attachments[]` (metadata).

Consumes:

- `requireSession`, `loadBoardAccess` from auth slice.
- `Card`, `Column`, `Attachment`, `Board` models.
- `appendAfter`, `insertBetween`, `reorderToMatch`, `eventBus`, `AppError`, `zValidator`, `ok/created/noContent` from primitives.
- `storage` singleton from primitives (for cascade delete).

Events emitted:

- `card.created`, `card.updated`, `card.moved`, `card.deleted`, `cards.reordered`.

The card-detail slice (comments/checklists/labels/assignees) and attachments slice will append to the card via separate routes; they share the `Card` model and emit their own events. They do not call into this slice's services.

## Acceptance Criteria

- [ ] `POST /api/boards/:boardId/columns/:columnId/cards` with `{ "title": "..." }` returns 201 and the card is at the end of the column.
- [ ] `PATCH /api/boards/:boardId/cards/:cardId` with `{ "title", "description" }` partial — only provided fields are written.
- [ ] `PATCH .../cards/:cardId` with `{ "dueDate": null }` clears the due date.
- [ ] `PATCH .../cards/:cardId/move` to a column on the same board reassigns `columnId` and updates `position`.
- [ ] `PATCH .../cards/:cardId/move` with `targetColumnId` belonging to another board OR not existing returns 404.
- [ ] `position` beyond the column length appends instead of erroring.
- [ ] `PATCH /columns/:columnId/cards/reorder` updates positions; missing IDs return 422.
- [ ] `DELETE /api/boards/:boardId/cards/:cardId` removes the card and deletes attachment rows + stored files.
- [ ] A user with no access to the board (signed in but not a member of the team / not the personal owner) gets 403 on every card endpoint.
- [ ] Each mutation emits the expected event with the correct `boardId`.
