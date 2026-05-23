---
id: TASK-050
title: "Re-review Mongoose migration fixes"
agent: reviewer
status: done
requirement: REQ-003
plan: PLAN-003
depends-on: [TASK-045, TASK-046, TASK-047, TASK-048, TASK-049]
priority: high
created: 2026-05-23
---

## Objective

Re-review the 5 fix tasks for the Mongoose → native MongoDB driver migration to confirm all issues are resolved and no regressions introduced.

## Context

- Requirement: .guild/requirements/REQ-003.md
- Plan: .guild/plans/PLAN-003.md
- Round-1 review: TASK-044

## Acceptance Criteria

- [x] TASK-045 fixes verified (BA user.id in card-comments + card-assignees)
- [x] TASK-046 fixes verified (validateObjectId for targetColumnId + labelId)
- [x] TASK-047 fixes verified (null assertions + AppError)
- [x] TASK-048 fixes verified (health check + endSession)
- [x] TASK-049 fixes verified (user.id guard + index error handling)
- [x] No new critical/major issues introduced

## Work Log

## Follow-up Tasks

### 2026-05-23 — reviewer-security (round 2)

**Verdict:** PASS

**Findings:**

All 5 fix tasks have been correctly implemented. Verification summary:

1. **TASK-045** — Better Auth user.id type handling
   - `card-comments.ts:29`: `authorId` stored as `user.id as unknown as ObjectId` (type cast, not ObjectId constructor) ✓
   - `card-comments.ts:86`: PATCH query filter uses raw `user.id` string for match ✓
   - `card-assignees.ts`: Removed `validateObjectId` calls on BA user IDs; uses raw string directly ✓
   - Both routes use `userId as unknown as ObjectId` casts for schema compatibility ✓

2. **TASK-046** — ObjectId validation boundaries
   - `routes/cards.ts:77`: `validateObjectId(targetColumnId, "targetColumnId")` called before `moveCard()` ✓
   - `routes/card-labels.ts:24`: `validateObjectId(rawLabelId, "labelId")` validates before `new ObjectId()` ✓

3. **TASK-047** — Null-safety + proper error types
   - `services/columns.ts:61`: `createColumn` throws `AppError("INTERNAL_ERROR", ...)` on null, no `!` assertion ✓
   - `services/cards.ts:152`: `createCard` throws `AppError("INTERNAL_ERROR", ...)` on null, no `!` assertion ✓
   - `services/boards.ts:39`: `getBoardWithColumnsAndCards` throws `AppError("NOT_FOUND", ...)` not generic `Error` ✓

4. **TASK-048** — Connection + session management
   - `app.ts:36`: Health check uses `getDb().command({ ping: 1 })`, not `client.db()` ✓
   - `db/connection.ts:42-47`: `withTransaction` endSession errors wrapped in try/catch; suppressed if callback threw first ✓

5. **TASK-049** — Type guards + diagnostic logging
   - `provisioning.ts:17-19`: Runtime guard ensures `user.id` is a non-empty string before type cast ✓
   - `provisioning.ts:27-29, 95-96`: JSDoc comments document Better Auth string ID invariant ✓
   - `indexes.ts:12-137`: Every `createIndex` wrapped with descriptive error context before re-throw ✓
   - `team-member.ts:9-12`: Comment added to `userId` field documenting the string storage invariant ✓

**No issues in:**
- Input validation at request boundaries (all user-supplied IDs validated via `validateObjectId` before use in BSON operations)
- Authentication checks on protected routes (existing `requireSession` + `loadBoardAccess` middleware unchanged)
- Error handling (proper use of `AppError` with correct HTTP status codes; no sensitive data leakage observed)
- Type safety (correct use of `ObjectId` from `mongodb` package; no Mongoose types remain)
- Transaction integrity (session management, error propagation, and cleanup all correct)
- Index creation (errors wrapped with diagnostic context; idempotent and failure-visible)

**Security-relevant implementation details confirmed:**
- Better Auth user IDs (UUIDs/CUIDs) are stored as strings in MongoDB with type casts for schema compatibility
- Query filters consistently use raw string values for user ID fields, not ObjectId conversions
- ObjectId-based document lookups all preceded by validation via `validateObjectId()`
- No hardcoded secrets, credentials, or sensitive data in source files reviewed
- Health check uses shared database instance (not creating new connections per request)

### 2026-05-23 — reviewer-business-logic (round 2)

**Verdict:** PASS

**Acceptance Criteria Check:**
- [x] TASK-045 fixes verified (BA user.id in card-comments + card-assignees)
- [x] TASK-046 fixes verified (validateObjectId for targetColumnId + labelId)
- [x] TASK-047 fixes verified (null assertions + AppError)
- [x] TASK-048 fixes verified (health check + endSession)
- [x] TASK-049 fixes verified (user.id guard + index error handling)
- [x] No new critical/major issues introduced

**Business Logic Verification:**

1. **TASK-045 — Comment creation and author validation**
   - POST handler stores `authorId: user.id as unknown as ObjectId` (line 29): correct string storage with type cast ✓
   - PATCH handler checks comment exists before author check (lines 72-78): correctly returns 404 vs 403 ✓
   - Query filter `"comments.authorId": user.id` (line 86) matches stored string value ✓
   - DELETE authorization check compares `String(comment.authorId) === String(user.id)` (line 148): handles both ObjectId and string types ✓
   - Assignee add: validates team membership or personal board ownership (lines 26-45) ✓
   - Assignee remove: uses raw userId string for `$pull` operator (line 74) ✓

2. **TASK-046 — Malformed ID rejection before database calls**
   - moveCard validates `targetColumnId` via `validateObjectId()` at route boundary (routes/cards.ts:77) ✓
   - Subsequent `new ObjectId(targetColumnId)` in service (cards.ts:299) is safe from BSON construction errors ✓
   - card-labels POST validates `labelId` via `validateObjectId()` (routes/card-labels.ts:24) ✓
   - Invalid ObjectIds return 422 VALIDATION_ERROR, not 500 ✓

3. **TASK-047 — Creation atomicity and error semantics**
   - `createColumn` inserts then fetches; null result throws `AppError("INTERNAL_ERROR", ...)` (services/columns.ts:61) ✓
   - `createCard` same pattern: insert, fetch, throw INTERNAL_ERROR if null (services/cards.ts:152) ✓
   - Returns HTTP 201 on success via `created()` responder (routes/cards.ts:32) ✓
   - `getBoardWithColumnsAndCards` throws `AppError("NOT_FOUND", ...)` on missing board (services/boards.ts:39), returns 404 ✓
   - Aggregation loads all columns then all cards: no partial-load race conditions ✓

4. **TASK-048 — Health check and session cleanup**
   - `/healthz` calls `getDb().command({ ping: 1 })` using shared db instance (app.ts:36) ✓
   - Returns `{ ok: true, db: true }` on success, `{ ok: false, db: false }` with 503 on failure ✓
   - `withTransaction` callback error: captured, session closed, re-thrown (db/connection.ts:35-47) ✓
   - `withTransaction` session.endSession() errors: suppressed if callback threw, propagated otherwise ✓
   - Promise chain preserves error type and message through transaction boundary ✓

5. **TASK-049 — Type safety and diagnostic startup**
   - `provisionUser` guards `user.id` is non-empty string before type-cast (provisioning.ts:17-19) ✓
   - Throws `AppError("INTERNAL_ERROR", "Better Auth user.id must be a non-empty string")` on guard failure ✓
   - All `createIndex` calls in `ensureIndexes()` wrapped with descriptive error messages ✓
   - Errors propagate to abort startup; descriptive context aids manual remediation ✓
   - Personal board constraint: partial unique index on `ownerId` where `kind === "personal"` (indexes.ts:48-51) ✓
   - Team board constraint: partial unique index on `teamId` where `kind === "team"` (indexes.ts:59-62) ✓
   - Startup sequence: `connectDB()` → `ensureIndexes()` → `serve()` (index.ts:9-10) ✓

**Data Integrity & Atomicity:**
- All card-comments operations use positional `$` operator with projection to update only the affected array element ✓
- Comment author check ensures author-only edit capability; board admins can only delete (lines 148-157) ✓
- Card-assignees enforce team membership constraint (team board) or owner constraint (personal board) ✓
- Move-card verifies both card and target column exist before reordering (cards.ts:288-304) ✓
- Transaction callbacks in `withTransaction` receive session and pass it to all database calls (provisioning.ts) ✓
- Personal board provisioning is atomic: user insert + board insert in same transaction (provisioning.ts:30-45) ✓

**TypeScript Type Safety:**
- No mongoose imports or types remain in source (grep confirmed zero matches) ✓
- `ObjectId` imported from `mongodb` package in all files (routes, services, db modules) ✓
- Collection typing: `db.collection<DocType>(collectionName)` used correctly throughout ✓
- Better Auth string IDs cast to `ObjectId` for schema compatibility but stored as strings ✓
- pnpm check passes with zero type errors ✓

**Startup & Connection Lifecycle:**
- `connectDB()` is idempotent: checks `connected && dbInstance` flag before calling `client.connect()` (db/connection.ts:9) ✓
- `getDb()` throws descriptive error if called before `connectDB()` (db/connection.ts:18) ✓
- Proxy-based `db` export defers resolution to request-time, safe after startup completes ✓
- `disconnect()` closes client and resets flags (db/connection.ts:51-57) ✓
- Startup failure propagates to `main()` catch handler, exits with code 1 (index.ts:19-21) ✓

**Test Coverage & Testability:**
- Business logic separated from HTTP layer (service functions don't reference request objects) ✓
- Service functions accept typed ObjectId/string parameters and return serialized DTOs ✓
- Error handling uses `AppError` with semantically correct codes (NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, INTERNAL_ERROR) ✓
- Database operations are directly testable with a test database connection ✓


### 2026-05-23 — reviewer-architecture (round 2)

**Verdict:** PASS

**Findings:**

All 5 fix tasks maintain full architectural integrity with respect to the plan (PLAN-003) and codebase conventions.

1. **TASK-045 — Better Auth user.id type pattern consistency** ✓
   - Pattern: `user.id as unknown as ObjectId` used consistently across routes
   - Implementation: Both `card-comments.ts:29` and `card-assignees.ts:49` follow the same type-cast pattern established in `provisioning.ts:34`
   - Query filters: Consistently use raw `user.id` string (e.g., `card-comments.ts:86`, `card-assignees.ts:28`)
   - No layer violations: Type casts isolated to data access layer; route layer passes through unchanged

2. **TASK-046 — validateObjectId placement at route layer** ✓
   - Correct boundary: Both `cards.ts:77` (moveCard targetColumnId) and `card-labels.ts:24` (labelId) validate at route layer
   - Pattern follows plan: Route handlers validate user input before passing to service layer
   - Service layer receives pre-validated strings, safe for `new ObjectId()` construction
   - No duplication: Services don't re-validate; trust route-layer guarantees

3. **TASK-047 — AppError imports and null-safety pattern** ✓
   - All 3 service files import `AppError` from `../http/error.js`: boards.ts:3, columns.ts:5, cards.ts:8
   - Pattern consistent: Replace `!` assertions with explicit `if (!doc) throw new AppError(...)`
   - Error types match conventions: INTERNAL_ERROR for post-insert null (indicates DB/driver fault), NOT_FOUND for missing lookups
   - No scatter of error-handling patterns: all three files follow identical approach

4. **TASK-048 — getDb() import and withTransaction error handling** ✓
   - Health check import: `app.ts:5` imports `getDb` from correct module `./db/connection.js`
   - Shared instance usage: `app.ts:36` calls `getDb().command({ ping: 1 })` (not `client.db()`)
   - withTransaction pattern: Callback error captured (line 35), session closed in finally (lines 42-47)
   - Error masking prevention: endSession errors suppressed only when callback already threw (line 45)
   - Plan alignment: Matches "withTransaction helper" design from PLAN-003 Technical Decisions

5. **TASK-049 — AppError import in provisioning.ts + ensureIndexes error wrapping** ✓
   - AppError imported: `provisioning.ts:9` imports from `../http/error.js`
   - User.id guard: Lines 17-19 validate string type before cast (matches pattern)
   - Index error wrapping: Each try/catch in `indexes.ts:12-137` re-throws with descriptive `[ensureIndexes]` prefix
   - Error propagation: Wrapped errors still propagate to abort startup (meets plan requirement)

**Separation of Concerns Verification:**
- Routes: Route handlers validate, extract context, delegate to services
- Services: Perform business logic with typed collections, return serialized DTOs
- Data layer: `db/connection.ts` manages client lifecycle; schemas define document types; index setup isolated to `db/indexes.ts`
- No violations: Services don't access `c` (Hono context), routes don't call MongoDB directly, DB module has no business logic

**Pattern Consistency with Codebase:**
- Zod schema pattern: All documents typed via `z.infer<>` aliases from Zod schemas (matches PLAN-003 US-2)
- Collection accessors: `db.collection<DocType>(COLLECTION_CONSTANT)` used throughout (schemas/index.ts:22-31)
- Error responses: All AppError codes are semantic (NOT_FOUND→404, FORBIDDEN→403, INTERNAL_ERROR→500)
- ObjectId imports: Uniformly from `mongodb` package (no mongoose.Types.ObjectId remains)
- Transaction pattern: Services call `withTransaction(async (session) => ...)` with session passed to all ops

**Dependencies & Coupling:**
- Import direction: All imports point inward (routes→services→db, schemas imported where needed)
- No circular imports detected: Schemas exported from single index.ts; services import collections, not vice versa
- Minimal coupling: AppError is only cross-layer dependency (correct pattern for error handling)
- Better Auth integration: Provisioning.ts (single file) handles user→board lifecycle atomically

**Code Organization:**
- File placement: Services in `services/`, routes in `routes/`, schemas in `db/schemas/`, connection in `db/`
- Reasonable file sizes: No god objects (largest services ~300 lines with clear functional sections)
- Consistent naming: camelCase for functions/variables, PascalCase for types/schemas, UPPER_SNAKE_CASE for collection constants
- Section comments: Named sections in larger files (e.g., `// ── getDb ──`)

**Type Safety & TypeScript Compliance:**
- `pnpm --filter @kata/api check` passes with zero errors
- `ObjectId` used from `mongodb` package (not mongoose.Types)
- `z.instanceof(ObjectId)` schemas match MongoDB driver's ObjectId type
- Nullable fields use `.optional()` on schemas; response serialization uses spread pattern per exactOptionalPropertyTypes

**Well-done patterns:**
- Better Auth user.id invariant documented in comments (provisioning.ts:27-29, schemas/team-member.ts:9-12)
- Runtime type guard added before risky casts (provisioning.ts:17-19)
- Health check uses shared database instance, not creating new connections
- Index errors wrapped with diagnostic context, preserving error for debugging
- withTransaction properly handles both callback and session errors without masking
- Positional operator and projection use in card subdocument updates (card-comments.ts:85-96)

**No critical/major architectural issues found.**


### 2026-05-23 — reviewer-edge-case (round 2)

**Verdict:** PASS

**Findings:**

All 5 fix tasks have been verified for boundary conditions, null/undefined handling, and error scenarios. No critical or major edge cases remain unhandled.

**TASK-045 Edge Cases:**

1. [minor] card-comments POST — `user.id` is guaranteed non-null by `requireSession` middleware
   - Middleware at auth/middleware.ts:15-28 throws UNAUTHENTICATED if session missing
   - No path reaches route handler with null user.id

2. [minor] card-comments PATCH — Non-author edit returns 403 correctly
   - Line 72-78: Exists check distinguishes 404 (comment missing) from 403 (wrong author)
   - Query filter at line 86 `"comments.authorId": user.id` matches stored string value
   - findOneAndUpdate returns null if filter doesn't match → FORBIDDEN thrown (line 101)

3. [minor] card-assignees DELETE — Missing/malformed `:userId` param
   - Route is `/:userId`; Hono won't match if param missing (returns 404 before handler)
   - Empty string `userId` passed to `$pull` is safe (no-op if array has no matching element)
   - No validation on `:userId` param is correct: Better Auth UUIDs are not ObjectIds

**TASK-046 Edge Cases:**

1. [minor] targetColumnId validation
   - Line 77 `validateObjectId(targetColumnId, "targetColumnId")` returns string
   - Line 81 passes validated string to `moveCard()`
   - If validation fails: throws VALIDATION_ERROR (422) before service call
   - Service at cards.ts:299 safe to call `new ObjectId(targetColumnId)` (pre-validated)

2. [minor] labelId validation
   - Line 24 `validateObjectId(rawLabelId, "labelId")` validates before `new ObjectId()`
   - Malformed labelId returns 422 VALIDATION_ERROR (not 500)
   - Empty string `""` caught by `!value` check in validate.ts:32

**TASK-047 Edge Cases:**

1. [major—MITIGATED] createColumn/createCard — findOne returns null after insertOne
   - Scenario: Insert succeeds but replication lag or driver bug causes findOne to return null
   - Handled: Explicit null check throws AppError("INTERNAL_ERROR", ...) at lines 61 and 152
   - No silent crash from `!` assertion
   - HTTP 500 returned (correct for unexpected DB state)

2. [minor] getBoardWithColumnsAndCards — Board deleted between checks
   - Line 37 findOne returns null → throws AppError("NOT_FOUND", ...) at line 39
   - Returns 404 (not 500 as with generic Error before fix)

**TASK-048 Edge Cases:**

1. [minor] Health check — getDb() called before connectDB()
   - getDb() throws Error at db/connection.ts:18: `"[mongodb] connectDB() must be awaited before getDb()"`
   - Caught by try/catch at app.ts:38
   - Returns 503 with `{ ok: false, db: false }` (correct)

2. [minor] Health check — Database connection lost mid-ping
   - command({ ping: 1 }) throws network error
   - Caught by catch block at app.ts:38
   - Returns 503 (correct)

3. [major—MITIGATED] withTransaction — endSession throws when callback already threw
   - Scenario: Callback throws error X, then session.endSession() throws error Y
   - Handled: callbackError stored at line 35, endSession wrapped at lines 42-47
   - Original error X re-thrown; error Y suppressed (correct behavior)
   - Test case: If callback succeeds but endSession throws, error propagates (correct)

**TASK-049 Edge Cases:**

1. [major—MITIGATED] provisionUser — user.id is empty string `""`
   - Scenario: Better Auth returns user with id=""
   - Handled: Guard at line 17 checks `!user.id` (empty string is falsy)
   - Throws AppError("INTERNAL_ERROR", ...) (line 18)
   - Does not proceed to type-cast

2. [major—MITIGATED] provisionUser — user.id is undefined or null
   - Scenario: Better Auth returns user with id=undefined or id=null
   - Handled: Guard at line 17 checks `typeof user.id !== "string"` first
   - Throws AppError("INTERNAL_ERROR", ...) before type-cast
   - Type system also prevents this (parameter typed as string)

3. [minor] ensureIndexes — Index definition conflict
   - Scenario: Existing index with same name but different definition
   - Handled: createIndex throws; caught and re-thrown with descriptive error (lines 12-19 pattern)
   - Startup fails visibly; developer can manually drop conflicting index
   - No silent index mismatch

4. [minor] ensureIndexes — Missing collection (first access edge case)
   - Scenario: boards().createIndex() called on non-existent collection
   - Result: MongoDB creates collection and index atomically
   - Handled: No error thrown (createIndex is idempotent)

**Verified adequate handling of:**
- Empty strings in parameters (caught by validateObjectId or guard checks)
- Null/undefined values in authenticated context (caught by requireSession middleware)
- Database connection not ready (getDb() throws descriptive error)
- TOCTOU race conditions in comment edit (user.id fixed by middleware; query includes it as filter)
- Session cleanup errors (wrapped try/catch, original error preserved)
- Index definition conflicts (re-thrown with context, startup fails visibly)
- Type safety for Better Auth string IDs (type cast + runtime guard)
- Error code semantics (INTERNAL_ERROR for post-insert null, NOT_FOUND for missing, VALIDATION_ERROR for bad ObjectId)

**No new critical or major edge cases introduced by these fixes.**

