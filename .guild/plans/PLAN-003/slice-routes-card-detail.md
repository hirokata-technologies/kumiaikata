---
plan: PLAN-003
title: "Card-detail route rewrites"
complexity: 2
---

# Card-detail route rewrites

## Objective

Rewrite the four card-detail route files that inline Mongoose calls:
`routes/card-comments.ts`, `routes/card-checklists.ts`,
`routes/card-assignees.ts`, `routes/card-labels.ts`. Replace Mongoose
subdocument helpers (`card.comments.id()`, `comment.deleteOne()`,
`card.save()`) with native positional-operator updates and projection-based
reads. Preserve every HTTP status code and JSON shape exactly.

## Files to Touch

- `apps/api/src/routes/card-comments.ts` — **rewrite**
- `apps/api/src/routes/card-checklists.ts` — **rewrite**
- `apps/api/src/routes/card-assignees.ts` — **rewrite**
- `apps/api/src/routes/card-labels.ts` — **rewrite**

## Approach

Common pattern: replace `import mongoose from "mongoose"` and
`import { Card, Label, TeamMember } from "../db/models/index.js"` with
`import { ObjectId } from "mongodb"` and the typed accessors from
`../db/schemas/index.js`.

ObjectId construction stays funneled through `validateObjectId` followed by
`new ObjectId(...)`. Subdocument `_id` generation uses `new ObjectId()`.

### `routes/card-comments.ts`

- **POST /** — Push a new comment subdocument. Mongoose used
  `Card.updateOne` with `$push`; the native version is identical:

  ```ts
  const board = c.get("board");
  const user = c.get("user");
  const cardId = new ObjectId(validateObjectId(c.req.param("cardId"), "cardId"));

  const comment = {
      _id: new ObjectId(),
      authorId: new ObjectId(user.id), // see ID note (provisioning) if user.id is not 24-hex
      body: c.req.valid("json").body,
      createdAt: new Date(),
  };

  const result = await cards().updateOne(
      { _id: cardId, boardId: board._id },
      { $push: { comments: comment } },
  );
  if (result.matchedCount === 0) throw new AppError("NOT_FOUND", "Card not found.");

  const payload = {
      id: String(comment._id),
      authorId: String(comment.authorId),
      body: comment.body,
      createdAt: comment.createdAt,
  };
  eventBus.emit({ type: "card.comment.created", boardId: String(board._id), payload: { cardId: String(cardId), comment: payload } });
  return created(c, payload);
  ```

  **Important**: the `cardId` in the SSE payload was a string in the
  Mongoose version (the raw route param). Preserve that by emitting
  `String(cardId)` (or the original `c.req.param("cardId")` string) — do
  not emit the `ObjectId` instance.

- **PATCH /:commentId** — Two-stage check: existence (404) then author
  match (403). Native version:

  ```ts
  const commentObjId = new ObjectId(validateObjectId(c.req.param("commentId"), "commentId"));
  const cardId = new ObjectId(validateObjectId(c.req.param("cardId"), "cardId"));

  const exists = await cards().findOne(
      { _id: cardId, boardId: board._id, "comments._id": commentObjId },
      { projection: { _id: 1 } },
  );
  if (!exists) throw new AppError("NOT_FOUND", "Card or comment not found.");

  const updatedAt = new Date();
  const updated = await cards().findOneAndUpdate(
      {
          _id: cardId,
          boardId: board._id,
          "comments._id": commentObjId,
          "comments.authorId": new ObjectId(user.id),
      },
      {
          $set: {
              "comments.$.body": c.req.valid("json").body,
              "comments.$.updatedAt": updatedAt,
          },
      },
      {
          returnDocument: "after",
          projection: { comments: { $elemMatch: { _id: commentObjId } } },
      },
  );
  if (!updated) throw new AppError("FORBIDDEN", "Only the author may edit this comment.");

  const comment = updated.comments?.[0];
  if (!comment) throw new AppError("NOT_FOUND", "Comment not found.");

  const payload = {
      id: String(comment._id),
      authorId: String(comment.authorId),
      body: comment.body,
      createdAt: comment.createdAt,
      ...(comment.updatedAt && { updatedAt: comment.updatedAt }),
  };
  ```

  Note: the `$elemMatch` projection returns only the matching comment in
  the `comments` array, so `updated.comments[0]` is the one we just
  updated. The conditional spread on `updatedAt` honours
  `exactOptionalPropertyTypes`.

- **DELETE /:commentId** — Permission depends on author OR board admin. The
  Mongoose version did `card.comments.id(commentId)` to inspect the author
  client-side. Native: fetch the comment via projection, decide, then
  `$pull`.

  ```ts
  const commentObjId = new ObjectId(validateObjectId(c.req.param("commentId"), "commentId"));
  const cardId = new ObjectId(validateObjectId(c.req.param("cardId"), "cardId"));

  const card = await cards().findOne(
      { _id: cardId, boardId: board._id },
      { projection: { comments: { $elemMatch: { _id: commentObjId } } } },
  );
  if (!card) throw new AppError("NOT_FOUND", "Card not found.");
  const comment = card.comments?.[0];
  if (!comment) throw new AppError("NOT_FOUND", "Comment not found.");

  const isAuthor = String(comment.authorId) === String(user.id);
  const isAdmin = access.kind === "team-admin" || access.kind === "personal-owner";
  if (!isAuthor && !isAdmin) {
      throw new AppError("FORBIDDEN", "Only the comment author or a board admin may delete this comment.");
  }

  await cards().updateOne(
      { _id: cardId },
      { $pull: { comments: { _id: commentObjId } } },
  );

  eventBus.emit({ type: "card.comment.deleted", boardId: String(board._id), payload: { cardId: String(cardId), commentId: String(commentObjId) } });
  return noContent(c);
  ```

### `routes/card-checklists.ts`

Translate every Mongoose pattern. Key transformations:

- `Card.updateOne({...}, { $push: { checklists: {...} } })` → identical with
  native driver.
- `Card.findOneAndUpdate({..., "checklists._id": cid}, { $push: { "checklists.$.items": {...} } })`
  → identical, just use `returnDocument: "after"` + `$elemMatch` projection
  to extract the inserted item.
- `card.checklists.id(checklistId)` + `checklist.items.id(itemId)` → either
  a projection-based fetch or two-level `arrayFilters`:

  ```ts
  // PATCH item
  const updated = await cards().findOneAndUpdate(
      { _id: cardId, boardId: board._id },
      {
          $set: {
              ...(input.text !== undefined && { "checklists.$[c].items.$[i].text": input.text }),
              ...(input.checked !== undefined && { "checklists.$[c].items.$[i].checked": input.checked }),
          },
      },
      {
          arrayFilters: [{ "c._id": checklistObjId }, { "i._id": itemObjId }],
          returnDocument: "after",
          projection: {
              checklists: { $elemMatch: { _id: checklistObjId } },
          },
      },
  );
  if (!updated) throw new AppError("NOT_FOUND", "Card not found.");
  const checklist = updated.checklists?.[0];
  const item = checklist?.items.find((i) => String(i._id) === String(itemObjId));
  if (!item) throw new AppError("NOT_FOUND", "Checklist item not found.");
  ```

  The `$set` payload must include at least one key (zod validator ensures
  this — but a defensive check is fine). If `input` is empty, skip the
  update and 422 (matches current Mongoose behaviour which would no-op
  silently — verify by reading the existing test expectations; if no test,
  the current behaviour is the spec).

- `item.deleteOne()` + `card.save()` → single `$pull` against the inner
  array using positional `$`:

  ```ts
  // DELETE item — two-step: confirm existence, then pull
  const exists = await cards().findOne(
      {
          _id: cardId, boardId: board._id,
          "checklists._id": checklistObjId,
          "checklists.items._id": itemObjId,
      },
      { projection: { _id: 1 } },
  );
  if (!exists) {
      // distinguish 404 reason
      const cardExists = await cards().findOne(
          { _id: cardId, boardId: board._id },
          { projection: { _id: 1 } },
      );
      if (!cardExists) throw new AppError("NOT_FOUND", "Card not found.");
      // ... etc to match current 404 messages
  }
  await cards().updateOne(
      { _id: cardId, "checklists._id": checklistObjId },
      { $pull: { "checklists.$.items": { _id: itemObjId } } },
  );
  ```

  Preserve the four distinct 404 messages the Mongoose code emits
  ("Card not found", "Checklist not found", "Checklist item not found",
  "Card or checklist not found").

- `DELETE /:checklistId` — `$pull` the whole checklist:

  ```ts
  const card = await cards().findOne(
      { _id: cardId, boardId: board._id },
      { projection: { checklists: { $elemMatch: { _id: checklistObjId } } } },
  );
  if (!card) throw new AppError("NOT_FOUND", "Card not found.");
  if (!card.checklists || card.checklists.length === 0) {
      throw new AppError("NOT_FOUND", "Checklist not found.");
  }
  await cards().updateOne(
      { _id: cardId },
      { $pull: { checklists: { _id: checklistObjId } } },
  );
  ```

### `routes/card-assignees.ts`

`TeamMember.exists` → `teamMembers().findOne({...}, { projection: { _id: 1 } })`.
`$addToSet` and `$pull` translate verbatim. ObjectId wrapping for
`assigneeIds` writes — these were stored as `Schema.Types.ObjectId`, so
write `new ObjectId(userId)`.

### `routes/card-labels.ts`

`Label.findOne({...}).lean()` → `labels().findOne({...})`. Note the existing
code references `label._id` after the lean call (an `ObjectId`); native
returns the same. `$addToSet`/`$pull` translate verbatim.

## Interface Contract

These are leaf-level Hono routers; they export `default r` (a Hono
instance) and do not publish any other API.

Mounting in `app.ts` is unchanged.

Event payloads must match the current shapes exactly:
- `card.comment.created/updated/deleted` → `{ cardId: string, comment?: {...}, commentId?: string }`
- `card.checklist.created/updated/deleted` → `{ cardId: string, checklist?: {...}, checklistId?: string, item?: {...}, itemId?: string }`
- `card.assignee.added/removed` → `{ cardId: string, userId: string }`
- `card.label.added/removed` → `{ cardId: string, labelId: string }`

In every payload, IDs are **strings** (not `ObjectId` instances).

## Acceptance Criteria

- [ ] Each of the four route files contains zero `mongoose` imports.
- [ ] Subdocument reads use either `findOne({...}, { projection: {...} })`
      + `$elemMatch` or `arrayFilters`, not Mongoose's `doc.subarray.id()`.
- [ ] Subdocument writes use positional `$` operators (`$pull`, `$push`,
      `$set` with `arrayFilters`).
- [ ] Every existing HTTP status code is preserved:
  - [ ] Comment edit: 404 for missing card/comment, 403 for wrong author,
        200 with updated payload otherwise.
  - [ ] Comment delete: 404 for missing card or comment, 403 for
        non-author non-admin, 204 otherwise.
  - [ ] Checklist delete: 404 for missing card or checklist, 204 otherwise.
  - [ ] Checklist item add/patch/delete: distinct 404 messages match
        current strings.
  - [ ] Assignee add: 422 for invalid team membership / personal-board
        owner mismatch, 404 for missing card, 200 otherwise.
  - [ ] Label add: 422 for label not on board, 404 for missing card.
- [ ] Event payload shapes (IDs as strings) match current shapes verbatim.
- [ ] `pnpm --filter @kata/api check` passes for these four files.
