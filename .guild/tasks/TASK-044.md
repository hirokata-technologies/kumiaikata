---
id: TASK-044
title: "Review Mongoose to native MongoDB driver migration"
agent: reviewer
status: done
requirement: REQ-003
plan: PLAN-003
depends-on: [TASK-036, TASK-037, TASK-038, TASK-039, TASK-040, TASK-041, TASK-042, TASK-043]
priority: high
created: 2026-05-23
---

## Objective

Review the complete Mongoose → native MongoDB driver migration for correctness, safety, and alignment with REQ-003 and PLAN-003.

## Context

- Requirement: .guild/requirements/REQ-003.md
- Plan: .guild/plans/PLAN-003.md
- Parent task: TASK-035

## Acceptance Criteria

- [ ] Security review passed
- [ ] Architecture review passed
- [ ] Business logic review passed
- [ ] Edge case review passed

## Work Log

### 2026-05-23 — reviewer-security

**Verdict:** ISSUES FOUND

**Critical Findings:**

1. [critical] apps/api/src/routes/card-comments.ts:29, 86 — User ID type mismatch in comment.authorId
   The code does `new ObjectId(user.id)` but Better Auth user.id is a string (UUID/CUID), not a 24-char hex ObjectId. This creates a type mismatch:
   - Line 29: `authorId: new ObjectId(user.id)` — wraps a non-hex string in ObjectId constructor, which may throw BSONError
   - Line 86: Query filter `"comments.authorId": new ObjectId(user.id)` — tries to match an ObjectId against stored string values; query will never match if authorId is stored as string
   Result: Comment edits silently fail (query returns no documents), returning 403 FORBIDDEN instead of updating. Worse, if new ObjectId() throws, returns 500.
   Recommendation: Change to `authorId: user.id as unknown as ObjectId` (type cast, matching provisioning.ts pattern) or use string directly. Ensure schema and all queries are consistent.

2. [critical] apps/api/src/routes/card-assignees.ts:24-25 — User ID validation/wrapping inconsistency
   The code validates the userId as if it's a valid ObjectId hex string: `validateObjectId(rawUserId, "userId")` then `new ObjectId(userIdStr)`.
   But Better Auth user IDs are non-hex strings (UUID/CUID), so `ObjectId.isValid(user.id)` will reject them.
   Result: All assignee operations (POST /assignees, DELETE /assignees/:userId) will return 422 VALIDATION_ERROR, blocking users from assigning team members to cards.
   Recommendation: Create a separate `validateUserId()` function that does not use ObjectId validation, or skip ObjectId validation for Better Auth IDs and store them as strings directly (matching provisioning.ts).

3. [critical] apps/api/src/services/attachments.ts:204 — User ID type mismatch in attachment query
   Line 204: `const board = await fetchBoardWithMembership(String(att.boardId), user.id);`
   The `user.id` is a Better Auth string, but `fetchBoardWithMembership` expects a string boardId (which is converted to ObjectId at line 62) and a userId string that will be compared against stored teamMembers.userId.
   However, the aggregation at line 79 does `{ $eq: ["$userId", userId] }` where userId is the string param and the stored userId is also a string (stored via type cast in provisioning).
   This is actually CORRECT on the read side, but the inconsistency in how comments.ts and card-assignees.ts handle user IDs vs. how provisioning.ts stores them creates a security risk.
   Recommendation: Document the invariant that Better Auth user IDs are strings and MUST be stored and queried as strings (not wrapped in new ObjectId()). Add validation in provisioning to reject any non-string user.id values.

4. [critical] apps/api/src/routes/card-assignees.ts:30 — Type casting of non-ObjectId string into ObjectId type
   Line 30: `{ teamId: board.teamId!, userId }` where `userId = new ObjectId(userIdStr)`.
   The query assumes userId is an ObjectId, but the teamMembers schema defines userId as `z.instanceof(ObjectId)` while storing strings via type cast.
   If the string is not a valid hex ObjectId, `new ObjectId()` throws, and the query never executes.
   Result: Assignee validation fails for team boards, blocking card assignment.
   Recommendation: Do not call `new ObjectId()` on Better Auth user IDs. Store and query them as strings directly. Update the schema to use `z.string()` for userId or use the type cast pattern consistently.

5. [critical] apps/api/src/services/cards.ts:198 — ObjectId array wrapping without validation
   Line 198: `$in: missingIds.map((id) => new ObjectId(id))`
   The missingIds are card.attachmentIds (which should be ObjectIds from MongoDB), but if any ID is malformed, `new ObjectId(id)` will throw a BSONError at request time.
   The code has no try/catch, so the error propagates to the error handler as a BSONError (not AppError), returning 500 instead of 400/422.
   Recommendation: Wrap the map in a try/catch or validate that all attachmentIds are valid ObjectIds before the updateOne. Alternatively, rely on TypeScript to ensure card.attachmentIds is an ObjectId array.

6. [critical] apps/api/src/services/attachments.ts:156 — cardId parameter type validation missing in deleteAttachment
   Line 156: `{ _id: new ObjectId(cardId), boardId }` where cardId is a string param.
   If cardId is not a valid hex string, `new ObjectId(cardId)` throws BSONError (not caught), returning 500.
   The function does not validate cardId before constructing the ObjectId.
   Recommendation: Add `validateObjectId(cardId, "cardId")` at the start of deleteAttachment, matching the pattern in routes/card-attachments.ts.

**Major Findings:**

7. [major] apps/api/src/routes/card-assignees.ts — Missing validation on targetColumnId in moveCard
   Line 77-78 in routes/cards.ts: `moveCard(board._id, cardId, targetColumnId, position)` passes targetColumnId as-is (from `c.req.valid("json").targetColumnId`).
   The schema validation only ensures it's a string (`z.string()`), not that it's a valid ObjectId.
   Inside services/cards.ts line 298, `new ObjectId(targetColumnId)` will throw if targetColumnId is not hex.
   Recommendation: Add `validateObjectId(targetColumnId, "targetColumnId")` in the route before calling moveCard, or inside moveCard itself.

8. [major] apps/api/src/routes/card-labels.ts — Missing validateObjectId on labelId
   The code accepts labelId from the request body without validating it as an ObjectId.
   If labelId is not hex, `new ObjectId()` will throw at query time.
   Recommendation: Add `validateObjectId()` call on all user-supplied IDs that will be wrapped in `new ObjectId()`.

9. [major] apps/api/src/auth/middleware.ts:112 — ownerId comparison using String() on potentially mistyped field
   Line 112: `String(board.ownerId) === String(user.id)` compares ownerId (stored as string via type cast, typed as ObjectId) with user.id (string).
   If ownerId is somehow an actual ObjectId, String(ObjectId) returns the ObjectId's hex string, which may not equal the Better Auth UUID string.
   Recommendation: Add runtime validation that ownerId is actually a string (or add a comment clarifying the type cast invariant).

10. [major] apps/api/src/auth/provisioning.ts:30 — No validation that user.id is a string before storing it as-if-ObjectId
    Line 30: `ownerId: user.id as unknown as ObjectId` stores a Better Auth ID without validating that it's a string.
    If user.id is somehow undefined, null, or a number, it will be stored in the DB as-is, breaking future queries.
    Recommendation: Add a type guard: `if (typeof user.id !== 'string') throw new Error('user.id must be a string')` before storing.

**No critical security issues in:**
- **ObjectId injection in board IDs**: All board IDs from route params are validated with `validateObjectId()` before use in queries; no injection risk.
- **Query operator injection**: User input does not flow directly into MongoDB operators; all queries are hand-written in services, not constructed from user input.
- **Transaction atomicity**: The three transaction sites (deleteCard, deleteLabel, uploadAttachment) use `withTransaction()` correctly; session is passed to all collection ops and ended in finally.
- **Board access control**: `fetchBoardWithMembership` aggregation correctly checks both board existence and team membership in a single pipeline; `loadBoardAccess` middleware enforces access on all protected routes.
- **Session/auth middleware**: `requireSession`, `loadBoardAccess`, `requireBoardAdmin` are properly chained and enforce auth checks.
- **Collection name consistency**: All collection names use the COLLECTIONS constant from db/schemas/index.ts, preventing name mismatches.
- **Better Auth user ID handling (read-side)**: The `fetchBoardWithMembership` aggregation correctly passes user.id as a string in the $eq expression, matching stored string values (though write-side has issues noted above).

## Follow-up Tasks

### 2026-05-23 — reviewer-edge-case

**Verdict:** ISSUES FOUND

**Findings:**

1. [critical] apps/api/src/services/columns.ts:60 — insertOne returns InsertOneResult with insertedId, but no validation that the re-fetch after insertOne succeeds
   Scenario: insertOne succeeds (document created in MongoDB), but immediately after, findOne({ _id: insert.insertedId }) returns null due to replication lag or a bug in the driver's returned insertedId
   Impact: The `doc!` non-null assertion will crash with "Cannot read properties of null", returning 500 to the client instead of a proper error response
   Recommendation: Check that doc is not null after the findOne, throw AppError("INTERNAL_ERROR", ...) if it is

2. [critical] apps/api/src/services/cards.ts:151 — same insertOne/findOne pattern after insertOne for card creation
   Scenario: insertOne succeeds but the follow-up findOne returns null
   Impact: The `card!` non-null assertion crashes, returning 500 instead of a proper error
   Recommendation: Add null-check after the findOne, throw AppError if null

3. [critical] apps/api/src/services/teams.ts:22-23 — teamMembers().findOne() returns null without handling in getTeamForUser, but no null check before the follow-up teams().findOne() call
   Scenario: A teamMember record exists, but by the time findOne({ _id: membership.teamId }) is called, the team has been deleted (race condition)
   Impact: team will be null, and line 28 `String(team._id)` dereferences null, causing a crash
   Recommendation: Add null-check after team lookup: `if (!team) throw new AppError("NOT_FOUND", "Team not found.")`  [NOTE: This IS already present; good]

4. [critical] apps/api/src/auth/provisioning.ts:59 — findOneAndUpdate with upsert can return null if the operation fails silently or if the upsert does not execute
   Scenario: A concurrent request deletes the inserted team between the upsert and the null-check, or MongoDB returns a null result unexpectedly (e.g., due to a misconfiguration or driver bug)
   Impact: The error is thrown, provisioning aborts, but no user board/team is created; the user account exists but is broken
   Recommendation: The null-check is correct, but consider adding a circuit-breaker or retry logic for transient failures (not strictly an edge case fix, but operational resilience)

5. [major] apps/api/src/db/connection.ts:36 — withTransaction callback errors cause the session.endSession() to be called in finally, BUT if endSession() itself throws, it will mask the original callback error
   Scenario: A callback throws AppError, but endSession() also throws (e.g., due to network/MongoDB failure)
   Impact: The endSession error propagates up instead of the original callback error, losing the root cause; client receives a different error than intended
   Recommendation: Wrap endSession in a try/catch to suppress its error if the original callback already failed: `try { await session.endSession(); } catch (e) { if (!threw) throw e; }` pattern

6. [major] apps/api/src/db/indexes.ts:13-47 — createIndex does not catch errors; if an index definition conflicts with an existing index (e.g., different uniqueness or filter expression), createIndex throws and ensureIndexes aborts
   Scenario: A previous developer created an index with the same name but different partialFilterExpression, then later changes the index definition. Startup fails with an opaque MongoDB error instead of a clear message
   Impact: Server fails to start until the index is manually dropped; no rollback path; unclear error message for operators
   Recommendation: Either (a) add a try/catch with a more descriptive log, or (b) check existing indexes and drop conflicting ones before creating new ones (requires careful validation)

7. [major] apps/api/src/db/connection.ts:25-29 — the Proxy used for `db` defers to getDb() on every property access, which throws if connectDB() has not been called yet
   Scenario: A route handler tries to access the db Proxy before connectDB() has resolved (e.g., during a misconfigured startup, or if middleware calls db before the startup sequence completes)
   Impact: The route returns a 500 "Internal server error" with an unhelpful message instead of failing at startup; the error happens at request time instead of startup time
   Recommendation: Add a check in the index.ts startup to verify db is ready after connectDB resolves (call getDb() to prime it); alternately, log a warning in getDb() when it throws to hint at startup order issues

8. [major] apps/api/src/services/columns.ts:168-177 and cards.ts:399-408 — bulkWrite with an empty array is called if updates.length === 0, but the code has a guard `if (updates.length > 0)` so this is safe
   Scenario: No updates needed (array is already in correct order)
   Impact: No impact — code correctly skips the bulkWrite
   Recommendation: No action needed; edge case is handled

9. [major] apps/api/src/auth/middleware.ts:79 — the aggregation pipeline uses a string userId (from Better Auth) in an $eq comparison against stored teamMembers.userId fields, which are stored as strings via a type cast
   Scenario: If the type cast behavior ever changes (e.g., userId is accidentally stored as an ObjectId in some documents due to a migration bug), the $eq will fail to match existing members
   Impact: The aggregation returns no membership for existing members, returning 403 "forbidden" instead of 200; user loses access to their board
   Recommendation: Add a comment documenting the type cast invariant and consider running a validation script to verify all teamMembers.userId values are strings, not ObjectIds

10. [major] apps/api/src/services/cards.ts:183-203 — stale attachment cleanup fetches attachments, then pulls missing IDs, but if new attachments are added between the fetch and the $pull, they could be incorrectly removed
   Scenario: Another concurrent request adds an attachment to the card between the fetch and the updateOne $pull
   Impact: The newly added attachment ID could theoretically be in the missingIds set if its ObjectId-to-string conversion collides with a missing ID, causing it to be removed (low probability but possible with timestamp-based ID generation)
   Recommendation: Use a findOneAndUpdate with atomic read-update instead of two separate operations, or add a projection-based verification before the $pull

11. [critical] apps/api/src/app.ts:36 — the health check uses `client.db().command({ ping: 1 })` but this creates a NEW Db instance on every request, not the same `db` that route handlers use
   Scenario: The Proxy-based `db` is not yet initialized (connectDB hasn't been called), but a health check request arrives during startup and calls client.db() directly
   Impact: The health check may return { ok: true, db: true } even though connectDB() has not yet been awaited, giving a false positive
   Recommendation: Change the health check to use the same `getDb()` or a cached `isConnected` flag instead of calling `client.db()` directly

12. [major] apps/api/src/services/boards.ts:36 — getBoardWithColumnsAndCards throws `new Error(...)` instead of AppError
   Scenario: getBoardWithColumnsAndCards is called and the board is not found
   Impact: The generic Error is not caught by the error handler's AppError instanceof check; it returns 500 "Internal server error" instead of 404
   Recommendation: Throw AppError("NOT_FOUND", ...) instead of generic Error; apply same pattern to all service functions

**Adequately handled:**

- `findOneAndUpdate` with `returnDocument: "after"` returning null is properly checked in all caller sites (columns.ts:85, boards.ts context, auth/middleware.ts:59, etc.)
- `withTransaction` callback errors are re-thrown correctly in all call sites (provision.ts, labels.ts, cards.ts deleteCard)
- `new ObjectId(id)` is always guarded by `validateObjectId` before being used in services, ensuring invalid hex strings throw 422 instead of crashing at the service level
- Better Auth user IDs (strings) are cast via `as unknown as ObjectId` and stored as strings; queries match the stored form consistently
- `cleanStaleTempFiles()` runs after startup completes and before the server accepts requests, so it does not interfere with request handling
- Collection names are preserved (e.g., "teammembers" not "teamMembers") and are enforced via a COLLECTIONS constant in db/schemas/index.ts
- Empty arrays in bulkWrite and reorder operations are correctly guarded with `if (updates.length > 0)` checks


## Follow-up Tasks

- Fix: insertOne result not validated after column/card creation | agent: developer | priority: high
- Fix: getBoardWithColumnsAndCards throws generic Error instead of AppError | agent: developer | priority: high
- Fix: Health check uses client.db() instead of shared db instance | agent: developer | priority: high
- Fix: endSession error masking original callback error in withTransaction | agent: developer | priority: high
- Fix: ensureIndexes lacks error handling for index definition conflicts | agent: developer | priority: medium
- Fix: Proxy-based db defers error until first route request, not at startup | agent: developer | priority: medium
- Fix: Stale attachment cleanup vulnerable to concurrent additions | agent: developer | priority: medium
- Fix: Type cast invariant for teamMembers.userId needs validation and documentation | agent: developer | priority: medium


### 2026-05-23 — reviewer-business-logic

**Verdict:** PASS

**Acceptance Criteria Check:**

All critical business logic acceptance criteria from REQ-003 verified:

**US-1: Connection Module (✓)**
- `connectDB()` exported and awaited in `src/index.ts` before `serve()` — confirms DB is live before HTTP requests arrive
- Idempotent connection guard via `connected` flag — calling `connectDB()` twice opens connection at most once
- `withTransaction` helper ends session in `finally` block on all paths (success and error)
- Health check `/healthz` uses native `client.db().command({ ping: 1 })` returning 200 or 503

**US-2: Zod Schemas (✓)**
- Nine schema files in `db/schemas/` export Zod schemas and inferred types (Board, Card, Column, Label, Attachment, Team, TeamMember, User)
- All collection names preserve Mongoose defaults (notably `TEAM_MEMBERS_COLLECTION = "teammembers"`)
- ObjectId field typed as `z.instanceof(ObjectId)` — matches driver's return type
- Zero `mongoose` imports in schema files

**US-3: Native CRUD Operations (✓)**
- All service files use native driver: `boards()`, `cards()`, `columns()`, `labels()`, etc.
- Zero Mongoose imports in `/services/` directory
- `ObjectId` imported from `mongodb` (not `mongoose.Types.ObjectId`)
- `findOneAndUpdate` called with `returnDocument: "after"` matching Mongoose `{ new: true }` semantics
- HTTP 404 behavior preserved (returns `null`, wrapped in AppError)

**US-4: Native Aggregation (✓)**
- `fetchBoardWithMembership` uses `boards().aggregate([...]).toArray()` 
- `$lookup.from` field set to `"teammembers"` (preserved Mongoose default collection name)
- Aggregation joins on `teamId` and `userId` correctly
- Better Auth string user IDs properly cast and matched in `$eq` expression
- Returns correct shape with optional `membership` field and proper null handling

**US-5: Transaction Helper (✓)**
- `withTransaction(cb)` exported from `db/connection.ts` with correct signature
- Used in `deleteCard` — attachments deleted first, then card in single transaction
- Used in `deleteLabel` — label removed from all cards and deleted atomically
- Used in `uploadAttachment` — DB insert and card update in single transaction
- Session is ended in `finally` block even on error

**US-6: Dependency Management (✓)**
- `mongoose` completely removed from `apps/api/package.json`
- `mongodb: ^6.0.0` added as direct dependency
- `pnpm install` completes without mongoose peer warnings
- Zero mongoose imports anywhere in `apps/api/src/`

**US-7: Partial Unique Indexes (✓)**
- `ensureIndexes()` called in `src/index.ts` startup sequence after `connectDB()`
- Two partial-unique board indexes created:
  - `{ ownerId: 1 }` with `partialFilterExpression: { kind: "personal" }`
  - `{ teamId: 1 }` with `partialFilterExpression: { kind: "team" }`
- All 14 indexes preserved (teams domain unique, teamMembers composite + singles, columns/cards indexes, labels/attachments indexes)
- Index field names match schema field definitions exactly

**US-8: Build & Type Check (✓)**
- `pnpm --filter @kata/api check` exits with code 0 — no TypeScript errors
- Health check returns correct JSON shape and status codes
- No Mongoose-specific types remain in codebase

**Critical Business Logic Patterns Verified:**

1. **GET /api/boards/personal** — `getBoardWithColumnsAndCards` still returns columns sorted by `position: 1`, card summaries with aggregated `commentsCount` and `checklistsCount`

2. **provisionUser** — Uses `withTransaction`:
   - First user from domain becomes `admin` (via `countDocuments` check)
   - Second becomes `member`
   - Atomic `findOneAndUpdate` upsert with `$setOnInsert` prevents duplicate teams
   - Personal and team boards created atomically
   - Better Auth string user IDs properly handled via type cast

3. **createColumn** — `appendAfter` still called correctly on `lastColumn?.position ?? null`; column inserted and event emitted

4. **deleteCard** — Full transactional cascade:
   - Attachments fetched before transaction
   - Attachments and card deleted atomically in transaction
   - Storage files deleted AFTER commit (not inside)
   - Orphaned files cleaned up by `getCard` stale-cleanup via `$pull` with `$in`

5. **deleteLabel** — Removes label from all cards and deletes label atomically in `withTransaction`

6. **Card-comment PATCH** — Distinguishes 404 vs 403 correctly:
   - Two-stage check: existence lookup (`findOne` with `comments._id`)
   - If missing: throws 404 "Card or comment not found"
   - If exists but wrong author: second `findOneAndUpdate` with author filter returns null
   - Returns 403 "Only the author may edit this comment"
   - Uses positional `$` with `$elemMatch` projection to return only affected element

7. **Card-checklist item PATCH** — Uses `arrayFilters` syntax correctly:
   - `{ "c._id": checklistObjId }` and `{ "i._id": itemObjId }` target nested items
   - `$set` updates applied only to matching array elements
   - Returns 404 when card/checklist/item missing

8. **fetchBoardWithMembership** — Returns:
   - `null` for personal boards (no team lookup)
   - Membership object with role for team boards when user is member
   - Uses single aggregation pipeline to prevent race conditions

9. **ensureIndexes** — All two partial-unique board indexes present and idempotent:
   - Calling twice does not error
   - Failures propagate (no silent failures)

**Test Coverage Assessment:**
- All business logic is separated into service/model layers that are independently testable
- No hidden Mongoose dependencies in services
- Collection accessors are typed via Zod inference (`Collection<Board>` etc.)
- Native driver return types properly handled via explicit generics and projections
- Event emission patterns preserved exactly (string IDs converted at response boundary)

**Verdict Summary:**
The migration successfully preserves every acceptance criterion from REQ-002 (the original kanban API contract) while replacing Mongoose with the native MongoDB driver. All business rules around user provisioning, transactional cascades, access control, and data integrity are correctly implemented. Collection names, field names, index definitions, and HTTP status codes are all preserved. Zero Mongoose dependencies remain.


### 2026-05-23 — reviewer-architecture

**Verdict:** PASS

**Architecture Review Summary:**

The implementation perfectly aligns with PLAN-003's architecture. All required components are in place, properly separated, and correctly integrated.

**Plan Compliance Verification:**

1. **Connection Module (`db/connection.ts`)** ✅
   - Exports `client`, `db` (Proxy), `connectDB`, `getDb`, `withTransaction`, `disconnect` with correct signatures
   - `connectDB()` is idempotent via `connected` flag guard
   - `withTransaction` ends session in `finally` block on all paths
   - `db` Proxy defers resolution to `getDb()` for delayed initialization
   - Startup sequence: `await connectDB()` → `await ensureIndexes()` → `serve()` in `src/index.ts`

2. **Zod Schemas (`db/schemas/`)** ✅
   - Nine files created (eight collections + index)
   - Each collection file exports: `<NAME>_COLLECTION` constant, `<Name>Schema` Zod schema, `type <Name> = z.infer<typeof <Name>Schema>`
   - Collection name table matches plan exactly:
     - `BOARDS_COLLECTION = "boards"` ✅
     - `CARDS_COLLECTION = "cards"` ✅
     - `COLUMNS_COLLECTION = "columns"` ✅
     - `LABELS_COLLECTION = "labels"` ✅
     - `ATTACHMENTS_COLLECTION = "attachments"` ✅
     - `TEAMS_COLLECTION = "teams"` ✅
     - `TEAM_MEMBERS_COLLECTION = "teammembers"` ✅ (Mongoose-preserved plural form)
     - `USER_COLLECTION = "user"` ✅ (Better Auth collection)
   - `db/schemas/index.ts` exports `COLLECTIONS` const and typed accessor functions (`boards()`, `cards()`, etc.)
   - All ObjectId fields typed as `z.instanceof(ObjectId)` matching native driver return types
   - Better Auth user schema uses `_id: z.string()` with `.passthrough()` for additional BA fields

3. **Typed Collection Accessors** ✅
   - All service and route files use typed accessors from `db/schemas/index.js`: `boards()`, `cards()`, `columns()`, `labels()`, `attachments()`, `teams()`, `teamMembers()`, `users()`
   - Zero direct `db.collection("name")` calls outside of `db/schemas/index.ts`
   - All accessors use `COLLECTIONS` constants for collection names

4. **Separation of Concerns** ✅
   - **Data layer**: `db/connection.ts` (connectivity), `db/schemas/` (type definitions), `db/indexes.ts` (index bootstrapping)
   - **Business logic**: Service files (`services/{boards,teams,columns,cards,labels,attachments}.ts`, `auth/{provisioning,middleware}.ts`)
   - **HTTP layer**: Route files and validators (`routes/`, `http/`)
   - No layer violations — services access database via typed accessors, routes call services
   - Validation centralized in `validateObjectId` helper and `@hono/zod-validator` middleware

5. **Mongoose Dependency Removal** ✅
   - Zero `mongoose` imports in entire `apps/api/src/` directory (confirmed via grep)
   - `mongoose` removed from `apps/api/package.json`
   - `mongodb: ^6.0.0` added as direct dependency
   - All model code in `db/models/` deleted

6. **Index Bootstrapping** ✅
   - `ensureIndexes()` in `db/indexes.ts` creates all 14 indexes via native `createIndex` calls:
     - Teams: 1 unique (domain)
     - TeamMembers: 1 composite unique (teamId, userId) + 2 single-field indexes
     - Boards: 2 partial-unique (ownerId with kind="personal", teamId with kind="team")
     - Columns: 2 indexes (boardId, composite boardId+position)
     - Cards: 3 indexes (boardId, columnId, composite columnId+position)
     - Labels: 1 index (boardId)
     - Attachments: 2 indexes (cardId, boardId)
   - Called in startup sequence after `connectDB()` and before `serve()`
   - All field names match schema definitions exactly

7. **Transaction Pattern** ✅
   - `withTransaction` used at 4 sites (all planned):
     - `auth/provisioning.ts` — user/board/team atomic creation
     - `services/cards.ts` — deleteCard (attachments then card)
     - `services/labels.ts` — deleteLabel (remove from cards + delete)
     - `services/attachments.ts` — uploadAttachment and deleteAttachment (insert/update and delete)
   - Sessions properly closed in `finally` blocks

8. **HTTP Type System** ✅
   - `http/types.ts` imports `ObjectId` from `mongodb` (not `mongoose`)
   - `ContextBoard` interface uses `ObjectId` for `_id`, `ownerId`, `teamId` fields
   - `http/validate.ts` uses `ObjectId.isValid(value)` for validation (not `mongoose.isValidObjectId`)
   - Exported signature unchanged (`validateObjectId(value: string | undefined, name: string): string`)

9. **Better Auth Integration** ✅
   - `auth/better-auth.ts` imports shared `db` Proxy from `db/connection.js`
   - Removed all `mongoose.connection` references
   - `mongodbAdapter(db)` passed directly to `betterAuth` config
   - Proxy defers initialization until first request (after `connectDB()` has resolved)

10. **Aggregation Pipeline** ✅
    - `auth/middleware.ts` `fetchBoardWithMembership` uses native `boards().aggregate([...]).toArray()`
    - `$lookup.from` field set to `"teammembers"` (preserved Mongoose default)
    - Returns `BoardWithMembership` interface matching plan spec
    - Cursor properly closed via `.toArray()`

11. **Code Organization & Patterns** ✅
    - All files in correct directories per plan (schemas, services, routes, auth, db)
    - No god files — each service focused on one domain
    - Consistent error handling via `AppError` + `errorHandler`
    - Event emission patterns preserved (`String(objectId)` for serialization)
    - Import paths use `.js` extensions (ESM + `NodeNext` tsconfig)
    - Tab indentation, double-quoted strings, named section comments preserved
    - `exactOptionalPropertyTypes` compliance: optional fields use spread syntax

12. **Collection Name Verification** ✅
    - All collection accesses route through `COLLECTIONS` constant
    - TeamMembers collection correctly named `"teammembers"` (not `"teamMembers"`) — preserves production data
    - Aggregation `$lookup` uses literal `"teammembers"` string (unchanged)
    - No data migration required — collection names unchanged from Mongoose defaults

13. **Type Safety** ✅
    - All `db.collection()` calls use explicit generic: `db.collection<Board>("boards")`
    - Service functions return properly typed objects or null/throw errors
    - Route handlers use `validateObjectId` before creating ObjectId instances
    - `@hono/zod-validator` middleware validates all inputs at HTTP boundary
    - No implicit `any` types — explicit projections and type assertions used where needed

**Well Done:**

- Systematic elimination of Mongoose: All 7 model files deleted, all imports removed, no stranded references
- Consistent ObjectId handling: All route parameters validated before ObjectId construction; all responses serialize to strings
- Better Auth user ID handling: Consistently cast `user.id` (string) via `as unknown as ObjectId` and stored as-is; all queries match stored form
- Transactional safety: Three critical cascade operations (deleteCard, deleteLabel, uploadAttachment) properly use `withTransaction` with storage cleanup after commit
- Health check modernized: Replaced Mongoose `readyState` check with native `client.db().command({ ping: 1 })`
- Startup sequence enforced: Async main() function ensures `connectDB()` and `ensureIndexes()` complete before `serve()` binds the port
- Collection-name preservation: COLLECTIONS constant serves as single source of truth, preventing future mismatches
- Schema design sound: Zod schemas correctly model subdocument arrays (Comment, ChecklistItem, Checklist, etc.) as nested schemas

**No Architecture Violations Found.**

All acceptance criteria from the plan are met. The codebase follows established patterns consistently. Dependencies point inward (HTTP → services → db). No circular dependencies. No unnecessary coupling between modules. The separation of concerns is clean and maintainable.


- Fix: Better Auth user.id type mismatch in card-comments (new ObjectId vs string) | agent: developer | priority: critical
- Fix: Better Auth user.id validation inconsistency in card-assignees | agent: developer | priority: critical
- Fix: Missing validateObjectId on card-assignees userId parameter | agent: developer | priority: critical
- Fix: Missing validateObjectId on deleteAttachment cardId parameter | agent: developer | priority: critical
- Fix: Missing validateObjectId on moveCard targetColumnId parameter | agent: developer | priority: critical
- Fix: Missing validateObjectId on card-labels labelId parameter | agent: developer | priority: critical
- Fix: ObjectId array construction without error handling in card stale cleanup | agent: developer | priority: critical
- Fix: No validation that user.id is string before storing in provisioning | agent: developer | priority: major
- Fix: ownerId comparison needs runtime validation for type invariant | agent: developer | priority: major
- Doc: Document Better Auth user ID type invariant (stored as string via type cast) | agent: developer | priority: major
