---
plan: PLAN-002
slice: db-models
title: "MongoDB connection and Mongoose models"
complexity: 2
---

# MongoDB connection and Mongoose models

## Goal

Establish the singleton Mongoose connection and define every collection schema for the kanban domain (excluding the Better Auth-managed `user` / `session` / `account` / `verification` collections, which the auth slice introduces). After this slice, importing any model from `db/models/*` opens or reuses the shared connection and exposes a fully typed Mongoose model.

## Files to Create / Modify

- `apps/api/src/db/connection.ts` — create. Connect on first import, log connection state changes, expose `mongoose` and a `disconnect()` helper for graceful shutdown.
- `apps/api/src/db/types.ts` — create. Shared TypeScript types: `Role = 'admin' | 'member'`, `BoardKind = 'personal' | 'team'`, and `ObjectIdString` brand if useful.
- `apps/api/src/db/models/team.ts` — create.
- `apps/api/src/db/models/team-member.ts` — create.
- `apps/api/src/db/models/board.ts` — create.
- `apps/api/src/db/models/column.ts` — create.
- `apps/api/src/db/models/card.ts` — create. Includes embedded subdocs for comments and checklists.
- `apps/api/src/db/models/label.ts` — create.
- `apps/api/src/db/models/attachment.ts` — create.
- `apps/api/src/db/models/index.ts` — create. Barrel export for convenience.
- `apps/api/src/app.ts` — modify. Import `./db/connection` at the top so Mongoose connects on app boot. Update `/healthz` to return `{ ok: true, db: mongoose.connection.readyState === 1 }`, returning 503 if the DB is not connected.
- `apps/api/src/index.ts` — modify. On `SIGTERM` / `SIGINT`, call the connection's `disconnect()` before exit.

## Implementation Steps

1. **`db/connection.ts`** — wrap `mongoose.connect(env.MONGODB_URI)` in an idempotent function called at import time. Set `mongoose.set('strictQuery', true)`. Log `connected`, `disconnected`, `error` events. Export `disconnect = () => mongoose.disconnect()`.

2. **`db/models/team.ts`**:
   ```ts
   const TeamSchema = new Schema({
     domain: { type: String, required: true, unique: true, lowercase: true, trim: true },
     name: { type: String, required: true },
     teamBoardId: { type: Schema.Types.ObjectId, ref: 'Board' }
   }, { timestamps: true });
   ```
   Export `Team = mongoose.model('Team', TeamSchema)`.

3. **`db/models/team-member.ts`**:
   ```ts
   const TeamMemberSchema = new Schema({
     teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
     userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
     role:   { type: String, enum: ['admin', 'member'], required: true },
     joinedAt: { type: Date, default: () => new Date() }
   });
   TeamMemberSchema.index({ teamId: 1, userId: 1 }, { unique: true });
   ```

4. **`db/models/board.ts`**:
   ```ts
   const BoardSchema = new Schema({
     kind:    { type: String, enum: ['personal', 'team'], required: true },
     title:   { type: String, required: true },
     ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
     teamId:  { type: Schema.Types.ObjectId, ref: 'Team' }
   }, { timestamps: true });
   BoardSchema.index({ ownerId: 1 }, { unique: true, partialFilterExpression: { kind: 'personal' } });
   BoardSchema.index({ teamId: 1 },  { unique: true, partialFilterExpression: { kind: 'team'    } });
   ```

5. **`db/models/column.ts`**:
   ```ts
   const ColumnSchema = new Schema({
     boardId:  { type: Schema.Types.ObjectId, ref: 'Board', required: true, index: true },
     title:    { type: String, required: true },
     position: { type: String, required: true }
   }, { timestamps: true });
   ColumnSchema.index({ boardId: 1, position: 1 });
   ```

6. **`db/models/card.ts`** — embedded subdocs first:
   ```ts
   const CommentSchema = new Schema({
     authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
     body:     { type: String, required: true, maxlength: 10000 },
     createdAt:{ type: Date, default: () => new Date() },
     updatedAt:{ type: Date }
   }, { _id: true });

   const ChecklistItemSchema = new Schema({
     text:    { type: String, required: true, maxlength: 1000 },
     checked: { type: Boolean, default: false }
   }, { _id: true });

   const ChecklistSchema = new Schema({
     title: { type: String, required: true, maxlength: 200 },
     items: { type: [ChecklistItemSchema], default: [] }
   }, { _id: true });

   const CardSchema = new Schema({
     boardId:   { type: Schema.Types.ObjectId, ref: 'Board', required: true, index: true },
     columnId:  { type: Schema.Types.ObjectId, ref: 'Column', required: true, index: true },
     title:     { type: String, required: true, maxlength: 500 },
     description:{ type: String, maxlength: 50000 },
     position:  { type: String, required: true },
     dueDate:   { type: Date, default: null },
     labelIds:    { type: [Schema.Types.ObjectId], ref: 'Label', default: [] },
     assigneeIds: { type: [Schema.Types.ObjectId], ref: 'User',  default: [] },
     attachmentIds:{ type: [Schema.Types.ObjectId], ref: 'Attachment', default: [] },
     comments:  { type: [CommentSchema], default: [] },
     checklists:{ type: [ChecklistSchema], default: [] }
   }, { timestamps: true });
   CardSchema.index({ columnId: 1, position: 1 });
   ```

7. **`db/models/label.ts`** and **`db/models/attachment.ts`** — straightforward; follow the data-model table in `PLAN-002.md`.

8. **Barrel `db/models/index.ts`** — re-export every model.

9. **`app.ts` integration** — import `./db/connection` for its side effect early. Update `/healthz` to inspect `mongoose.connection.readyState` and return `{ ok, db }`; return 503 when `db` is false.

10. **Graceful shutdown** in `index.ts` — `process.on('SIGTERM', ...)` calls `disconnect()` then exits.

## Interface Contract

Exposed to later slices:

- `import { Team, TeamMember, Board, Column, Card, Label, Attachment } from './db/models'`.
- All models are Mongoose models with full TypeScript types inferred from their schemas.
- `import { disconnect } from './db/connection'` for shutdown hooks.

Consumes from sibling slices:

- `env.MONGODB_URI` from the scaffolding slice's `src/env.ts`.

Note for sibling slices:

- This slice does NOT define the `User` model. Better Auth's MongoDB adapter creates and owns the `user` collection. Other slices reference users by ObjectId only, never via a Mongoose `User` model from here.

## Acceptance Criteria

- [ ] Importing any model triggers a Mongoose connection attempt against `MONGODB_URI`.
- [ ] All indexes listed in the data-model section of `PLAN-002.md` are declared in code.
- [ ] Partial unique indexes on `boards` correctly allow at most one personal board per user and one team board per team (verifiable by running two insert attempts in a Mongo shell or unit test).
- [ ] Composite unique index on `teamMembers (teamId, userId)` rejects duplicates.
- [ ] `/healthz` returns `{ ok: true, db: true }` when Mongo is reachable and `{ ok: false, db: false }` with status 503 when it is not.
- [ ] On `SIGTERM`, the process closes the Mongo connection and exits cleanly within 2s.
- [ ] `pnpm --filter @kata/api check` passes.
