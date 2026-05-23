---
plan: PLAN-002
slice: columns-routes
title: "Column CRUD and reorder"
complexity: 2
---

# Column CRUD and reorder

## Goal

Implement create / rename / delete / reorder of columns under a board. All mutations are admin/owner-only and emit `BoardEvent`s.

## Files to Create / Modify

- `apps/api/src/routes/columns.ts` — create.
- `apps/api/src/services/columns.ts` — create. `createColumn`, `renameColumn`, `deleteColumn`, `reorderColumns`.
- `apps/api/src/app.ts` — modify. Mount under `/api/boards/:boardId/columns`.

## Route map

| Method | Path | Guard |
|--------|------|-------|
| POST   | `/api/boards/:boardId/columns` | `requireBoardAdmin` |
| PATCH  | `/api/boards/:boardId/columns/reorder` | `requireBoardAdmin` |
| PATCH  | `/api/boards/:boardId/columns/:columnId` | `requireBoardAdmin` |
| DELETE | `/api/boards/:boardId/columns/:columnId` | `requireBoardAdmin` |

`reorder` is defined before `:columnId` so Hono matches it as a literal segment.

## Implementation Steps

### Router

```ts
const r = new Hono();
r.use('*', requireSession, loadBoardAccess);

r.post('/', requireBoardAdmin,
  zValidator('json', z.object({ title: z.string().min(1).max(120) })),
  async (c) => {
    const col = await createColumn(c.get('board')._id, c.req.valid('json').title);
    return created(c, col);
  });

r.patch('/reorder', requireBoardAdmin,
  zValidator('json', z.object({ orderedIds: z.array(z.string()).min(1) })),
  async (c) => {
    const result = await reorderColumns(c.get('board')._id, c.req.valid('json').orderedIds);
    return ok(c, result);
  });

r.patch('/:columnId', requireBoardAdmin,
  zValidator('json', z.object({ title: z.string().min(1).max(120) })),
  async (c) => {
    const col = await renameColumn(c.get('board')._id, c.req.param('columnId'), c.req.valid('json').title);
    return ok(c, col);
  });

r.delete('/:columnId', requireBoardAdmin, async (c) => {
  await deleteColumn(c.get('board')._id, c.req.param('columnId'));
  return noContent(c);
});
```

### Service: `createColumn`

1. Find the last column on the board: `Column.findOne({ boardId }).sort({ position: -1 })`.
2. Compute new position via `appendAfter(last?.position ?? null)`.
3. Insert.
4. Emit `{ type: 'column.created', boardId, payload: <serialised column> }`.
5. Return the column.

### Service: `renameColumn`

1. `Column.findOneAndUpdate({ _id, boardId }, { title }, { new: true })`. Throw `NOT_FOUND` if null.
2. Emit `{ type: 'column.updated', boardId, payload: column }`.
3. Return column.

### Service: `deleteColumn`

1. Check `Card.countDocuments({ columnId })`. If > 0 throw `AppError('CONFLICT', 'Column must be empty before deletion.')` (US-5 #4).
2. Delete column. Throw `NOT_FOUND` if `deletedCount === 0`.
3. Emit `{ type: 'column.deleted', boardId, payload: { id: columnId } }`.

### Service: `reorderColumns`

1. Fetch all columns on the board.
2. Validate `desiredIds.length === current.length` and that the sets match. If not, `VALIDATION_ERROR` (US-5 edge case).
3. Call `reorderToMatch(current, desiredIds)`.
4. Apply all updates in a single Mongo `bulkWrite` of `updateOne` operations.
5. Emit `{ type: 'columns.reordered', boardId, payload: { orderedIds: desiredIds } }`.
6. Return `{ orderedIds }`.

## Interface Contract

Exposed:

- Column response shape: `{ id, boardId, title, position, createdAt, updatedAt }`. The card slice depends on this shape (e.g., when inserting a card it does not need to mutate a column, but the SSE consumer types do).

Consumes:

- `requireSession`, `loadBoardAccess`, `requireBoardAdmin` from auth slice.
- `Column`, `Card`, `Board` models.
- `appendAfter`, `reorderToMatch`, `eventBus`, `AppError`, `zValidator`, `ok/created/noContent` from primitives.

Events emitted to bus:

- `column.created`, `column.updated`, `column.deleted`, `columns.reordered`.

## Acceptance Criteria

- [ ] `POST /api/boards/:boardId/columns` with `{ "title": "In Progress" }` returns 201 and the column with a generated `position`.
- [ ] `PATCH /api/boards/:boardId/columns/:columnId` renames; returns 200.
- [ ] `DELETE /api/boards/:boardId/columns/:columnId` returns 204 when the column has no cards.
- [ ] `DELETE` on a non-empty column returns 409.
- [ ] `PATCH /api/boards/:boardId/columns/reorder` with the full set of IDs in new order updates positions and returns 200.
- [ ] `PATCH .../reorder` with a missing or extra ID returns 422.
- [ ] A team-member (non-admin) performing any of the above mutations on a team board gets 403.
- [ ] Each successful mutation triggers exactly one matching `BoardEvent` on the bus for the board.
