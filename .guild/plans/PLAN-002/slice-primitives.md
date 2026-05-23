---
plan: PLAN-002
slice: primitives
title: "Cross-cutting primitives: error envelope, validation, ordering, event bus, storage adapter"
complexity: 2
---

# Cross-cutting primitives

## Goal

Build the shared utilities every route slice depends on:

1. A consistent error envelope and a Hono error handler that produces it.
2. A Zod validation helper that emits the envelope on failure.
3. Response helpers (`ok`, `created`, `noContent`).
4. Fractional-indexing wrappers for position management.
5. An in-process board event bus (with an interface that allows later replacement).
6. A storage adapter interface plus a disk implementation pointing at the Railway volume.

After this slice, no domain-logic routes exist yet, but every later slice can import these primitives.

## Files to Create / Modify

- `apps/api/src/http/error.ts` — create. `AppError` class, error code enum, envelope serialiser, Hono `onError` handler.
- `apps/api/src/http/validate.ts` — create. Wraps `@hono/zod-validator` so validation failures throw `AppError` with code `VALIDATION_ERROR`.
- `apps/api/src/http/responders.ts` — create. Tiny helpers for consistent response shapes.
- `apps/api/src/ordering/fractional.ts` — create. Re-exports `generateKeyBetween`, `generateNKeysBetween`, plus helpers `appendAfter(lastPos)`, `insertBetween(a, b)`, `reorderToMatch(currentItems, desiredOrder)`.
- `apps/api/src/events/types.ts` — create. Discriminated-union `BoardEvent` type.
- `apps/api/src/events/bus.ts` — create. `BoardEventBus` interface + `InProcessEventBus` impl using Node's `EventEmitter`. Exports a module-level singleton.
- `apps/api/src/storage/adapter.ts` — create. `StorageAdapter` interface.
- `apps/api/src/storage/disk.ts` — create. `DiskStorage` implementation writing under `env.ATTACHMENTS_DIR`.
- `apps/api/src/storage/index.ts` — create. Module-level singleton (`storage = new DiskStorage(env.ATTACHMENTS_DIR)`).
- `apps/api/src/app.ts` — modify. Register the central error handler via `app.onError(errorHandler)`. Wrap unhandled errors into `INTERNAL_ERROR`.

## Implementation Steps

### 1. Error envelope (`http/error.ts`)

```ts
export type ErrorCode =
  | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT'
  | 'VALIDATION_ERROR' | 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE'
  | 'DOMAIN_NOT_ALLOWED' | 'INTERNAL_ERROR';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409,
  VALIDATION_ERROR: 422, PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415,
  DOMAIN_NOT_ALLOWED: 403, INTERNAL_ERROR: 500
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown
  ) { super(message); }
  get status() { return STATUS[this.code]; }
}

export const errorHandler = (err: Error, c: Context) => {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }
  console.error('Unhandled', err);
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
};
```

### 2. Zod validator wrapper (`http/validate.ts`)

```ts
import { zValidator as base } from '@hono/zod-validator';
export const zValidator = (target, schema) =>
  base(target, schema, (result, c) => {
    if (!result.success) {
      throw new AppError('VALIDATION_ERROR', 'Request did not match schema', result.error.flatten());
    }
  });
```

### 3. Responders (`http/responders.ts`)

```ts
export const ok       = (c, body) => c.json(body, 200);
export const created  = (c, body) => c.json(body, 201);
export const noContent= (c) => c.body(null, 204);
```

### 4. Fractional ordering (`ordering/fractional.ts`)

```ts
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

export const appendAfter   = (lastPos: string | null) => generateKeyBetween(lastPos, null);
export const insertBetween = (a: string | null, b: string | null) => generateKeyBetween(a, b);

// Given the current sorted items and the desired final order of their ids,
// compute the minimum set of (id, newPos) updates.
export function reorderToMatch<T extends { _id: string; position: string }>(
  current: T[],
  desiredIds: string[]
): { id: string; position: string }[] {
  const positions = generateNKeysBetween(null, null, desiredIds.length);
  const updates: { id: string; position: string }[] = [];
  const currentById = new Map(current.map(c => [c._id, c]));
  desiredIds.forEach((id, i) => {
    const item = currentById.get(id);
    if (!item) throw new AppError('VALIDATION_ERROR', `Unknown id in reorder: ${id}`);
    if (item.position !== positions[i]) updates.push({ id, position: positions[i]! });
  });
  return updates;
}
```

The reorder service is responsible for verifying `desiredIds.length === current.length` and that the sets match (it throws `VALIDATION_ERROR` if not — per US-5/US-6 edge cases).

### 5. Event bus (`events/bus.ts` + `events/types.ts`)

```ts
// types.ts
export type BoardEvent =
  | { type: 'column.created' | 'column.updated' | 'column.deleted' | 'columns.reordered'; boardId: string; payload: unknown }
  | { type: 'card.created' | 'card.updated' | 'card.deleted' | 'card.moved' | 'cards.reordered'; boardId: string; payload: unknown }
  | { type: 'card.comment.created' | 'card.comment.updated' | 'card.comment.deleted'; boardId: string; payload: unknown }
  | { type: 'card.checklist.created' | 'card.checklist.updated' | 'card.checklist.deleted'; boardId: string; payload: unknown }
  | { type: 'card.label.added' | 'card.label.removed'; boardId: string; payload: unknown }
  | { type: 'card.assignee.added' | 'card.assignee.removed'; boardId: string; payload: unknown }
  | { type: 'card.attachment.added' | 'card.attachment.removed'; boardId: string; payload: unknown }
  | { type: 'label.created' | 'label.updated' | 'label.deleted'; boardId: string; payload: unknown };

// bus.ts
export interface BoardEventBus {
  emit(event: BoardEvent): void;
  subscribe(boardId: string, listener: (event: BoardEvent) => void): () => void; // returns unsubscribe
}

class InProcessEventBus implements BoardEventBus {
  private readonly emitter = new EventEmitter();
  constructor() { this.emitter.setMaxListeners(0); }
  emit(event) { this.emitter.emit(event.boardId, event); }
  subscribe(boardId, listener) {
    this.emitter.on(boardId, listener);
    return () => this.emitter.off(boardId, listener);
  }
}

export const eventBus: BoardEventBus = new InProcessEventBus();
```

### 6. Storage (`storage/adapter.ts` + `storage/disk.ts`)

```ts
// adapter.ts
export interface StorageAdapter {
  put(key: string, stream: Readable, size: number, mimeType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

// disk.ts — DiskStorage builds full path = join(root, key), creates dirs as needed,
// streams to a temp file then renames atomically, throws AppError('INTERNAL_ERROR') on failure.
```

`key` shape used by the attachments slice: `<boardId>/<attachmentId><ext>`. The disk adapter is path-agnostic; it only knows how to read/write keys relative to its root.

### 7. Wire the error handler in `app.ts`

```ts
app.onError(errorHandler);
```

Place this after route mounting so it catches everything.

## Interface Contract

Exposed to later slices:

- `AppError`, `errorHandler` from `http/error`.
- `zValidator` from `http/validate`.
- `ok`, `created`, `noContent` from `http/responders`.
- `appendAfter`, `insertBetween`, `reorderToMatch` from `ordering/fractional`.
- `eventBus` and `BoardEvent` from `events/*`.
- `storage` singleton and `StorageAdapter` interface from `storage/*`.

Consumes from sibling slices:

- `env` from scaffolding slice.

No code dependency on the db-models slice — primitives are pure.

## Acceptance Criteria

- [ ] Throwing `new AppError('NOT_FOUND', 'no')` from any route produces `{ "error": { "code": "NOT_FOUND", "message": "no" } }` with status 404.
- [ ] An unknown thrown error produces `{ "error": { "code": "INTERNAL_ERROR", ... } }` with status 500 and the original error is logged.
- [ ] `zValidator` rejects malformed bodies with status 422 and the error envelope.
- [ ] `reorderToMatch` returns only the rows whose computed position differs.
- [ ] `eventBus.subscribe(boardId, listener)` returns an unsubscribe function and the listener fires only for matching `boardId`.
- [ ] `DiskStorage.put` creates parent directories as needed and writes the file atomically (no half-written file visible at the final path on crash).
- [ ] `pnpm --filter @kata/api check` passes.
