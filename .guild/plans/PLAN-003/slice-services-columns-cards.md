---
plan: PLAN-003
title: "Columns + cards services"
complexity: 3
---

# Columns + cards services

## Objective

Rewrite `services/columns.ts` and `services/cards.ts` against the native
driver. Replace every Mongoose call (`Column.findOne`, `Card.create`,
`bulkWrite`, `withTransaction` for `deleteCard`, etc.). Swap the
`mongoose.Types.ObjectId` import in `routes/columns.ts` and `routes/cards.ts`
with `ObjectId` from `mongodb`.

## Files to Touch

- `apps/api/src/services/columns.ts` — **rewrite**
- `apps/api/src/services/cards.ts` — **rewrite**
- `apps/api/src/routes/columns.ts` — **modify** (no functional change; the
  `ContextBoard._id` type is already updated by slice-schemas; verify
  no stale imports remain)
- `apps/api/src/routes/cards.ts` — **modify** (replace
  `import type { Types } from "mongoose"` with
  `import type { ObjectId } from "mongodb"`, change `BoardContext._id` to
  `ObjectId`)

## Approach

### `services/columns.ts`

Keep `ColumnSummary` and `toSummary` unchanged — they are output shapes.
Replace every model call:

```ts
import { ObjectId } from "mongodb";
import { columns as columnsColl, cards as cardsColl } from "../db/schemas/index.js";
import { AppError } from "../http/error.js";
import { appendAfter, reorderToMatch } from "../ordering/fractional.js";
import { eventBus } from "../events/bus.js";

export async function createColumn(
    boardId: ObjectId,
    title: string,
): Promise<ColumnSummary> {
    const lastColumn = await columnsColl()
        .find({ boardId })
        .sort({ position: -1 })
        .limit(1)
        .next();
    const position = appendAfter(lastColumn?.position ?? null);

    const now = new Date();
    const insert = await columnsColl().insertOne({
        boardId, title, position, createdAt: now, updatedAt: now,
    } as any);
    const doc = await columnsColl().findOne({ _id: insert.insertedId });
    const summary = toSummary(doc!);

    eventBus.emit({ type: "column.created", boardId: String(boardId), payload: summary });
    return summary;
}

export async function renameColumn(
    boardId: ObjectId, columnId: string, title: string,
): Promise<ColumnSummary> {
    const col = await columnsColl().findOneAndUpdate(
        { _id: new ObjectId(columnId), boardId },
        { $set: { title, updatedAt: new Date() } },
        { returnDocument: "after" },
    );
    if (!col) throw new AppError("NOT_FOUND", "Column not found.");
    const summary = toSummary(col);
    eventBus.emit({ type: "column.updated", boardId: String(boardId), payload: summary });
    return summary;
}

export async function deleteColumn(
    boardId: ObjectId, columnId: string,
): Promise<void> {
    const columnObjId = new ObjectId(columnId);
    const cardCount = await cardsColl().countDocuments({ columnId: columnObjId });
    if (cardCount > 0) {
        throw new AppError("CONFLICT", "Column must be empty before deletion.");
    }
    const result = await columnsColl().deleteOne({ _id: columnObjId, boardId });
    if (result.deletedCount === 0) {
        throw new AppError("NOT_FOUND", "Column not found.");
    }
    eventBus.emit({ type: "column.deleted", boardId: String(boardId), payload: { id: columnId } });
}

export async function reorderColumns(
    boardId: ObjectId, desiredIds: string[],
): Promise<{ orderedIds: string[] }> {
    const currentColumns = await columnsColl()
        .find({ boardId })
        .sort({ position: 1 })
        .toArray();

    if (currentColumns.length !== desiredIds.length) {
        throw new AppError("VALIDATION_ERROR",
            `orderedIds must include every column on the board (got ${desiredIds.length}, expected ${currentColumns.length})`);
    }
    const currentIds = new Set(currentColumns.map((c) => String(c._id)));
    for (const id of desiredIds) {
        if (!currentIds.has(id)) {
            throw new AppError("VALIDATION_ERROR", `Column ID not found on board: ${id}`);
        }
    }

    const updates = reorderToMatch(
        currentColumns.map((c) => ({ _id: String(c._id), position: c.position })),
        desiredIds,
    );

    if (updates.length > 0) {
        await columnsColl().bulkWrite(updates.map((u) => ({
            updateOne: {
                filter: { _id: new ObjectId(u.id) },
                update: { $set: { position: u.position } },
            },
        })));
    }

    eventBus.emit({ type: "columns.reordered", boardId: String(boardId), payload: { orderedIds: desiredIds } });
    return { orderedIds: desiredIds };
}
```

The `boardId` parameter type tightens from `unknown` to `ObjectId` — callers
already pass `c.get("board")._id` which is now typed as `ObjectId`, so no
caller change is required.

### `services/cards.ts`

Same pattern. Key translation points:

| Mongoose | Native |
|----------|--------|
| `Card.findOne({ _id, boardId }).lean()` | `cards().findOne({ _id: new ObjectId(cardId), boardId })` |
| `Card.create({...})` then `card.toObject()` | `cards().insertOne({...})` then `cards().findOne({ _id: insert.insertedId })` |
| `Card.findOneAndUpdate(..., { new: true, runValidators: true })` | `cards().findOneAndUpdate(..., { returnDocument: "after" })` (drop `runValidators` — there are no Mongoose validators anymore) |
| `Card.find({...}).sort({...}).lean()` | `cards().find({...}).sort({...}).toArray()` |
| `Card.updateOne(..., { $pull: {...} })` | `cards().updateOne(..., { $pull: {...} })` (filter values that were strings before may need ObjectId conversion) |
| `await Card.deleteOne(..., { session })` | `await cards().deleteOne(..., { session })` |
| `Attachment.deleteMany({...}, { session })` | `attachmentsColl().deleteMany({...}, { session })` |
| `mongoose.startSession()` + `session.withTransaction(...)` | `withTransaction(async (session) => {...})` |
| `new mongoose.Types.ObjectId(u.id)` | `new ObjectId(u.id)` |

For `deleteCard`, restructure the transaction:

```ts
import { withTransaction } from "../db/connection.js";
...

export async function deleteCard(boardId: ObjectId, cardId: string): Promise<void> {
    const cardObjId = new ObjectId(cardId);
    const card = await cardsColl().findOne({ _id: cardObjId, boardId });
    if (!card) throw new AppError("NOT_FOUND", "Card not found.");

    const columnId = String(card.columnId);

    const attachmentsToDelete = (card.attachmentIds && card.attachmentIds.length > 0)
        ? await attachmentsColl().find({ _id: { $in: card.attachmentIds } }).toArray()
        : [];

    await withTransaction(async (session) => {
        if (attachmentsToDelete.length > 0) {
            await attachmentsColl().deleteMany(
                { _id: { $in: attachmentsToDelete.map((a) => a._id) } },
                { session },
            );
        }
        await cardsColl().deleteOne({ _id: cardObjId }, { session });
    });

    for (const a of attachmentsToDelete) {
        try { await storage.delete(a.storageKey); }
        catch (err) {
            console.error(`[deleteCard] Failed to delete storage file for attachment ${String(a._id)}:`, err);
        }
    }

    eventBus.emit({ type: "card.deleted", boardId: String(boardId), payload: { id: cardId, columnId } });
}
```

For the stale-attachment `$pull` inside `getCard`: the existing code passes
string IDs to `$pull`; with the native driver and `Card.attachmentIds`
typed as `ObjectId[]`, the missing IDs must be wrapped:

```ts
await cardsColl().updateOne(
    { _id: cardObjId },
    { $pull: { attachmentIds: { $in: missingIds.map((id) => new ObjectId(id)) } } },
);
```

For `createCard`, `moveCard`, `updateCard`, `reorderCardsInColumn`: direct
translations. Keep `toSummary` exactly as-is — it's a pure shape mapper that
accepts a duck-typed object.

### `routes/cards.ts`

Replace the type-only import:

```ts
import type { ObjectId } from "mongodb";
...
interface BoardContext { _id: ObjectId; }
```

The `as unknown as BoardContext` cast pattern can stay since
`http/types.ts#ContextBoard` already uses `ObjectId` after slice-schemas
lands; in fact the cast can be removed entirely and replaced with
`c.get("board")` (which is typed `ContextBoard`). Recommended: remove the
local `BoardContext` interface and use `ContextBoard` directly:

```ts
import type { ContextBoard } from "../http/types.js";
...
const board = c.get("board"); // already ContextBoard
const card = await createCard({ boardId: board._id, ... });
```

### `routes/columns.ts`

Already uses `c.get("board") as ContextBoard`. After slice-schemas updates
`ContextBoard._id` to `ObjectId`, no further change is needed unless TS
flags the cast.

## Interface Contract

```ts
// services/columns.ts
import type { ObjectId } from "mongodb";
export interface ColumnSummary { ... } // unchanged
export function createColumn(boardId: ObjectId, title: string): Promise<ColumnSummary>;
export function renameColumn(boardId: ObjectId, columnId: string, title: string): Promise<ColumnSummary>;
export function deleteColumn(boardId: ObjectId, columnId: string): Promise<void>;
export function reorderColumns(boardId: ObjectId, desiredIds: string[]): Promise<{ orderedIds: string[] }>;

// services/cards.ts
export interface CardSummary { ... }   // unchanged
export interface AttachmentMeta { ... } // unchanged
export interface CommentDetail { ... } // unchanged
export interface ChecklistItemDetail { ... } // unchanged
export interface ChecklistDetail { ... } // unchanged
export interface CardDetail extends CardSummary { ... } // unchanged
export interface UpdateCardInput { ... } // unchanged
export function createCard(args: { boardId: ObjectId; columnId: string; title: string }): Promise<CardSummary>;
export function getCard(boardId: ObjectId, cardId: string): Promise<CardDetail>;
export function updateCard(boardId: ObjectId, cardId: string, input: UpdateCardInput): Promise<CardSummary>;
export function moveCard(boardId: ObjectId, cardId: string, targetColumnId: string, position: number): Promise<CardSummary>;
export function reorderCardsInColumn(boardId: ObjectId, columnId: string, orderedIds: string[]): Promise<{ orderedIds: string[] }>;
export function deleteCard(boardId: ObjectId, cardId: string): Promise<void>;
```

The only API-shape change is `boardId: unknown` → `boardId: ObjectId` —
callers (`routes/columns.ts`, `routes/cards.ts`) already pass
`board._id` which is now `ObjectId`-typed, so this is non-breaking.

## Acceptance Criteria

- [ ] `services/columns.ts` and `services/cards.ts` contain zero `mongoose`
      imports.
- [ ] All `bulkWrite` payloads use `new ObjectId(...)` (from `mongodb`).
- [ ] `deleteCard` uses `withTransaction` from `db/connection.js`; the
      transaction body matches the current ordering: delete attachment rows,
      then delete the card; storage files are deleted only after the
      transaction commits.
- [ ] `getCard` stale-attachment cleanup wraps missing IDs in `ObjectId`
      before the `$pull` query.
- [ ] `routes/cards.ts` imports `ObjectId` from `mongodb` (not `mongoose`)
      and `BoardContext._id` is typed `ObjectId`.
- [ ] `routes/columns.ts` no longer references `mongoose` (it only imports
      `ContextBoard` today, but verify).
- [ ] Existing HTTP behaviour (404 vs 409 for non-empty column delete,
      404 for missing card, 422 for wrong-length reorder) is preserved
      byte-for-byte.
- [ ] `pnpm --filter @kata/api check` passes for all files in this slice.
