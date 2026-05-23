---
plan: PLAN-003
title: "Labels + attachments services"
complexity: 2
---

# Labels + attachments services

## Objective

Rewrite `services/labels.ts` and `services/attachments.ts` against the
native driver. Replace the two `withTransaction` blocks in attachments and
the one in labels. Update `routes/labels.ts`, `routes/card-attachments.ts`,
and `routes/attachments.ts` to drop any `mongoose` references.

## Files to Touch

- `apps/api/src/services/labels.ts` — **rewrite**
- `apps/api/src/services/attachments.ts` — **rewrite**
- `apps/api/src/routes/labels.ts` — **modify** (no functional change;
  verify after compile)
- `apps/api/src/routes/card-attachments.ts` — **modify** (swap
  `import type { Types } from "mongoose"` for
  `import type { ObjectId } from "mongodb"`)
- `apps/api/src/routes/attachments.ts` — **modify** (no functional change;
  verify)

## Approach

### `services/labels.ts`

```ts
import { ObjectId } from "mongodb";
import { withTransaction } from "../db/connection.js";
import { cards as cardsColl, labels as labelsColl } from "../db/schemas/index.js";
import { AppError } from "../http/error.js";
import { eventBus } from "../events/bus.js";

export interface LabelDetail { ... } // unchanged
function toDetail(label): LabelDetail { ... } // unchanged

export async function createLabel(
    boardId: ObjectId,
    input: { name: string; color: string },
): Promise<LabelDetail> {
    const insert = await labelsColl().insertOne({
        boardId, name: input.name, color: input.color,
    } as any);
    const doc = await labelsColl().findOne({ _id: insert.insertedId });
    const detail = toDetail(doc!);
    eventBus.emit({ type: "label.created", boardId: String(boardId), payload: detail });
    return detail;
}

export async function updateLabel(
    boardId: ObjectId, labelId: string,
    input: { name?: string; color?: string },
): Promise<LabelDetail> {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.color !== undefined) patch.color = input.color;

    const label = await labelsColl().findOneAndUpdate(
        { _id: new ObjectId(labelId), boardId },
        { $set: patch },
        { returnDocument: "after" },
    );
    if (!label) throw new AppError("NOT_FOUND", "Label not found.");
    const detail = toDetail(label);
    eventBus.emit({ type: "label.updated", boardId: String(boardId), payload: detail });
    return detail;
}

export async function deleteLabel(
    boardId: ObjectId, labelId: string,
): Promise<void> {
    const labelObjId = new ObjectId(labelId);
    const label = await labelsColl().findOne({ _id: labelObjId, boardId });
    if (!label) throw new AppError("NOT_FOUND", "Label not found.");

    await withTransaction(async (session) => {
        await cardsColl().updateMany(
            { boardId, labelIds: labelObjId },
            { $pull: { labelIds: labelObjId } },
            { session },
        );
        await labelsColl().deleteOne({ _id: labelObjId }, { session });
    });

    eventBus.emit({
        type: "label.deleted",
        boardId: String(boardId),
        payload: { id: labelId, boardId: String(boardId) },
    });
}
```

### `services/attachments.ts`

```ts
import { Readable } from "node:stream";
import { ObjectId } from "mongodb";
import { withTransaction } from "../db/connection.js";
import {
    attachments as attachmentsColl,
    cards as cardsColl,
} from "../db/schemas/index.js";
import { AppError } from "../http/error.js";
import { storage } from "../storage/index.js";
import { eventBus } from "../events/bus.js";
import { fetchBoardWithMembership, deriveAccess } from "../auth/middleware.js";
import type { UserSession } from "../http/types.js";

export const ALLOWED_MIMES = new Set([...]); // unchanged
const MIME_TO_EXT: Record<string, string> = {...}; // unchanged
export interface AttachmentResponse { ... } // unchanged

export async function uploadAttachment({
    boardId, cardId, file, user,
}: {
    boardId: ObjectId; cardId: string; file: File; user: UserSession;
}): Promise<AttachmentResponse> {
    const cardObjId = new ObjectId(cardId);
    const card = await cardsColl().findOne({ _id: cardObjId, boardId });
    if (!card) throw new AppError("NOT_FOUND", "Card not found.");

    const attachmentId = new ObjectId();
    const ext = MIME_TO_EXT[file.type] ?? ".bin";
    const storageKey = `${String(boardId)}/${String(attachmentId)}${ext}`;

    const nodeStream = Readable.fromWeb(
        file.stream() as Parameters<typeof Readable.fromWeb>[0],
    );
    await storage.put(storageKey, nodeStream, file.size, file.type);

    await withTransaction(async (session) => {
        await attachmentsColl().insertOne(
            {
                _id: attachmentId,
                cardId: card._id,
                boardId,
                filename: file.name,
                mimeType: file.type,
                sizeBytes: file.size,
                storageKey,
                uploadedBy: user.id as unknown as ObjectId, // see ID note in slice-services-boards-teams
                createdAt: new Date(),
            } as any,
            { session },
        );
        await cardsColl().updateOne(
            { _id: card._id },
            { $push: { attachmentIds: attachmentId } },
            { session },
        );
    });

    const response: AttachmentResponse = {
        id: String(attachmentId),
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        url: `/api/attachments/${String(attachmentId)}`,
        uploadedBy: String(user.id),
        createdAt: new Date(),
    };
    eventBus.emit({ type: "card.attachment.added", boardId: String(boardId), payload: response });
    return response;
}

export async function deleteAttachment(
    boardId: ObjectId, cardId: string, attachmentId: string,
): Promise<void> {
    const attObjId = new ObjectId(attachmentId);
    const att = await attachmentsColl().findOne({ _id: attObjId, boardId });
    if (!att) throw new AppError("NOT_FOUND", "Attachment not found.");
    const storageKey = att.storageKey;

    await withTransaction(async (session) => {
        await cardsColl().updateOne(
            { _id: new ObjectId(cardId), boardId },
            { $pull: { attachmentIds: att._id } },
            { session },
        );
        await attachmentsColl().deleteOne({ _id: att._id }, { session });
    });

    try { await storage.delete(storageKey); }
    catch (err) {
        console.error(`[deleteAttachment] Failed to delete storage file for attachment ${attachmentId}:`, err);
    }
    eventBus.emit({ type: "card.attachment.removed", boardId: String(boardId), payload: { id: attachmentId, cardId } });
}

export async function streamAttachment(
    attachmentId: string, user: UserSession,
): Promise<{ att: { filename: string; mimeType: string; sizeBytes: number; storageKey: string }; stream: Readable }> {
    const att = await attachmentsColl().findOne({ _id: new ObjectId(attachmentId) });
    if (!att) throw new AppError("NOT_FOUND", "Attachment not found.");

    const board = await fetchBoardWithMembership(String(att.boardId), user.id);
    if (!board) throw new AppError("NOT_FOUND", "Attachment's board not found.");
    const access = deriveAccess(board, user);
    if (!access) throw new AppError("FORBIDDEN", "You do not have access to this attachment.");

    const stream = await storage.get(att.storageKey);
    return {
        att: {
            filename: att.filename, mimeType: att.mimeType,
            sizeBytes: att.sizeBytes, storageKey: att.storageKey,
        },
        stream,
    };
}
```

### `routes/card-attachments.ts`

```ts
import type { ObjectId } from "mongodb";
...
interface BoardContext { _id: ObjectId; }
```

Or, simpler, switch to `c.get("board")` directly typed as `ContextBoard`
and remove the local `BoardContext` shim.

### `routes/labels.ts`, `routes/attachments.ts`

No code changes expected — neither file imports from `mongoose`. Re-verify
after compile.

## Interface Contract

```ts
// services/labels.ts
import type { ObjectId } from "mongodb";
export interface LabelDetail { ... } // unchanged
export function createLabel(boardId: ObjectId, input: { name: string; color: string }): Promise<LabelDetail>;
export function updateLabel(boardId: ObjectId, labelId: string, input: { name?: string; color?: string }): Promise<LabelDetail>;
export function deleteLabel(boardId: ObjectId, labelId: string): Promise<void>;

// services/attachments.ts
export const ALLOWED_MIMES: Set<string>; // unchanged
export interface AttachmentResponse { ... } // unchanged
export function uploadAttachment(args: { boardId: ObjectId; cardId: string; file: File; user: UserSession }): Promise<AttachmentResponse>;
export function deleteAttachment(boardId: ObjectId, cardId: string, attachmentId: string): Promise<void>;
export function streamAttachment(attachmentId: string, user: UserSession): Promise<{ att: { filename: string; mimeType: string; sizeBytes: number; storageKey: string }; stream: Readable }>;
```

This slice consumes `fetchBoardWithMembership` and `deriveAccess` from
`auth/middleware.ts` (rewritten by slice-services-boards-teams) with their
unchanged signatures.

## Acceptance Criteria

- [ ] `services/labels.ts` and `services/attachments.ts` contain zero
      `mongoose` imports.
- [ ] Both transaction sites use `withTransaction` from `db/connection.js`.
- [ ] `deleteLabel` removes `labelId` from all cards on the board (via
      `$pull`) and deletes the label in a single transaction.
- [ ] `uploadAttachment` writes to storage **before** opening the
      transaction (matches current ordering); storage failure aborts before
      DB write.
- [ ] `deleteAttachment` deletes the storage file **after** the transaction
      commits and tolerates storage-delete failures (logs, does not throw).
- [ ] `routes/card-attachments.ts` no longer imports anything from
      `mongoose`.
- [ ] `pnpm --filter @kata/api check` passes for all files in this slice.
