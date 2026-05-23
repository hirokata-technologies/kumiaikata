---
plan: PLAN-003
title: "Boards + teams + auth services"
complexity: 3
---

# Boards + teams + auth services

## Objective

Rewrite the boards-and-teams data-access path: `services/boards.ts`,
`services/teams.ts`, `auth/provisioning.ts`, `auth/middleware.ts` (including
the `fetchBoardWithMembership` aggregation and the `BoardWithMembership`
type), `routes/boards.ts`, `routes/teams.ts`. Drop all Mongoose imports;
use native CRUD, `withTransaction`, and native aggregation.

## Files to Touch

- `apps/api/src/services/boards.ts` — **rewrite**
- `apps/api/src/services/teams.ts` — **rewrite**
- `apps/api/src/auth/provisioning.ts` — **rewrite**
- `apps/api/src/auth/middleware.ts` — **rewrite** (preserve `requireSession`,
  `loadBoardAccess`, `requireBoardAdmin`, `deriveAccess`, `fetchBoardWithMembership`
  exports — only internals change)
- `apps/api/src/routes/boards.ts` — **modify** (replace direct Mongoose
  imports with native collection accessors)
- `apps/api/src/routes/teams.ts` — **modify** (same — also keep the
  `_id`-as-string handling for the Better-Auth `user` collection)

## Approach

Throughout this slice, replace every Mongoose model import with the typed
accessor from `db/schemas/index.js`. Convert string IDs to `ObjectId` only
when needed for filters; route params have already passed through
`validateObjectId` so they are valid 24-hex strings. Continue serialising
`_id` with `String(...)` at the response boundary.

### `services/boards.ts`

`getBoardWithColumnsAndCards(boardId)`:

```ts
import { ObjectId } from "mongodb";
import { boards, columns, cards } from "../db/schemas/index.js";

export async function getBoardWithColumnsAndCards(
    boardId: string,
): Promise<BoardWithColumnsAndCards> {
    const board = await boards().findOne({ _id: new ObjectId(boardId) });
    if (!board) throw new Error(`Board ${boardId} not found`);

    const cols = await columns()
        .find({ boardId: board._id })
        .sort({ position: 1 })
        .toArray();

    const columnIds = cols.map((c) => c._id);
    const cardDocs = columnIds.length > 0
        ? await cards()
              .find({ columnId: { $in: columnIds } })
              .sort({ position: 1 })
              .toArray()
        : [];

    // unchanged from current implementation: build cardsByColumnId map,
    // assemble BoardWithColumnsAndCards.
    ...
}
```

Keep the existing `BoardWithColumnsAndCards` / `ColumnWithCards` /
`CardSummary` interfaces verbatim — they are output shapes, not document
types.

### `services/teams.ts`

`getTeamForUser`, `listMembers`, `setMemberRole`:

```ts
import { ObjectId } from "mongodb";
import { teams, teamMembers } from "../db/schemas/index.js";
import { AppError } from "../http/error.js";
import type { Role } from "../db/types.js";

export async function getTeamForUser(userId: string): Promise<TeamForUser> {
    const membership = await teamMembers().findOne({ userId: new ObjectId(userId) });
    if (!membership) throw new AppError("NOT_FOUND", "No team membership found.");
    const team = await teams().findOne({ _id: membership.teamId });
    if (!team) throw new AppError("NOT_FOUND", "Team not found.");
    return {
        id: String(team._id),
        domain: team.domain,
        name: team.name,
        role: membership.role,
    };
}

export async function listMembers(teamId: string): Promise<TeamMemberRow[]> {
    const rows = await teamMembers()
        .find({ teamId: new ObjectId(teamId) })
        .toArray();
    return rows.map((r) => ({
        userId: String(r.userId),
        email: "",
        role: r.role,
        joinedAt: r.joinedAt,
    }));
}

export async function setMemberRole(
    teamId: string,
    targetUserId: string,
    newRole: Role,
    actorId: string,
): Promise<{ userId: string; role: Role }> {
    const teamObjId = new ObjectId(teamId);
    const targetObjId = new ObjectId(targetUserId);
    const actorObjId = new ObjectId(actorId);

    const actorMembership = await teamMembers().findOne({
        teamId: teamObjId, userId: actorObjId,
    });
    if (!actorMembership || actorMembership.role !== "admin") {
        throw new AppError("FORBIDDEN", "Only team admins may change roles.");
    }

    const target = await teamMembers().findOne({
        teamId: teamObjId, userId: targetObjId,
    });
    if (!target) {
        throw new AppError("NOT_FOUND", "User is not a member of this team.");
    }

    if (target.role === "admin" && newRole === "member") {
        const adminCount = await teamMembers().countDocuments({
            teamId: teamObjId, role: "admin",
        });
        if (adminCount <= 1) {
            throw new AppError("CONFLICT",
                "At least one admin must remain on the team.");
        }
    }

    await teamMembers().updateOne(
        { _id: target._id },
        { $set: { role: newRole } },
    );

    return { userId: targetUserId, role: newRole };
}
```

**ID-type note**: the existing Mongoose code passes raw string `userId` /
`teamId` to Mongoose, which auto-casts strings to ObjectId based on schema.
After migration, we explicitly wrap with `new ObjectId(...)`. Route params
have already passed through `validateObjectId`, so this is safe.

### `auth/provisioning.ts`

Convert the whole function to use `withTransaction` from `db/connection`
and native collection ops. The user ID coming from Better Auth is a string;
existing code passes it to Mongoose which casts. Inspect both
`User.updateOne({ _id: user.id }, ...)` and Better Auth's actual stored
form — Better Auth stores `_id` as the string ID it generates, so do **not**
wrap `user.id` in `new ObjectId(...)` when filtering the `user` collection.

```ts
import { ObjectId } from "mongodb";
import { withTransaction } from "../db/connection.js";
import {
    boards as boardsColl,
    teams as teamsColl,
    teamMembers as teamMembersColl,
    users as usersColl,
} from "../db/schemas/index.js";
import { domainOf } from "./domain-allowlist.js";

export async function provisionUser(user: {
    id: string;
    email: string;
    name?: string | null | undefined;
}): Promise<void> {
    try {
        await withTransaction(async (session) => {
            // 1. Personal board
            const firstName = (user.name ?? "").split(" ")[0] ?? "";
            const boardTitle = firstName ? `${firstName}'s Board` : "My Board";
            const personalBoardInsert = await boardsColl().insertOne(
                {
                    kind: "personal",
                    title: boardTitle,
                    ownerId: user.id as unknown as ObjectId, // see ID note below
                    createdAt: new Date(),
                    updatedAt: new Date(),
                } as any,
                { session },
            );
            await usersColl().updateOne(
                { _id: user.id }, // Better Auth user._id is a string
                { $set: { personalBoardId: personalBoardInsert.insertedId } },
                { session },
            );

            // 2. Team find-or-create
            const domain = domainOf(user.email);
            const teamResult = await teamsColl().findOneAndUpdate(
                { domain },
                { $setOnInsert: { domain, name: domain, createdAt: new Date(), updatedAt: new Date() } },
                { upsert: true, returnDocument: "after", session },
            );
            if (!teamResult) {
                throw new Error(`[provisioning] team upsert returned null for domain ${domain}`);
            }

            // 3. Team board find-or-create
            if (!teamResult.teamBoardId) {
                const teamBoardInsert = await boardsColl().insertOne(
                    {
                        kind: "team",
                        title: `${domain} Board`,
                        teamId: teamResult._id,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    } as any,
                    { session },
                );
                await teamsColl().updateOne(
                    { _id: teamResult._id },
                    { $set: { teamBoardId: teamBoardInsert.insertedId } },
                    { session },
                );
            }

            // 4. Team membership upsert — first member becomes admin
            const existingCount = await teamMembersColl().countDocuments(
                { teamId: teamResult._id },
                { session },
            );
            const role: "admin" | "member" = existingCount === 0 ? "admin" : "member";
            await teamMembersColl().updateOne(
                { teamId: teamResult._id, userId: user.id as unknown as ObjectId },
                {
                    $setOnInsert: {
                        teamId: teamResult._id,
                        userId: user.id as unknown as ObjectId,
                        role,
                        joinedAt: new Date(),
                    },
                },
                { upsert: true, session },
            );
        });
    } catch (err) {
        console.error("[provisioning] failed to provision user", {
            userId: user.id, email: user.email, error: err,
        });
        throw err;
    }
}
```

**Critical ID-type investigation required**: today's Mongoose code passes
`user.id` (a string from Better Auth) to schemas that declare
`ownerId: Schema.Types.ObjectId` and `userId: Schema.Types.ObjectId`.
Mongoose auto-casts. Two possibilities to verify by inspecting an existing
production document:

- **Hypothesis A**: Better Auth's `user._id` is itself a 24-hex string that
  Mongoose casts to `ObjectId`. In that case, persisted documents have
  `ownerId` and `userId` as real `ObjectId` instances. Wrap with
  `new ObjectId(user.id)` in the native rewrite.
- **Hypothesis B**: Better Auth's `user._id` is a CUID/UUID (non-24-hex
  string), and Mongoose throws or silently stores garbage. Documents are
  currently broken or stored with string IDs.

Before completing this slice, run a one-liner against the dev DB to inspect
the actual `ownerId` / `userId` BSON type:
`db.boards.findOne({ kind: "personal" }).ownerId` — if it's `ObjectId(...)`
then wrap; if it's a string then keep as string and update the Zod schemas
in `slice-schemas` accordingly. **Do not guess**. If the inspection cannot
be performed, default to **wrapping with `new ObjectId(...)`** to match
the current Mongoose schema declaration, but document the assumption in the
PR.

### `auth/middleware.ts`

Preserve all exported names. Rewrite `BoardWithMembership` to use
`ObjectId` from `mongodb`. Rewrite `fetchBoardWithMembership` with native
aggregation:

```ts
import { ObjectId } from "mongodb";
import { createMiddleware } from "hono/factory";
import type { AppVariables, BoardAccess } from "../http/types.js";
import { boards as boardsColl } from "../db/schemas/index.js";
import { AppError } from "../http/error.js";
import { validateObjectId } from "../http/validate.js";
import { auth } from "./better-auth.js";

export interface BoardWithMembership {
    _id: ObjectId;
    kind: string;
    title: string;
    ownerId?: ObjectId;
    teamId?: ObjectId;
    membership?: { role: string } | null;
}

export async function fetchBoardWithMembership(
    boardId: string,
    userId: string,
): Promise<BoardWithMembership | null> {
    if (!ObjectId.isValid(boardId)) return null;
    const boardObjectId = new ObjectId(boardId);
    // user IDs follow the same hypothesis A/B note as provisioning.ts;
    // mirror the same choice here.
    const userObjectId = new ObjectId(userId);

    const cursor = boardsColl().aggregate<BoardWithMembership>([
        { $match: { _id: boardObjectId } },
        {
            $lookup: {
                from: "teammembers", // preserved Mongoose-default collection name
                let: { teamId: "$teamId" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$teamId", "$$teamId"] },
                                    { $eq: ["$userId", userObjectId] },
                                ],
                            },
                        },
                    },
                    { $project: { _id: 0, role: 1 } },
                    { $limit: 1 },
                ],
                as: "membershipArr",
            },
        },
        { $addFields: { membership: { $arrayElemAt: ["$membershipArr", 0] } } },
        { $project: { membershipArr: 0 } },
    ]);

    const results = await cursor.toArray();
    return results[0] ?? null;
}
```

Note: `.toArray()` closes the cursor automatically (REQ US-4 AC 4).

`loadBoardAccess`, `deriveAccess`, `requireSession`, `requireBoardAdmin` —
internals identical aside from the ObjectId import source. `ContextBoard`
import comes from `http/types.ts` (now native).

### `routes/boards.ts`

```ts
import { ObjectId } from "mongodb";
import { boards as boardsColl, teamMembers as teamMembersColl } from "../db/schemas/index.js";
...

r.get("/personal", async (c) => {
    const user = c.get("user");
    const board = await boardsColl().findOne({
        kind: "personal", ownerId: new ObjectId(user.id),
    });
    if (!board) throw new AppError("NOT_FOUND",
        "Personal board missing — provisioning may have failed.");
    return ok(c, await getBoardWithColumnsAndCards(String(board._id)));
});

r.get("/team", async (c) => {
    const user = c.get("user");
    const membership = await teamMembersColl().findOne({
        userId: new ObjectId(user.id),
    });
    if (!membership) throw new AppError("NOT_FOUND", "No team membership found.");
    const board = await boardsColl().findOne({
        kind: "team", teamId: membership.teamId,
    });
    if (!board) throw new AppError("NOT_FOUND", "Team board missing.");
    return ok(c, await getBoardWithColumnsAndCards(String(board._id)));
});
```

### `routes/teams.ts`

The `/:teamId/members` endpoint resolves member emails by reading the
Better-Auth `user` collection. Better Auth stores `_id` as a **string**, so
the `$in` query stays a string array (no ObjectId wrapping):

```ts
import { ObjectId } from "mongodb";
import { teams as teamsColl, teamMembers as teamMembersColl, users as usersColl } from "../db/schemas/index.js";
...

r.get("/mine", async (c) => {
    const user = c.get("user");
    const m = await teamMembersColl().findOne({ userId: new ObjectId(user.id) });
    if (!m) throw new AppError("NOT_FOUND", "No team membership.");
    const team = await teamsColl().findOne({ _id: m.teamId });
    if (!team) throw new AppError("NOT_FOUND", "Team not found.");
    return ok(c, {
        id: String(team._id), domain: team.domain, name: team.name, role: m.role,
    });
});

r.get("/:teamId/members", async (c) => {
    const user = c.get("user");
    const teamId = validateObjectId(c.req.param("teamId"), "teamId");
    const teamObjId = new ObjectId(teamId);
    const self = await teamMembersColl().findOne({
        teamId: teamObjId, userId: new ObjectId(user.id),
    });
    if (!self) throw new AppError("FORBIDDEN", "Not a member of this team.");
    const rows = await teamMembersColl().find({ teamId: teamObjId }).toArray();

    // Better Auth user IDs are strings; rows[i].userId may be ObjectId — convert
    // to string for the $in query and for the email lookup map.
    const userIdStrings = rows.map((r) => String(r.userId));
    const userDocs = await usersColl()
        .find({ _id: { $in: userIdStrings } as any }, { projection: { email: 1 } })
        .toArray();
    const emailById = new Map(userDocs.map((u) => [String(u._id), u.email]));

    return ok(c, rows.map((row) => ({
        userId: String(row.userId),
        email: emailById.get(String(row.userId)) ?? "",
        role: row.role,
        joinedAt: row.joinedAt,
    })));
});
```

(The `as any` cast on the `$in` array reflects the same Better-Auth-vs-Mongoose
ID-type discrepancy noted above; the developer resolves it once the
hypothesis A/B inspection is complete and the `User` schema's `_id` type
matches the stored form.)

`PATCH /:teamId/members/:userId` route delegates to `setMemberRole` which is
already rewritten above — no changes needed beyond the import swap.

## Interface Contract

This slice keeps every exported name and signature identical to the
pre-migration code:

```ts
// services/boards.ts
export interface CardSummary { ... } // unchanged
export interface ColumnWithCards { ... } // unchanged
export interface BoardWithColumnsAndCards { ... } // unchanged
export function getBoardWithColumnsAndCards(boardId: string): Promise<BoardWithColumnsAndCards>;

// services/teams.ts
export interface TeamForUser { ... } // unchanged
export interface TeamMemberRow { ... } // unchanged
export function getTeamForUser(userId: string): Promise<TeamForUser>;
export function listMembers(teamId: string): Promise<TeamMemberRow[]>;
export function setMemberRole(teamId, targetUserId, newRole, actorId): Promise<{ userId: string; role: Role }>;

// auth/provisioning.ts
export function provisionUser(user): Promise<void>;

// auth/middleware.ts
export const requireSession;
export const loadBoardAccess;
export const requireBoardAdmin;
export interface BoardWithMembership {
    _id: ObjectId; kind: string; title: string;
    ownerId?: ObjectId; teamId?: ObjectId;
    membership?: { role: string } | null;
}
export function fetchBoardWithMembership(boardId: string, userId: string): Promise<BoardWithMembership | null>;
export function deriveAccess(board: BoardWithMembership, user: { id: string }): BoardAccess | null;
```

Sibling slices (especially `services-labels-attachments`, which calls
`fetchBoardWithMembership` and `deriveAccess`) consume these unchanged.

## Acceptance Criteria

- [ ] No `mongoose` imports remain in any file touched by this slice.
- [ ] `fetchBoardWithMembership` uses
      `boards().aggregate(...).toArray()` and returns the same shape as the
      current implementation.
- [ ] `$lookup.from` value is `"teammembers"` (preserved Mongoose default).
- [ ] `provisionUser` uses `withTransaction` and the upsert / count /
      insert sequence preserves the current first-member-becomes-admin
      semantics.
- [ ] User-ID-vs-ObjectId hypothesis (A or B) is verified against the dev
      DB before merging and documented in the PR description.
- [ ] `routes/boards.ts` and `routes/teams.ts` respond with identical HTTP
      status codes and JSON shapes as before.
- [ ] `setMemberRole` returns `{ userId, role }` with the same value
      semantics as the current `target.save()` path.
- [ ] `pnpm --filter @kata/api check` passes for all files in this slice.
