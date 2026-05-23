---
plan: PLAN-003
title: "Index bootstrap"
complexity: 1
---

# Index bootstrap

## Objective

Create `apps/api/src/db/indexes.ts` exporting an idempotent `ensureIndexes()`
function that creates every index previously declared on the Mongoose
schemas, including the two partial-unique board indexes. Wire it into
`src/index.ts` after `connectDB()` resolves.

## Files to Touch

- `apps/api/src/db/indexes.ts` — **create**
- `apps/api/src/index.ts` — **modify** (call `ensureIndexes()` between
  `connectDB()` and `serve(...)` — this hook is already added by
  slice-connection; this slice provides the real implementation)

## Approach

Implement `ensureIndexes()` as a single async function that iterates over
every required index and calls `createIndex` on the corresponding typed
collection. Native `createIndex` is idempotent when the definition matches;
mismatches throw, which is the desired behaviour (REQ US-7 edge case).

```ts
import {
    boards, cards, columns, labels, attachments, teams, teamMembers,
} from "./schemas/index.js";

export async function ensureIndexes(): Promise<void> {
    // teams.domain — unique
    await teams().createIndex({ domain: 1 }, { unique: true });

    // teamMembers — composite unique (teamId, userId) + single-field indexes
    await teamMembers().createIndex(
        { teamId: 1, userId: 1 },
        { unique: true },
    );
    await teamMembers().createIndex({ teamId: 1 });
    await teamMembers().createIndex({ userId: 1 });

    // boards — two partial unique indexes
    await boards().createIndex(
        { ownerId: 1 },
        { unique: true, partialFilterExpression: { kind: "personal" } },
    );
    await boards().createIndex(
        { teamId: 1 },
        { unique: true, partialFilterExpression: { kind: "team" } },
    );

    // columns — boardId index + compound (boardId, position)
    await columns().createIndex({ boardId: 1 });
    await columns().createIndex({ boardId: 1, position: 1 });

    // cards — boardId, columnId, compound (columnId, position)
    await cards().createIndex({ boardId: 1 });
    await cards().createIndex({ columnId: 1 });
    await cards().createIndex({ columnId: 1, position: 1 });

    // labels — boardId
    await labels().createIndex({ boardId: 1 });

    // attachments — cardId + boardId
    await attachments().createIndex({ cardId: 1 });
    await attachments().createIndex({ boardId: 1 });

    console.log("[mongodb] ensureIndexes complete");
}
```

If an existing index has the same name but a conflicting definition,
`createIndex` throws and `ensureIndexes()` propagates the error to
`src/index.ts`'s `main().catch(...)` — startup aborts visibly, as required
by REQ US-7 edge case.

## Interface Contract

```ts
// apps/api/src/db/indexes.ts
export function ensureIndexes(): Promise<void>;
```

Called once from `src/index.ts` after `connectDB()` returns and before
`serve(...)`. Throws on any conflict; throwing aborts startup.

## Acceptance Criteria

- [ ] `db/indexes.ts` exports `ensureIndexes`.
- [ ] All Mongoose-declared indexes are recreated (see the audit table in
      PLAN-003.md):
  - [ ] `teams { domain: 1 }` unique
  - [ ] `teammembers { teamId: 1, userId: 1 }` unique
  - [ ] `teammembers { teamId: 1 }`
  - [ ] `teammembers { userId: 1 }`
  - [ ] `boards { ownerId: 1 }` unique + partial filter `kind: "personal"`
  - [ ] `boards { teamId: 1 }` unique + partial filter `kind: "team"`
  - [ ] `columns { boardId: 1 }`
  - [ ] `columns { boardId: 1, position: 1 }`
  - [ ] `cards { boardId: 1 }`
  - [ ] `cards { columnId: 1 }`
  - [ ] `cards { columnId: 1, position: 1 }`
  - [ ] `labels { boardId: 1 }`
  - [ ] `attachments { cardId: 1 }`
  - [ ] `attachments { boardId: 1 }`
- [ ] Calling `ensureIndexes()` twice in a row succeeds (idempotent on a
      fresh DB and on a DB where the indexes already exist with the same
      definition).
- [ ] Any conflicting pre-existing index causes `ensureIndexes()` to throw —
      the error is not swallowed.
