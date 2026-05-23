---
plan: PLAN-002
slice: card-detail-routes
title: "Card sub-resources: comments, checklists, assignees, labels; board-level labels CRUD"
complexity: 2
---

# Card sub-resources & board-level labels

## Goal

Implement every endpoint that operates on a card's nested data (comments, checklists, assignees, labels) plus the board-scoped label CRUD that backs the label-association endpoints. Each mutation emits the appropriate `BoardEvent`.

## Files to Create / Modify

- `apps/api/src/routes/card-comments.ts`
- `apps/api/src/routes/card-checklists.ts`
- `apps/api/src/routes/card-assignees.ts`
- `apps/api/src/routes/card-labels.ts`
- `apps/api/src/routes/labels.ts` — board-level label CRUD.
- `apps/api/src/services/labels.ts`
- `apps/api/src/app.ts` — modify. Mount all five routers.

(Splitting into multiple route files keeps each file small and matches the resource boundaries. Services that are trivial — single function — live next to the route. `labels.ts` is large enough to deserve a service file.)

## Route map

| Method | Path | Guard | Notes |
|--------|------|-------|-------|
| POST   | `/api/boards/:boardId/labels` | `requireBoardAdmin` | US-11 #1 |
| PATCH  | `/api/boards/:boardId/labels/:labelId` | `requireBoardAdmin` | US-11 #2 |
| DELETE | `/api/boards/:boardId/labels/:labelId` | `requireBoardAdmin` | US-11 #3 — also pulls labelId from `cards.labelIds` |
| POST   | `/api/boards/:boardId/cards/:cardId/labels` | any board access | US-11 #4 |
| DELETE | `/api/boards/:boardId/cards/:cardId/labels/:labelId` | any board access | US-11 #5 |
| POST   | `/api/boards/:boardId/cards/:cardId/comments` | any board access | US-8 #1 |
| PATCH  | `/api/boards/:boardId/cards/:cardId/comments/:commentId` | any (with author/admin check) | US-8 #2, #3 |
| DELETE | `/api/boards/:boardId/cards/:cardId/comments/:commentId` | any (with author/admin check) | US-8 #4 |
| POST   | `/api/boards/:boardId/cards/:cardId/checklists` | any | US-9 #1 |
| DELETE | `/api/boards/:boardId/cards/:cardId/checklists/:checklistId` | any | US-9 #5 |
| POST   | `/api/boards/:boardId/cards/:cardId/checklists/:checklistId/items` | any | US-9 #2 |
| PATCH  | `/api/boards/:boardId/cards/:cardId/checklists/:checklistId/items/:itemId` | any | US-9 #3, #4 |
| DELETE | `/api/boards/:boardId/cards/:cardId/checklists/:checklistId/items/:itemId` | any | (implied for symmetry; harmless if dropped — confirm with requirement, US-9 does not list it explicitly) |
| POST   | `/api/boards/:boardId/cards/:cardId/assignees` | any | US-7 #3 |
| DELETE | `/api/boards/:boardId/cards/:cardId/assignees/:userId` | any | US-7 #4 |

## Implementation Steps

### Labels (board-level)

```ts
// labels.ts
const r = new Hono();
r.use('*', requireSession, loadBoardAccess);

const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
const nameField = z.string().min(1).max(50);

r.post('/', requireBoardAdmin,
  zValidator('json', z.object({ name: nameField, color: hexColor })),
  async (c) => created(c, await createLabel(c.get('board')._id, c.req.valid('json'))));

r.patch('/:labelId', requireBoardAdmin,
  zValidator('json', z.object({ name: nameField.optional(), color: hexColor.optional() })),
  async (c) => ok(c, await updateLabel(c.get('board')._id, c.req.param('labelId'), c.req.valid('json'))));

r.delete('/:labelId', requireBoardAdmin, async (c) => {
  await deleteLabel(c.get('board')._id, c.req.param('labelId'));
  return noContent(c);
});
```

`deleteLabel` runs `Card.updateMany({ boardId, labelIds: labelId }, { $pull: { labelIds: labelId } })` then deletes the label row, in a transaction.

### Card labels (association)

```ts
// card-labels.ts
const r = new Hono();
r.use('*', requireSession, loadBoardAccess);

r.post('/', zValidator('json', z.object({ labelId: z.string() })), async (c) => {
  const { labelId } = c.req.valid('json');
  const label = await Label.findOne({ _id: labelId, boardId: c.get('board')._id });
  if (!label) throw new AppError('VALIDATION_ERROR', 'Label does not belong to this board.');
  await Card.updateOne(
    { _id: c.req.param('cardId'), boardId: c.get('board')._id },
    { $addToSet: { labelIds: labelId } }
  );
  eventBus.emit({ type: 'card.label.added', boardId: ..., payload: { cardId, labelId } });
  return ok(c, { cardId: c.req.param('cardId'), labelId });
});

r.delete('/:labelId', async (c) => {
  await Card.updateOne(
    { _id: c.req.param('cardId'), boardId: c.get('board')._id },
    { $pull: { labelIds: c.req.param('labelId') } }
  );
  eventBus.emit({ type: 'card.label.removed', ... });
  return noContent(c);
});
```

Mount path: `/api/boards/:boardId/cards/:cardId/labels`.

### Comments

```ts
// card-comments.ts
r.post('/', zValidator('json', z.object({ body: z.string().min(1).max(10000) })),
  async (c) => {
    const user = c.get('user');
    const comment = { _id: new mongoose.Types.ObjectId(), authorId: user.id, body: c.req.valid('json').body, createdAt: new Date() };
    const res = await Card.updateOne(
      { _id: c.req.param('cardId'), boardId: c.get('board')._id },
      { $push: { comments: comment } }
    );
    if (res.matchedCount === 0) throw new AppError('NOT_FOUND', 'Card not found.');
    eventBus.emit({ type: 'card.comment.created', ... });
    return created(c, { id: String(comment._id), authorId: comment.authorId, body: comment.body, createdAt: comment.createdAt });
  });

r.patch('/:commentId', zValidator('json', z.object({ body: z.string().min(1).max(10000) })),
  async (c) => {
    const card = await Card.findOne({ _id: ..., boardId: ... });
    if (!card) throw new AppError('NOT_FOUND', ...);
    const comment = card.comments.id(c.req.param('commentId'));
    if (!comment) throw new AppError('NOT_FOUND', 'Comment not found.');
    if (String(comment.authorId) !== String(c.get('user').id)) {
      throw new AppError('FORBIDDEN', 'Only the author may edit this comment.');
    }
    comment.body = c.req.valid('json').body;
    comment.updatedAt = new Date();
    await card.save();
    eventBus.emit({ type: 'card.comment.updated', ... });
    return ok(c, /* serialised comment */);
  });

r.delete('/:commentId', async (c) => {
  const card = await Card.findOne({ ... });
  const comment = card?.comments.id(commentId);
  if (!comment) throw new AppError('NOT_FOUND', ...);
  const access = c.get('access');
  const isAuthor = String(comment.authorId) === String(c.get('user').id);
  const isAdmin = access.kind === 'team-admin' || access.kind === 'personal-owner';
  if (!isAuthor && !isAdmin) throw new AppError('FORBIDDEN', ...);
  comment.deleteOne();
  await card.save();
  eventBus.emit({ type: 'card.comment.deleted', ... });
  return noContent(c);
});
```

### Checklists

Use the same Mongoose subdoc `.id()` pattern. Checklist create/delete operate on `card.checklists`; item create/update/delete navigate `card.checklists.id(checklistId).items`. Validate `text` non-empty (1–1000 chars).

### Assignees

```ts
r.post('/', zValidator('json', z.object({ userId: z.string() })), async (c) => {
  const board = c.get('board');
  const { userId } = c.req.valid('json');
  // For team boards: verify target user belongs to the team (US-7 edge case).
  if (board.kind === 'team') {
    const isMember = await TeamMember.exists({ teamId: board.teamId, userId });
    if (!isMember) throw new AppError('VALIDATION_ERROR', 'User is not a member of this board\'s team.');
  } else {
    // Personal board: only owner may be assigned.
    if (String(board.ownerId) !== String(userId)) {
      throw new AppError('VALIDATION_ERROR', 'Only the board owner may be assigned on a personal board.');
    }
  }
  await Card.updateOne(
    { _id: c.req.param('cardId'), boardId: board._id },
    { $addToSet: { assigneeIds: userId } }
  );
  eventBus.emit({ type: 'card.assignee.added', ... });
  return ok(c, { cardId: c.req.param('cardId'), userId });
});

r.delete('/:userId', async (c) => {
  await Card.updateOne(
    { _id: c.req.param('cardId'), boardId: c.get('board')._id },
    { $pull: { assigneeIds: c.req.param('userId') } }
  );
  eventBus.emit({ type: 'card.assignee.removed', ... });
  return noContent(c);
});
```

`POST` is idempotent thanks to `$addToSet`.

## Interface Contract

Exposed:

- `Label` response shape: `{ id, boardId, name, color }`.
- Comment shape: `{ id, authorId, body, createdAt, updatedAt? }`.
- Checklist shape: `{ id, title, items: [{ id, text, checked }] }`.
- These are the same shapes returned by `getCard` (cards slice). Both slices reach the same data — keep field names identical.

Consumes:

- Auth middleware (`requireSession`, `loadBoardAccess`, `requireBoardAdmin`).
- `Card`, `Label`, `TeamMember`, `Board` models.
- Primitives (`AppError`, `zValidator`, responders, `eventBus`).

Events emitted:

- `label.created`, `label.updated`, `label.deleted`
- `card.label.added`, `card.label.removed`
- `card.comment.created`, `card.comment.updated`, `card.comment.deleted`
- `card.checklist.created`, `card.checklist.updated`, `card.checklist.deleted`
- `card.assignee.added`, `card.assignee.removed`

## Acceptance Criteria

- [ ] Board label CRUD requires admin/owner; member gets 403.
- [ ] Deleting a label removes it from every card's `labelIds` on that board.
- [ ] Hex color validation rejects `#xyz`, `#1234`, etc. with 422.
- [ ] Comment edit by non-author returns 403; comment delete by author OR admin/owner returns 204.
- [ ] Empty comment body returns 422; body > 10000 chars returns 422.
- [ ] Checklist item edits flip `checked` and update `text` independently.
- [ ] Assignee add for a non-team-member (team board) returns 422; for the personal board, only the owner can be assigned.
- [ ] Idempotent operations (re-add same label, re-add same assignee) return 200 without duplicates.
- [ ] Every mutation emits exactly one event with the correct type and board id.
