---
id: PLAN-003
title: "Mongoose → Native MongoDB Driver Migration"
requirement: REQ-003
task: TASK-035
created: 2026-05-23
---

# Mongoose → Native MongoDB Driver Migration

## Architecture Overview

This plan replaces every Mongoose surface in `apps/api` with the official
`mongodb` Node.js driver while keeping the HTTP contract frozen. The new data
layer is built from three pieces:

1. **`db/connection.ts`** owns a single shared `MongoClient` and `Db`, exposes
   `connectDB()`, `disconnect()`, and a `withTransaction(cb)` helper.
2. **`db/schemas/`** holds one Zod document schema per collection plus an
   `z.infer<>` alias. These types are imported anywhere a typed collection is
   needed. No hand-written interfaces.
3. **Service / route layers** read and write via
   `db.collection<DocType>("name")` using native CRUD, native aggregation, and
   `withTransaction` for multi-document atomic operations.

Schema-level validators (Mongoose `required`, `enum`, `maxlength`) are dropped
entirely — `@hono/zod-validator` at the route layer is the only validation
surface. ObjectId conversion is centralised through the existing
`validateObjectId` helper (which gets rewritten to use `mongodb`'s `ObjectId`),
and route handlers continue to serialise `_id` → `String(_id)` exactly as they
do today.

Better Auth's `mongodbAdapter` continues to be the only consumer of its own
collections; we wire it to the shared `Db` instance instead of pulling one out
of Mongoose's internal client.

Startup sequence becomes: `await connectDB()` → `await ensureIndexes()` →
`serve()`. Failures in either async step abort the process before any port is
bound.

## Codebase Analysis

### Current Mongoose surface (full audit)

- **`db/connection.ts`** — uses `mongoose.connect`, fires connect/disconnect/error
  events, exports `mongoose` and `disconnect()`. Imported as a side-effect from
  every model file to ensure the connection is opened.
- **`db/models/*.ts`** — seven model files (`team`, `team-member`, `board`,
  `column`, `card`, `label`, `attachment`) plus a thin `user.ts` stub that
  reads the Better-Auth-owned `user` collection. Indexes defined inline on
  schemas:
  - `team.domain` unique (single-field declaration, `unique: true`)
  - `team-member` composite unique `{ teamId: 1, userId: 1 }` + single-field
    indexes on `teamId` and `userId`
  - `board` partial unique on `ownerId` where `kind === 'personal'`
  - `board` partial unique on `teamId` where `kind === 'team'`
  - `column` single-field index on `boardId` + compound `{ boardId, position }`
  - `card` single-field indexes on `boardId` and `columnId` + compound
    `{ columnId, position }`
  - `label`, `attachment` single-field indexes on `boardId` / `cardId`
- **`auth/better-auth.ts`** — reaches into
  `mongoose.connection.getClient().db()` through a lazy `Proxy` so the adapter
  resolves the `Db` at query time. Must switch to importing the shared `db`.
- **`auth/middleware.ts`** — `fetchBoardWithMembership` runs an aggregation via
  `Board.aggregate(...)`, joining `boards` ↔ `teammembers`. Note the `from`
  collection name in `$lookup` is `"teammembers"` — the Mongoose-pluralised
  form of the model name. With the native driver we control the collection
  name explicitly; we will use **`teamMembers`** in code and `db.createCollection`
  is not called, so the collection name is set by the first
  `db.collection<TeamMember>("teamMembers")` access. Crucial: existing
  production data lives under `teammembers` (the Mongoose default), so we must
  use `"teammembers"` as the collection name to preserve the no-data-migration
  invariant. Same for `boards`, `cards`, `columns`, `labels`, `attachments`,
  `teams` — all default-pluralised. We document the exact collection name in
  each schema file and verify before merge.
- **`auth/provisioning.ts`** — uses `mongoose.startSession()` +
  `session.withTransaction(...)`, calls `Board.create`, `User.updateOne`,
  `Team.findOneAndUpdate` (upsert), `TeamMember.countDocuments`,
  `TeamMember.updateOne` (upsert). Becomes a `withTransaction` block using
  native equivalents.
- **`http/types.ts`** — `ContextBoard` types `_id`, `ownerId`, `teamId` as
  `mongoose.Types.ObjectId`. Swap to `ObjectId` from `mongodb`.
- **`http/validate.ts`** — `validateObjectId` uses `mongoose.isValidObjectId`.
  Replace with `ObjectId.isValid(value)` from `mongodb` and keep the same
  exported signature so no callers change.
- **`services/boards.ts`** — `Board.findById`, `Column.find`, `Card.find`,
  `.lean()`. Straight rewrite.
- **`services/teams.ts`** — `TeamMember.findOne`, `Team.findById`,
  `TeamMember.find`, `TeamMember.countDocuments`, `target.save()`. The
  `setMemberRole` save becomes `findOneAndUpdate` (or `updateOne` +
  re-fetch). The empty-string `email: ""` placeholder in `listMembers` is
  preserved verbatim — only `routes/teams.ts` ever resolves real emails.
- **`services/columns.ts`** — `Column.findOne`, `Column.find`,
  `Column.create`, `Column.findOneAndUpdate`, `Card.countDocuments`,
  `Column.deleteOne`, `Column.bulkWrite`. The `bulkWrite` payload uses
  `new mongoose.Types.ObjectId(u.id)` — rewrite with `new ObjectId(u.id)`.
- **`services/cards.ts`** — long file, multiple ops including
  `withTransaction` for `deleteCard`, `bulkWrite` for `reorderCardsInColumn`,
  `$pull` for stale-attachment cleanup. Subdocument arrays (`comments`,
  `checklists`) are read-only here — mutations live in route files.
- **`services/labels.ts`** — `Label.create`, `Label.findOneAndUpdate`,
  `Label.findOne`, `withTransaction` deleting and pulling `labelIds` from
  cards.
- **`services/attachments.ts`** — `withTransaction` insert + `$push`,
  `withTransaction` delete + `$pull`, single-doc reads. Also imports and
  calls `fetchBoardWithMembership` + `deriveAccess` from `auth/middleware.ts`.
- **`routes/boards.ts`** — `Board.findOne`, `TeamMember.findOne`.
- **`routes/teams.ts`** — `Team`, `TeamMember`, `User` reads. Resolves member
  emails by querying the Better-Auth-owned `user` collection with a
  projection.
- **`routes/card-comments.ts`** / **`card-checklists.ts`** /
  **`card-assignees.ts`** / **`card-labels.ts`** — inline Mongoose calls that
  mutate `Card` subdocument arrays via `$push`, `$pull`, `$addToSet`, and
  `comments.$.body`-style positional updates. The Mongoose subdocument
  helpers (`card.comments.id(commentId)`, `comment.deleteOne()`,
  `card.save()`) are replaced with native positional operators and
  `findOneAndUpdate` / `updateOne` projections that return only the affected
  subdocument.
- **`app.ts`** — `/healthz` reads `mongoose.connection.readyState`. Replace
  with a native check (e.g. `await db.command({ ping: 1 })` wrapped in
  try/catch, or a cached `isConnected` flag flipped by `connectDB()`).
- **`index.ts`** — currently calls `serve(...)` synchronously and only awaits
  `disconnect()` on shutdown. Becomes `await connectDB(); await ensureIndexes();
  serve(...)` with the same shutdown path now calling `disconnect()` on the
  shared client.

### Existing conventions to preserve

- Hono routes, error-handling via `AppError` + `errorHandler`, `ok` / `created`
  / `noContent` responders, `validateObjectId` helper, `eventBus` payload
  shapes, `streamSSE` plumbing — all unchanged.
- Service files use `String(doc._id)` for serialisation and
  `import.meta`-style ESM with `.js` extensions in import paths (required by
  `NodeNext` + `verbatimModuleSyntax`).
- Tab indentation, double-quoted strings, named section comments
  (`// ── name ──`).
- `exactOptionalPropertyTypes` is enabled — optional fields use
  `...(value !== undefined && { key: value })` spreading, not `key: value | undefined`.
- `noUncheckedIndexedAccess` is enabled — array reads return `T | undefined`.

### Collection-name verification (single source of truth)

| Logical name | Mongoose model | MongoDB collection (preserved) |
|--------------|----------------|--------------------------------|
| Team         | `Team`         | `teams`        |
| TeamMember   | `TeamMember`   | `teammembers`  |
| Board        | `Board`        | `boards`       |
| Column       | `Column`       | `columns`      |
| Card         | `Card`         | `cards`        |
| Label        | `Label`        | `labels`       |
| Attachment   | `Attachment`   | `attachments`  |
| User (BA)    | `User`         | `user`         |

Every `db.collection<T>("...")` call MUST use the right-hand string verbatim.

### `validateObjectId` extraction (cross-cutting)

`validateObjectId` is imported by every route file. Rewriting it (slice
`schemas`) only touches its internals — the exported signature
(`(value: string | undefined, name: string) => string`) is unchanged so no
caller needs to change. This keeps the route-level slices independent of the
schemas slice in everything except their type imports.

## Implementation Tasks

### 1. Connection module + startup wiring (complexity: 2)
- **Slice**: `.guild/plans/PLAN-003/slice-connection.md`
- **Summary**: New `db/connection.ts` exporting `client`, `db`, `connectDB`,
  `withTransaction`, `disconnect`; rewrite `src/index.ts` startup, rewire
  `app.ts` health check, rewire `auth/better-auth.ts` to consume the shared
  `db`.
- **Depends on**: none

### 2. Zod schemas + ObjectId helper (complexity: 2)
- **Slice**: `.guild/plans/PLAN-003/slice-schemas.md`
- **Summary**: Create `db/schemas/{team,team-member,board,column,card,label,attachment,user,index}.ts`,
  each exporting a Zod schema + `z.infer<>` alias + the literal collection
  name. Rewrite `http/validate.ts#validateObjectId` to use `ObjectId.isValid`.
  Update `http/types.ts` to use `ObjectId` from `mongodb`. Delete
  `db/models/` directory.
- **Depends on**: slice-connection (imports `db` for the `index.ts` collection
  accessors)

### 3. Index bootstrap (complexity: 1)
- **Slice**: `.guild/plans/PLAN-003/slice-indexes.md`
- **Summary**: Add `db/indexes.ts` exporting `ensureIndexes()` that calls
  `createIndex` for every index previously declared on Mongoose schemas
  (including the two partial-unique board indexes and the composite team
  membership index). Wire the call into `index.ts` between `connectDB` and
  `serve`.
- **Depends on**: slice-connection, slice-schemas

### 4. Boards + teams + auth services (complexity: 3)
- **Slice**: `.guild/plans/PLAN-003/slice-services-boards-teams.md`
- **Summary**: Rewrite `services/boards.ts`, `services/teams.ts`,
  `auth/provisioning.ts`, and `auth/middleware.ts` (including the
  `fetchBoardWithMembership` aggregation and the `BoardWithMembership` type).
  Rewrite `routes/boards.ts` and `routes/teams.ts` to consume the new
  services + collection helpers directly.
- **Depends on**: slice-connection, slice-schemas

### 5. Columns + cards services (complexity: 3)
- **Slice**: `.guild/plans/PLAN-003/slice-services-columns-cards.md`
- **Summary**: Rewrite `services/columns.ts` and `services/cards.ts`.
  Replace `bulkWrite` payloads, `withTransaction` for `deleteCard`, and the
  stale-attachment `$pull`. The `routes/columns.ts` and `routes/cards.ts`
  files need their `import type { Types } from "mongoose"` import swapped
  to `import type { ObjectId } from "mongodb"`.
- **Depends on**: slice-connection, slice-schemas

### 6. Labels + attachments services (complexity: 2)
- **Slice**: `.guild/plans/PLAN-003/slice-services-labels-attachments.md`
- **Summary**: Rewrite `services/labels.ts` and `services/attachments.ts`.
  Swap the two `withTransaction` blocks, replace `Card.updateMany` and
  `$pull` calls. Update `routes/labels.ts`, `routes/card-attachments.ts`,
  `routes/attachments.ts` imports.
- **Depends on**: slice-connection, slice-schemas, slice-services-boards-teams
  (because attachments calls `fetchBoardWithMembership`)

### 7. Card-detail route rewrites (complexity: 2)
- **Slice**: `.guild/plans/PLAN-003/slice-routes-card-detail.md`
- **Summary**: Rewrite `routes/card-comments.ts`, `routes/card-checklists.ts`,
  `routes/card-assignees.ts`, `routes/card-labels.ts`. Replace subdocument
  helpers (`card.comments.id`, `comment.deleteOne()`, `card.save()`) with
  positional-operator updates and projection-based reads.
- **Depends on**: slice-connection, slice-schemas

### 8. Cleanup + dependency removal (complexity: 1)
- **Slice**: `.guild/plans/PLAN-003/slice-cleanup.md`
- **Summary**: Remove `mongoose` from `apps/api/package.json`, add `mongodb`
  with a version aligned with `better-auth`'s transitive requirement,
  re-run `pnpm install`, grep the codebase to prove zero `mongoose` imports
  remain, run `pnpm --filter @kata/api check` and `pnpm --filter @kata/api build`.
- **Depends on**: slices 1-7

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| MongoDB driver version | `^6.x` (whatever `better-auth` already pulls in transitively) | REQ AC says align versions to avoid duplicate installs. The slice-cleanup developer reads `pnpm why mongodb` first and pins to that exact major. |
| `_id` Zod schema type | `z.instanceof(ObjectId)` | Round-trips natively; route handlers continue to `String(_id)` at the serialisation boundary. |
| Collection names | Preserved exactly as Mongoose pluralised them (see table above) | REQ explicitly forbids schema/data migration. `teammembers` (not `teamMembers`) is the persisted form. |
| ObjectId validation in `validateObjectId` | `ObjectId.isValid(value)` from `mongodb` | Same semantics as `mongoose.isValidObjectId`; existing 422 path unchanged. |
| `withTransaction` signature | `<T>(cb: (session: ClientSession) => Promise<T>) => Promise<T>` | Mirrors REQ US-5; idiomatic native usage; `session.endSession()` in `finally`. |
| Index creation | Single `ensureIndexes()` function called once at startup | Idempotent; matches REQ US-7; failures must propagate (no try/catch swallowing). |
| Better Auth wiring | Pass shared `db` directly to `mongodbAdapter(db)` | Removes the proxy hack; `connectDB()` is awaited before `auth` is ever used (its handler only fires on HTTP requests, which can't arrive until `serve()` returns). |
| Health check | `db.command({ ping: 1 })` inside try/catch | Native equivalent of `readyState === 1`; cheap, returns 503 on failure. |
| Subdocument array writes | Use positional `$` operator and `arrayFilters` (where needed) | Avoids load-then-`save()` round-trips and removes the Mongoose `DocumentArray` API surface. |
| Comment / checklist item `_id` generation | `new ObjectId()` in route handler, inserted via `$push` | Matches current behaviour (`new mongoose.Types.ObjectId()` today). |
| Connection idempotency | A module-level boolean (`hasConnected`) guards `client.connect()` | Native driver's `connect()` is not idempotent in the same way Mongoose's is. |
| Better Auth `db` parameter | Wait — `mongodbAdapter` requires a `Db` synchronously at construction time. Solve by exporting a `getDb()` function and constructing `auth` lazily, OR by keeping the proxy pattern but pointing it at the new `client`. | Lazy proxy is the smaller diff and preserves the existing init order; slice-connection uses it. |

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Collection-name mismatch (e.g. coding `"teamMembers"` instead of `"teammembers"`) silently creates an empty collection while existing data sits in the old one | All reads return empty results; tests appear to pass on a fresh DB but production breaks | Single-source-of-truth table in `db/schemas/index.ts` exports `COLLECTIONS = { teamMembers: "teammembers", ... } as const`; all `db.collection(...)` calls reference that constant. Reviewer must verify every collection access uses the constant. |
| Better Auth proxy breaks if the new `client` is constructed lazily or replaced mid-request | Auth endpoints 500 | The proxy resolves `db` on every property access, and `connectDB()` is awaited before `serve()`; the proxy is safe as long as `connectDB` runs first. |
| Aggregation `$lookup` `from` field still references the old `"teammembers"` collection name | Aggregation returns empty membership arrays | The collection name is unchanged; the literal `from: "teammembers"` is preserved verbatim in `auth/middleware.ts`. |
| Native driver's `bulkWrite` filter shape differs subtly from Mongoose's | Reorder operations silently no-op | Filter is `{ _id: new ObjectId(u.id) }`; verify with the existing manual reorder test described in REQ-002. |
| `ObjectId` thrown from `new ObjectId(invalidString)` reaches the error handler as `BSONError` instead of `AppError` | Returns 500 instead of 422 | All ObjectId construction is funneled through `validateObjectId` (already enforced at the route boundary) so 24-hex validation happens before `new ObjectId(...)` is ever called inside services. |
| `withTransaction` invoked when MongoDB is a standalone instance | Provisioning crashes on every first login | REQ US-5 explicitly requires Atlas / replica-set; documented in slice-connection so developer adds a fatal startup log if `client.options.replicaSet` is unset. (Soft warning only — do not block startup, as some Atlas free-tier configs report `replicaSet` differently.) |
| Removing `mongoose` while `better-auth` is mid-upgrade leaves a peer warning | Pipeline warning; no functional break | slice-cleanup runs `pnpm install` and inspects output; any warning is reported in the slice's acceptance criteria. |
| `mongoose.connection.getClient()` is gone — anything (tests, scripts) that depended on it | Build / runtime errors | Grep for `mongoose.connection` in slice-cleanup; nothing outside `apps/api/src/` should reference it. |
| Subdocument positional writes (`"comments.$.body"`) require the array filter element to match the top-level query — easy to get wrong | Update silently misses | The route slices include explicit acceptance criteria for the 404 vs 403 distinction in comment edits (matching current behaviour). |
| `exactOptionalPropertyTypes` interacts badly with native driver return types that use `Document | null` | Implicit `any` or compile errors | Each typed collection call uses the explicit generic `db.collection<Board>("boards")` and callers spread optional fields conditionally. |
