---
plan: PLAN-003
title: "Zod schemas + ObjectId helper"
complexity: 2
---

# Zod schemas + ObjectId helper

## Objective

Replace `apps/api/src/db/models/` with a `db/schemas/` directory containing
one Zod schema per collection (plus a thin `user.ts` for the Better-Auth
collection), each exporting a `z.infer<>` type alias. Centralise collection
names in a single `COLLECTIONS` constant. Rewrite `http/validate.ts` and
`http/types.ts` to use `ObjectId` from `mongodb`.

## Files to Touch

- `apps/api/src/db/schemas/board.ts` — **create**
- `apps/api/src/db/schemas/card.ts` — **create**
- `apps/api/src/db/schemas/column.ts` — **create**
- `apps/api/src/db/schemas/label.ts` — **create**
- `apps/api/src/db/schemas/attachment.ts` — **create**
- `apps/api/src/db/schemas/team.ts` — **create**
- `apps/api/src/db/schemas/team-member.ts` — **create**
- `apps/api/src/db/schemas/user.ts` — **create**
- `apps/api/src/db/schemas/index.ts` — **create** (re-exports + `COLLECTIONS`
  constant + typed collection accessors)
- `apps/api/src/db/types.ts` — **keep as-is** (only contains domain `Role` /
  `BoardKind` literal unions, no Mongoose)
- `apps/api/src/db/models/` — **delete** (entire directory + all files)
- `apps/api/src/http/validate.ts` — **modify** (replace
  `mongoose.isValidObjectId` with `ObjectId.isValid`)
- `apps/api/src/http/types.ts` — **modify** (replace `mongoose.Types.ObjectId`
  with `ObjectId` from `mongodb`)

## Approach

1. **Schema files** — one per collection. Each file exports a Zod schema, a
   `z.infer<>` type alias, and the literal collection name as a constant.
   Subdocument schemas (comments, checklists, checklist items) live inside
   `card.ts`.

   Example (`db/schemas/board.ts`):

   ```ts
   import { z } from "zod";
   import { ObjectId } from "mongodb";

   export const BOARDS_COLLECTION = "boards" as const;

   export const BoardSchema = z.object({
       _id: z.instanceof(ObjectId),
       kind: z.enum(["personal", "team"]),
       title: z.string(),
       ownerId: z.instanceof(ObjectId).optional(),
       teamId: z.instanceof(ObjectId).optional(),
       createdAt: z.date(),
       updatedAt: z.date(),
   });

   export type Board = z.infer<typeof BoardSchema>;
   ```

   Repeat for every collection — see the audit table in `PLAN-003.md` for
   field lists. Critical details:

   - `Card` includes the subdocument arrays. Sketch:

     ```ts
     const CommentSchema = z.object({
         _id: z.instanceof(ObjectId),
         authorId: z.instanceof(ObjectId),
         body: z.string(),
         createdAt: z.date(),
         updatedAt: z.date().optional(),
     });
     const ChecklistItemSchema = z.object({
         _id: z.instanceof(ObjectId),
         text: z.string(),
         checked: z.boolean(),
     });
     const ChecklistSchema = z.object({
         _id: z.instanceof(ObjectId),
         title: z.string(),
         items: z.array(ChecklistItemSchema),
     });

     export const CardSchema = z.object({
         _id: z.instanceof(ObjectId),
         boardId: z.instanceof(ObjectId),
         columnId: z.instanceof(ObjectId),
         title: z.string(),
         description: z.string().nullable().optional(),
         position: z.string(),
         dueDate: z.date().nullable().optional(),
         labelIds: z.array(z.instanceof(ObjectId)),
         assigneeIds: z.array(z.instanceof(ObjectId)),
         attachmentIds: z.array(z.instanceof(ObjectId)),
         comments: z.array(CommentSchema),
         checklists: z.array(ChecklistSchema),
         createdAt: z.date(),
         updatedAt: z.date(),
     });
     export type Card = z.infer<typeof CardSchema>;
     ```

   - `Attachment` has `createdAt` only (no `updatedAt` — Mongoose was
     configured `{ createdAt: true, updatedAt: false }`).
   - `Label` has no timestamps.
   - `TeamMember` has `joinedAt: z.date()` and `role: z.enum(["admin","member"])`.
   - `Team` has timestamps plus optional `teamBoardId: z.instanceof(ObjectId).optional()`.
   - `User` (Better-Auth-owned `user` collection) is intentionally permissive:

     ```ts
     export const USER_COLLECTION = "user" as const;
     export const UserSchema = z.object({
         _id: z.string(), // Better Auth stores user IDs as strings, not ObjectIds
         email: z.string(),
         name: z.string().optional(),
         personalBoardId: z.instanceof(ObjectId).optional(),
     }).passthrough();
     export type User = z.infer<typeof UserSchema>;
     ```

     **Note**: Better Auth stores `_id` as a string (UUID/cuid) for `user`,
     not as `ObjectId`. The current Mongoose stub used
     `Schema.Types.ObjectId` for `personalBoardId` but `_id` came through
     opaquely from Better Auth. Preserve this by typing `_id: z.string()`
     and reading the collection without forcing ObjectId conversion.

2. **`db/schemas/index.ts`** — single export point that pairs each
   collection name with its type and (optionally) a typed accessor:

   ```ts
   import { db } from "../connection.js";
   import { type Board, BOARDS_COLLECTION } from "./board.js";
   import { type Card, CARDS_COLLECTION } from "./card.js";
   import { type Column, COLUMNS_COLLECTION } from "./column.js";
   import { type Label, LABELS_COLLECTION } from "./label.js";
   import { type Attachment, ATTACHMENTS_COLLECTION } from "./attachment.js";
   import { type Team, TEAMS_COLLECTION } from "./team.js";
   import { type TeamMember, TEAM_MEMBERS_COLLECTION } from "./team-member.js";
   import { type User, USER_COLLECTION } from "./user.js";

   export const COLLECTIONS = {
       boards: BOARDS_COLLECTION,
       cards: CARDS_COLLECTION,
       columns: COLUMNS_COLLECTION,
       labels: LABELS_COLLECTION,
       attachments: ATTACHMENTS_COLLECTION,
       teams: TEAMS_COLLECTION,
       teamMembers: TEAM_MEMBERS_COLLECTION,
       user: USER_COLLECTION,
   } as const;

   export const boards = () => db.collection<Board>(COLLECTIONS.boards);
   export const cards = () => db.collection<Card>(COLLECTIONS.cards);
   export const columns = () => db.collection<Column>(COLLECTIONS.columns);
   export const labels = () => db.collection<Label>(COLLECTIONS.labels);
   export const attachments = () =>
       db.collection<Attachment>(COLLECTIONS.attachments);
   export const teams = () => db.collection<Team>(COLLECTIONS.teams);
   export const teamMembers = () =>
       db.collection<TeamMember>(COLLECTIONS.teamMembers);
   export const users = () => db.collection<User>(COLLECTIONS.user);

   export type {
       Board, Card, Column, Label, Attachment, Team, TeamMember, User,
   };
   export { BoardSchema } from "./board.js";
   export { CardSchema } from "./card.js";
   export { ColumnSchema } from "./column.js";
   export { LabelSchema } from "./label.js";
   export { AttachmentSchema } from "./attachment.js";
   export { TeamSchema } from "./team.js";
   export { TeamMemberSchema } from "./team-member.js";
   export { UserSchema } from "./user.js";
   ```

   Sibling slices call e.g. `await boards().findOne({...})` — the function
   form ensures the collection is resolved every time and we never close
   over a stale `Db` reference.

   Collection-name values are pinned to the Mongoose-pluralised forms
   (`"teammembers"`, `"boards"`, etc.) — see the table in PLAN-003.md.

3. **Delete `apps/api/src/db/models/`** entirely (all eight files).

4. **`http/validate.ts`** — keep the same exported signature so no caller
   changes:

   ```ts
   import { ObjectId } from "mongodb";
   import { AppError } from "./error.js";
   ...
   export function validateObjectId(
       value: string | undefined, name: string,
   ): string {
       if (!value || !ObjectId.isValid(value)) {
           throw new AppError("VALIDATION_ERROR", `${name} must be a valid id`);
       }
       return value;
   }
   ```

   `zValidator` is unaffected — keep it identical, drop the `mongoose` import.

5. **`http/types.ts`** — swap `mongoose.Types.ObjectId` for `ObjectId`:

   ```ts
   import type { ObjectId } from "mongodb";

   export interface ContextBoard {
       _id: ObjectId;
       kind: string;
       title: string;
       ownerId?: ObjectId;
       teamId?: ObjectId;
   }
   ```

## Interface Contract

Modules published by this slice and consumed by every sibling slice:

```ts
// apps/api/src/db/schemas/index.ts
export const COLLECTIONS: {
    readonly boards: "boards";
    readonly cards: "cards";
    readonly columns: "columns";
    readonly labels: "labels";
    readonly attachments: "attachments";
    readonly teams: "teams";
    readonly teamMembers: "teammembers";  // note: lowercase, single word — Mongoose default
    readonly user: "user";
};

export function boards(): Collection<Board>;
export function cards(): Collection<Card>;
export function columns(): Collection<Column>;
export function labels(): Collection<Label>;
export function attachments(): Collection<Attachment>;
export function teams(): Collection<Team>;
export function teamMembers(): Collection<TeamMember>;
export function users(): Collection<User>;

export type Board, Card, Column, Label, Attachment, Team, TeamMember, User;
export { BoardSchema, CardSchema, ... };
```

`validateObjectId(value, name)` signature unchanged: `(string | undefined, string) => string`.

`ContextBoard` type unchanged in shape; only the `ObjectId` import source
changes (`mongoose` → `mongodb`).

## Acceptance Criteria

- [ ] `apps/api/src/db/schemas/` contains nine files (eight collection
      schemas + `index.ts`).
- [ ] Each collection file exports a schema, a `z.infer<>` alias, and a
      `<NAME>_COLLECTION` string constant matching the Mongoose-pluralised
      collection name.
- [ ] `db/schemas/index.ts` exports the `COLLECTIONS` constant and a typed
      accessor function per collection.
- [ ] `apps/api/src/db/models/` no longer exists.
- [ ] `http/validate.ts` uses `ObjectId.isValid` and exports
      `validateObjectId` with the exact same signature.
- [ ] `http/types.ts` imports `ObjectId` from `mongodb`, not `mongoose`.
- [ ] No file in this slice imports from `mongoose`.
- [ ] `z.infer<typeof BoardSchema>` etc. produces types compatible with the
      driver's `Collection<DocType>` generic constraint.
