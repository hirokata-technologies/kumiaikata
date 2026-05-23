---
id: TASK-019
title: "Review kanban board backend implementation"
agent: reviewer
status: done
requirement: REQ-002
plan: PLAN-002
depends-on: [TASK-008, TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018]
priority: high
created: 2026-05-23
---

## Objective

Review kanban board backend implementation

## Context

- Requirement: .guild/requirements/REQ-002.md — Kanban Board Management API
- Plan: .guild/plans/PLAN-002.md
- Parent task: TASK-007

## Acceptance Criteria

- [ ] Security review passed — 3 fix tasks declared
- [x] Architecture review passed
- [x] Business logic review passed
- [ ] Edge case review passed — 9 fix tasks declared

## Work Log

## Follow-up Tasks

### 2026-05-23 — reviewer-security

**Verdict:** ISSUES FOUND

**Findings:**

1. [major] apps/api/src/services/attachments.ts:61 — **Path traversal vulnerability in attachment file extension**
   The storage key is constructed by extracting the file extension directly from the user-supplied filename without sanitization: `path.extname(file.name)`. A malicious user could upload a file named something like `malicious.jpg/..%2fescaping.txt` which, when passed through `path.extname()`, might produce unexpected path segments. Although `path.extname()` extracts only the rightmost extension safely, the filename itself is user-controlled and could theoretically cause issues in certain edge cases or future refactorings. 
   Recommendation: Sanitize or validate the file extension, or use a whitelist of safe extensions derived from the MIME type rather than trusting the original filename. Consider using a UUID-based naming scheme entirely (e.g., `storageKey = `${boardId}/${attachmentId}/${uuid}.${mimeTypeToExtension(mimeType)}``) to decouple from user input.

2. [major] apps/api/src/auth/middleware.ts:36-63 — **Race condition in concurrent board access checks**
   The `deriveAccess()` function queries the database in two separate steps: first checking board existence and kind, then querying `TeamMember` if applicable. Between these queries, a user's team membership could be revoked (in a real concurrent scenario), allowing them to access a board they are no longer authorized to use until the in-flight request completes.
   Recommendation: Perform the board and team membership lookups in a single atomic query or use a transaction to ensure consistency. Alternatively, wrap the two queries in a session with a read-committed isolation level if MongoDB transactions are used.

3. [major] apps/api/src/routes/sse.ts:34-45 — **Session validation timeout in SSE connection is too infrequent**
   The SSE endpoint re-checks session validity every 60 seconds (line 34-45). An attacker with a stolen session token could maintain the connection for up to 60 seconds after the legitimate user signs out or their session expires elsewhere, potentially receiving real-time board updates that should be inaccessible.
   Recommendation: Reduce the session watch interval to 5-10 seconds to catch session expiry more promptly. This is especially important for sensitive collaborative environments.

4. [minor] apps/api/src/http/error.ts:48-52 — **Error handler may expose internal details in development**
   The central error handler logs unhandled errors to the console with full error object (line 48: `console.error("Unhandled error:", err)`). In production, if an unexpected error occurs, the full stack trace will be written to logs. While the HTTP response itself is generic, this may leak information in centralized logging systems.
   Recommendation: Implement structured error logging that sanitizes stack traces in production (via an env check). Ensure log aggregation filters sensitive patterns.

5. [minor] apps/api/src/storage/disk.ts:33-34 — **Storage write failure cleanup may leave orphaned temp files**
   When `pipeline(stream, writer)` fails, the code attempts to `unlink(tempPath)`, but if the temp file was never created (e.g., stream error before write), the `unlink` promise silently catches and suppresses the error (line 33: `unlink(tempPath).catch(() => undefined)`). Over time, this could accumulate orphaned `.tmp` files if the storage directory is not monitored.
   Recommendation: Add a periodic cleanup script to remove stale `.tmp` files from the attachments directory, or use a more robust atomic file write pattern (e.g., write to a staging directory and move atomically).

**No critical issues found in:**
- Authentication and authorization flow (Better Auth integration, domain allow-list, session middleware)
- Column and card CRUD authorization (requireBoardAdmin middleware correctly enforces admin-only operations)
- Comment and checklist authorization (author and admin checks correctly implemented)
- Label and team member role management (proper role-based checks)
- Input validation (Zod validators on all routes, length limits enforced)
- Attachment MIME type and size enforcement (allowlist, size cap)
- MongoDB query construction (parameterized via Mongoose, no injection risk)
- XSS risks (no user content rendered in responses, JSON only)
- Sensitive data logging (no passwords or tokens logged; error details are generic in HTTP responses)


- Fix: Sanitize attachment filename to prevent path traversal — validate extension or use UUID-based naming | agent: developer | priority: high
- Fix: Refactor board access derivation to use atomic queries — prevent race condition in concurrent access checks | agent: developer | priority: high
- Fix: Reduce SSE session validation interval from 60s to 5-10s — catch session expiry more promptly | agent: developer | priority: high

### 2026-05-23 — reviewer-edge-case

**Verdict:** ISSUES FOUND

**Findings:**

1. [critical] apps/api/src/routes/card-attachments.ts:47 — **Missing cardId parameter in attachment routes**
   The attachment upload/delete endpoints extract `cardId` from `c.req.param("cardId")` with a fallback to empty string (`?? ""`). However, these routes are mounted at `/api/boards/:boardId/cards/:cardId/attachments` where `cardId` IS present in the path. If the parameter extraction returns undefined (malformed URL), the code silently accepts an empty string and proceeds to `uploadAttachment()` and `deleteAttachment()`, which then query the database with an empty string. This will return 404 instead of failing validation early. More critically, if the mounting in app.ts is changed, the parameter could be genuinely missing and the functions would operate on invalid data.
   Scenario: Malformed URL or mounting error; cardId parameter is undefined.
   Impact: 404 returned instead of 422 validation error; wrong card could be targeted in edge cases if the fallback isn't applied.
   Recommendation: Validate that `cardId` is not empty after extraction; throw VALIDATION_ERROR if missing, or assert at mount time that parameter is present.

2. [critical] apps/api/src/routes/card-comments.ts:75 — **Null reference in comment edit when comment not found**
   Line 75 calls `card.comments.id(commentId)` without checking if card exists first. If `Card.findOne()` returns null (card was deleted concurrently), the call to `.comments.id()` will throw. However, the card existence check at line 71 throws 404 if not found, so this is guarded. BUT: if a concurrent delete of the card happens BETWEEN line 70 and line 75, the in-memory `card` object is stale and `.comments.id()` could behave unexpectedly with embedded subdocs.
   Scenario: Card deleted between the findOne and the .id() call in a high-concurrency scenario.
   Impact: Potential TypeError or null dereference; comment edit fails ungracefully.
   Recommendation: Refetch or re-validate card state before manipulating embedded arrays, or use a transaction to guard against concurrent modifications.

3. [critical] apps/api/src/services/cards.ts:124 — **columnId parameter not validated as ObjectId before query**
   In `createCard()`, the `columnId` parameter is a string passed from the route. It is used directly in `Column.findOne({ _id: columnId, boardId })` without being parsed to an ObjectId. Mongoose will attempt coercion, but if the string is malformed (e.g., "not-a-valid-id"), the query may silently fail to match any documents, returning 404. This is acceptable behavior, but if the intent is to fail fast on invalid input, validation should occur earlier.
   Scenario: User sends a malformed or non-numeric columnId in the route parameter.
   Impact: Returns 404 "Column not found" instead of 422 "Invalid column ID format"; unclear error messaging.
   Recommendation: Validate route parameters as valid MongoDB ObjectIds early in the middleware or route handler, or document that malformed IDs result in 404.

4. [major] apps/api/src/routes/cards.ts:75 — **Position parameter accepts negative numbers, clamped silently**
   The move-card endpoint accepts `position: z.number().int().min(0)` but allows position 0 (first position). In `moveCard()` service (line 277), the position is clamped to the column length: `const clampedPosition = Math.min(position, targetCards.length)`. If a user sends position 1000000 for a column with 3 cards, it silently becomes position 3 (append). This is by design per the requirement (position out of range appends), but callers expecting an error will be surprised. The clamped value is returned in the event payload, so clients observing the actual position is correct, but the requester's original position intent is lost.
   Scenario: User sends position=999 for a column with 5 cards.
   Impact: Card appends instead of erroring; silent behavior change may confuse clients that do not observe the event payload.
   Recommendation: Document this clamping behavior clearly in API docs, or add a response field indicating the action (e.g., `{ actual_position: 5, requested: 999, action: "clamped" }`).

5. [major] apps/api/src/routes/columns.ts:42 — **Reorder endpoint allows empty orderedIds array**
   The reorder columns endpoint validates `orderedIds: z.array(z.string()).min(1)`, requiring at least one ID. However, if a board has zero columns, calling reorder with an empty array will fail validation, but there is no endpoint to reorder when no columns exist (which is a non-issue functionally, but the min(1) creates an asymmetry). More critically, if someone calls reorder with a single column on a multi-column board, the validation passes the length check but `reorderColumns()` at line 124 compares `currentColumns.length !== desiredIds.length` and throws 422. This is correct, but the error message is confusing: "orderedIds must contain exactly all column IDs" — users may not realize they must include ALL columns, not just the ones being moved.
   Scenario: User calls reorder with 1 column ID on a 3-column board.
   Impact: 422 VALIDATION_ERROR with unclear message; users must include all column IDs even if they only want to move one.
   Recommendation: Clarify error message: "orderedIds must include every column on the board" or add a separate endpoint for partial reorders.

6. [major] apps/api/src/services/attachments.ts:60-62 — **File extension extraction from user-supplied filename**
   The attachment upload constructs the storage key using `path.extname(file.name)`. If file.name is empty or contains only an extension (e.g., ".exe"), the code will still store it. Additionally, if file.name contains multiple dots (e.g., "archive.tar.gz"), only ".gz" is extracted. A user could upload a file named "image.jpg.exe" (MIME type validated as image/jpeg), but the storage key ends with ".exe", which could confuse future administrators or cause issues during file recovery.
   Scenario: User uploads "malicious.jpg.exe" with image/jpeg MIME type (spoofed extension).
   Impact: Stored file has misleading extension; re-downloads will show .exe extension, potentially confusing users or triggering security warnings.
   Recommendation: Derive the extension from the validated MIME type (e.g., `mimeTypeToExtension(file.type)`) instead of trusting the filename, or store the original filename separately from the storage key.

7. [major] apps/api/src/routes/sse.ts:16-26 — **SSE subscription callback may throw unhandled errors**
   The `eventBus.subscribe()` callback at line 20 pushes events to a queue. If the callback throws an error (e.g., JSON.stringify fails due to circular reference in payload, which is unlikely but possible if services emit malformed events), the error is not caught and will crash the event bus or leave the stream in an inconsistent state.
   Scenario: Malformed event payload causes JSON.stringify to throw in SSE subscriber.
   Impact: Unhandled exception in subscription callback; event bus state corrupted; stream may not receive further events.
   Recommendation: Wrap the subscription callback in try-catch and emit error events down the stream, or validate event payloads before emission.

8. [major] apps/api/src/services/attachments.ts:68 — **File stream may fail silently if storage.put throws after partial write**
   In `uploadAttachment()` at line 68, `await storage.put(storageKey, nodeStream, ...)` is awaited and errors are not caught at this level. If the write fails halfway (e.g., disk full), the storage adapter will throw INTERNAL_ERROR, but by that point the stream may have been partially consumed. A subsequent retry or fallback is not implemented, and the DB transaction never runs. This is correct behavior (fail before writing DB), but if the caller retries the request, the temp file from the first attempt may still exist and the storage adapter's unlink catch at line 33 will suppress cleanup errors silently.
   Scenario: Disk becomes full mid-upload; user retries; orphaned temp files accumulate.
   Impact: Storage leaks; over time, attachment directory fills with .tmp files.
   Recommendation: Implement a cleanup job for stale .tmp files, or use a more robust atomic write with staged directories.

9. [major] apps/api/src/routes/card-checklists.ts:108 — **Checklist item array mutation without type safety**
   Line 108 casts and pushes an item to `checklist.items` with `as never`. The item structure is created at lines 102-106 but uses `new mongoose.Types.ObjectId()` for the id and plain `false` for checked. If the Mongoose schema expects a different structure or validators are not properly defined, the save at line 109 could fail. Additionally, the event emission at line 118 references `item: payload` but the actual item in the checklist may have different fields if the schema has extra fields (timestamps, defaults, etc.).
   Scenario: Mongoose schema for checklist items has additional required fields; item save fails.
   Impact: 500 error on checklist item creation due to schema validation failure.
   Recommendation: Ensure the manual item structure matches the Mongoose schema exactly, or use `Card.findOneAndUpdate()` with `$push` to let Mongoose handle object creation (similar to how comments are created at line 34 in card-comments.ts).

10. [major] apps/api/src/services/cards.ts:165-169 — **Attachment lookup may return empty array if attachment IDs reference deleted attachments**
    In `getCard()`, after fetching attachment IDs from the card, the code queries `Attachment.find({ _id: { $in: card.attachmentIds } })`. If an attachment was deleted externally (race condition or corruption), the find will return fewer documents than expected, and the attachments array in the response will be incomplete. The code does not validate that all attachment IDs were found, so the response silently includes a partial list.
    Scenario: Attachment deleted between card query and attachment detail fetch.
    Impact: Response includes incomplete attachment metadata; clients may display missing attachments without warning.
    Recommendation: Validate that all attachment IDs resolved to documents; if any are missing, either return an error or log a warning and clean up the orphaned IDs from the card.

11. [minor] apps/api/src/auth/middleware.ts:46 — **String comparison for ObjectId may fail with type coercion edge cases**
    Line 46 compares `String(board.ownerId) === String(user.id)`. Both are converted to strings, which is safe, but if user.id is already a string and board.ownerId is an ObjectId, this comparison works correctly. However, if either is null/undefined, the string conversion produces "null" or "undefined", which could lead to unexpected matches in very rare scenarios. More likely, the code is defensive and this is fine, but it's worth noting that strict ObjectId comparison would be more explicit.
    Scenario: user.id is undefined (middleware bug); String(undefined) === "undefined".
    Impact: Unlikely; authentication middleware should always populate user.id. Minor risk.
    Recommendation: Add type guards or assertions to ensure user.id and board.ownerId are always defined before comparing, or compare ObjectIds directly if both are ObjectIds.

12. [minor] apps/api/src/services/columns.ts:43-45 — **Empty column list handled gracefully but with implicit behavior**
    When a board has no columns, `createColumn()` calls `Column.findOne({ boardId }).sort({ position: -1 }).lean()`, which returns null, and `appendAfter(null)` generates a position for the first column. This is correct and tested implicitly, but there is no explicit guard or comment explaining this edge case. Future maintainers might not realize that null is a valid return value here.
    Scenario: User creates first column on a newly provisioned board.
    Impact: No issue; works correctly due to fractional-indexing library handling null as "start of list".
    Recommendation: Add a comment explaining the null handling for clarity, or rename to `appendAfter(lastPos: string | null = null)` with inline docs.

13. [minor] apps/api/src/services/cards.ts:298 — **Event payload includes clampedPosition, which may differ from requested position**
    When a card is moved to position beyond column length, the event emitted includes `position: clampedPosition` (line 308), which is the actual position the card ended up at. The requester sees the clampedPosition in the response, but downstream SSE subscribers see the same clampedPosition in the event. This is consistent, but clients that issued the move request with a specific position may not realize it was clamped. The requirement allows this behavior (position out of range appends), so it's not a bug, but it's worth noting for client implementations.
    Scenario: Client sends move with position=100, column has 5 cards; card appends to position 5.
    Impact: Minor; behavior is documented in the requirement. Client UX may be confusing if not handled well.
    Recommendation: Document in API docs that position is clamped to column length; consider adding a flag in response indicating clamping.

14. [minor] apps/api/src/routes/card-checklists.ts:181-212 — **Checklist item deletion uses Mongoose embedded subdoc deleteOne()**
    At line 202, the code calls `item.deleteOne()` on an embedded subdoc. This is a Mongoose API for removing an embedded document from an array, and it works correctly. However, the save at line 203 is critical — if the save fails, the item is removed from memory but the deletion is not persisted. The error is propagated, but the in-memory state of `card` is now inconsistent with what the client sees in the response if the request is retried.
    Scenario: Item deleteOne() succeeds, but card.save() fails due to network error.
    Impact: Item is deleted from client's view (via previous response), but not persisted; retry behaves unpredictably.
    Recommendation: Ensure save() errors are propagated clearly; consider wrapping the delete + save in a single transaction via `Card.updateOne()` with `$pull`.

**Adequately handled:**
- Board access control: loadBoardAccess middleware correctly verifies user is personal owner or team member before allowing any operation.
- Column admin gates: requireBoardAdmin middleware correctly enforces that only admins/owners can modify columns.
- Card positioning: Fractional indexing correctly handles insertion, appending, and reordering without overflow issues.
- File attachment cleanup: Transactions ensure DB and storage stay in sync; orphaned files are logged.
- Comment author validation: Edit and delete operations correctly check authorId.
- Checklist and comment embedding: Mongoose embedded subdocs are used appropriately with push/$push semantics.
- Label-card association: addToSet and $pull prevent duplicates and correctly remove associations.
- Team membership validation for assignees: Code checks user is in the board's team before allowing assignment.

**Summary:**
The implementation handles the happy path well and includes proper authorization checks. However, several edge cases around missing/invalid IDs, concurrent race conditions, and error handling in callbacks expose the system to undefined behavior, resource leaks, and confusing error messages. Most are non-critical but deserve attention for production robustness.


- Fix: Validate cardId parameter in attachment routes; fail with 422 if missing or empty | agent: developer | priority: high
- Fix: Add race condition safeguard in comment edit — re-verify card existence or use transaction | agent: developer | priority: high
- Fix: Validate route parameter ObjectIds early in middleware or handlers | agent: developer | priority: medium
- Fix: Derive file extension from validated MIME type instead of user-supplied filename | agent: developer | priority: medium
- Fix: Wrap SSE subscription callback in try-catch to prevent event bus crashes on malformed payloads | agent: developer | priority: high
- Fix: Add cleanup job for stale .tmp files in attachment storage directory | agent: developer | priority: medium
- Fix: Refactor checklist item creation to use updateOne with $push instead of manual array mutation | agent: developer | priority: medium
- Fix: Validate all attachment IDs resolved in getCard(); log/remove orphaned references | agent: developer | priority: medium
- Fix: Clarify reorder error messages to indicate all items must be included | agent: developer | priority: low

### 2026-05-23 — reviewer-architecture

**Verdict:** PASS

**Findings:**

The implementation demonstrates excellent architectural alignment with PLAN-002. All major patterns are correctly followed:

**Plan Alignment:**
- Folder structure matches specification exactly (auth/, db/models/, events/, http/, ordering/, routes/, services/, storage/)
- Hono + Node.js setup with @hono/node-server adapter
- MongoDB connection via Mongoose with singleton pattern
- All nine route modules mounted in proper order in app.ts

**Separation of Concerns:**
- Routes validate input via zValidator and call services (✓)
- Services contain business logic and emit events (✓)
- Database access isolated to models directory (✓)
- HTTP error envelope abstraction via AppError class (✓)
- No routes directly access models except for embedded subdocs (comments, checklists) — acceptable by plan
- No services contain Zod/validation code (✓)
- No models throw HTTP errors (✓)

**Interface Usage & Abstraction:**
- StorageAdapter interface respected: routes/services import `storage` from storage/index.ts (the interface-typed singleton), never DiskStorage directly (✓)
- BoardEventBus interface respected: routes/services emit to `eventBus` singleton, never instantiate InProcessEventBus (✓)
- Fractional ordering helpers properly abstracted: routes use high-level functions (appendAfter, insertBetween, reorderToMatch) from ordering/fractional.ts (✓)
- AppError used consistently across all services for business logic errors (✓)

**Pattern Consistency:**
- All routes use responder helpers (ok, created, noContent) instead of c.json directly (✓)
- All protected routes use requireSession and/or loadBoardAccess middleware (✓)
- Admin-only operations use requireBoardAdmin after loadBoardAccess (✓)
- All mutations emit events via eventBus.emit with correct payload structure (✓)
- All routes validate input with Zod schemas via zValidator wrapper (✓)
- Error handler at app level catches all errors and serializes via AppError envelope (✓)

**Dependency Management:**
- No circular dependencies detected (✓)
- Services don't import from routes (✓)
- Routes import from services, middleware, models, and http utilities (✓)
- Storage and event bus are singletons exported from index files (✓)
- Mongoose models properly centralized in db/models/ (✓)

**Code Organization:**
- File sizes reasonable (no god objects) (✓)
- Routes limited to ~150-200 lines (✓)
- Services focused on single domains (cards, columns, labels, teams, attachments, boards) (✓)
- Middleware isolated in auth/ directory (✓)
- Cross-cutting concerns (error, validation, response helpers, ordering) in http/ and ordering/ (✓)

**Specific Strengths:**

1. Fractional positioning implemented correctly: moveCard accepts numeric position from client, internally computes fractional keys via insertBetween() before storage.

2. Attachment handling respects abstraction: uploadAttachment and deleteAttachment in services use storage interface, allowing transparent swapping to S3 without touching routes.

3. Transaction usage for critical operations: deleteLabel wraps label deletion and card-label cleanup in a Mongoose transaction; deleteAttachment similarly handles cascades atomically.

4. SSE implementation properly uses eventBus interface: subscribers passed to streamSSE establish per-board subscriptions, unsubscribe on connection close.

5. Board access control properly layered: loadBoardAccess middleware centralizes board existence and user authorization checks, preventing repeated checks in every route.

6. Embedded subdocs (comments, checklists) handled in routes is appropriate per plan architecture: they're subdocuments of cards, not separate resources requiring service functions.

**Minor observations (not violations, just notes):**

- card-comments.ts, card-checklists.ts, card-assignees.ts, card-labels.ts implement business logic directly in routes rather than extracting to services. This is acceptable since they mutate embedded subdocs, but future refactoring could extract these to a card-details service if complexity grows.
- Teams service has unused function listMembers() (defined but never called) — teams route implements the logic inline. Not a violation, just an inconsistency in style choice.

**No architectural issues found.**


### 2026-05-23 — reviewer-business-logic

**Verdict:** PASS

**Acceptance Criteria Check:**

**US-1: Authentication and Registration via Google SSO**
- [x] AC-1: Domain allow-list enforcement — Implemented in `auth/domain-allowlist.ts` via `assertAllowedDomain()` called in `better-auth.ts` `user.create.before` hook; returns 403 with `DOMAIN_NOT_ALLOWED` code
- [x] AC-2: Non-allowed domain rejection — Blocks before account creation; no user row created
- [x] AC-3: Session invalidation on signout — Delegated to Better Auth's built-in signout handler via `POST /api/auth/signout`
- [x] AC-4: 401 on missing session — `requireSession` middleware throws `UNAUTHENTICATED` error (401)

**US-2: Personal Board Auto-Provisioning**
- [x] AC-1: First-login personal board creation — `provisionUser()` creates exactly one board with `kind: 'personal'`, no columns/cards
- [x] AC-2: Idempotent provisioning — Runs only in `user.create.after` hook, fires once per user
- [x] AC-3: `GET /api/boards/personal` — Route returns user's personal board via `getBoardWithColumnsAndCards()`
- [x] AC-4: Default title format — Falls back to "My Board" when `name` is absent (line 16 in provisioning.ts); otherwise `${firstName}'s Board`

**US-3: Team Auto-Join by Email Domain**
- [x] AC-1: First user joins existing team as Member — `provisionUser()` line 64-67 counts members; if count > 0, role is 'member'
- [x] AC-2: First user creates team as Admin — When `existingCount === 0` (line 64), role is 'admin'
- [x] AC-3: `GET /api/teams/mine` returns correct fields — Returns `{ id, domain, name, role }` from `routes/teams.ts:17-32`
- [x] AC-4: Second user from same domain is Member — Confirmed by same logic; first member always sets `existingCount === 0`

**US-4: Team Board Auto-Provisioning**
- [x] AC-1: Team board creation on first user signup — `provisionUser()` creates board with `kind: 'team'` and `title: '${domain} Board'`
- [x] AC-2: `GET /api/boards/team` returns team board — Route fetches user's team membership, then team board
- [x] AC-3: Response includes `id, title, teamId, columns, createdAt` — All fields included in `getBoardWithColumnsAndCards()` response

**US-5: Column CRUD and Reordering**
- [x] AC-1: `POST /api/boards/:boardId/columns` returns 201 with new column — Implemented in `routes/columns.ts` line 24-32; position computed via `appendAfter()`
- [x] AC-2: `PATCH` renames column, returns 200 — `renameColumn()` updates title, emits event
- [x] AC-3: `DELETE` on empty column returns 204 — Implemented; `deleteColumn()` checks card count
- [x] AC-4: `DELETE` on non-empty column returns 409 — `services/columns.ts:94-99` throws `CONFLICT` error when `cardCount > 0`
- [x] AC-5: `PATCH /reorder` updates positions and returns 200 — Validates set equality, calls `reorderToMatch()`, emits event
- [x] AC-6: Member gets 403 on mutations — All mutations guarded by `requireBoardAdmin` middleware

**US-6: Card CRUD and Movement**
- [x] AC-1: `POST` creates card at bottom of column — `createCard()` uses `appendAfter(lastCard?.position ?? null)` to place at end
- [x] AC-2: `PATCH` with partial fields updates only provided fields — `updateCard()` line 217-222 checks `!== undefined` before applying
- [x] AC-3: `PATCH /move` reassigns column and position — `moveCard()` recalculates position between neighbours; emits `card.moved` event
- [x] AC-4: `PATCH /columns/:columnId/cards/reorder` reorders cards in column — Validates set, calls `reorderToMatch()`, updates via bulkWrite
- [x] AC-5: `DELETE` cascades attachments — `deleteCard()` deletes attachment rows in transaction, then deletes storage files
- [x] AC-6: Non-member gets 403 — Guarded by `loadBoardAccess`; user without access throws `FORBIDDEN` (403)

**US-7: Card Detail Fields — Due Date and Assignees**
- [x] AC-1: Due date stored as UTC datetime — `updateCard()` line 221 converts string to `new Date(input.dueDate)`, stored directly
- [x] AC-2: Due date can be cleared with `null` — Line 221 checks `input.dueDate === null` and sets to null
- [x] AC-3: `POST /assignees` idempotently adds assignee — Uses `$addToSet` operator (line 48 in card-assignees.ts)
- [x] AC-4: `DELETE /assignees/:userId` removes assignee — Uses `$pull` operator (line 73)

**US-8: Card Comments**
- [x] AC-1: `POST` creates comment with author, body, createdAt — Creates embedded comment with `authorId`, `body`, `createdAt`
- [x] AC-2: Author can edit comment — `routes/card-comments.ts:75-82` checks `String(comment.authorId) === String(user.id)` before allowing edit
- [x] AC-3: Non-author Member gets 403 — Only author may edit; throws `FORBIDDEN`
- [x] AC-4: Author or Admin can delete — Line 124-132 checks `isAuthor || isAdmin` before allowing delete
- [x] AC-5: `GET /cards/:cardId` includes comments array — `getCard()` in services/cards.ts returns full `comments` array with all fields

**US-9: Card Checklists**
- [x] AC-1: `POST` creates checklist with empty items — `routes/card-checklists.ts:17-52` creates with `items: []`
- [x] AC-2: `POST /items` appends item with `checked: false` — Line 102-106 creates item with `checked: false`, pushes to array
- [x] AC-3: `PATCH /items/:itemId` toggles checked — Line 159-160 allows `checked` to be toggled via optional field
- [x] AC-4: `PATCH /items/:itemId` updates text — Line 159 allows `text` to be updated via optional field
- [x] AC-5: `DELETE /checklists/:checklistId` deletes all items — Subdocument `.deleteOne()` removes checklist and all items

**US-10: Card Attachments**
- [x] AC-1: `POST` upload returns 201 with metadata — `services/attachments.ts:43-122` writes file to disk, creates DB row, returns response with `id, filename, mimeType, sizeBytes, url, uploadedBy, createdAt`
- [x] AC-2: GET includes attachments in card response — `getCard()` queries attachments by ID and includes in response
- [x] AC-3: `DELETE` removes record and file — Transaction removes DB row, then deletes storage file (line 154-162)
- [x] AC-4: File size limit enforced with 413 — Line 31-36 in routes/card-attachments.ts checks `file.size > env.MAX_ATTACHMENT_BYTES`, throws `PAYLOAD_TOO_LARGE`
- [x] AC-5: Unsupported MIME returns 415 — Line 38-42 checks `!ALLOWED_MIMES.has(file.type)`, throws `UNSUPPORTED_MEDIA_TYPE`
- [x] AC-6: Storage failure returns 500, no DB row created — Storage write happens first (line 68); if fails, transaction never runs

**US-11: Label CRUD**
- [x] AC-1: `POST` creates board-scoped label — `createLabel()` scoped by `boardId` parameter
- [x] AC-2: `PATCH` updates fields — `updateLabel()` applies only provided fields via `patch` object
- [x] AC-3: `DELETE` cascades to all cards — Transaction in `deleteLabel()` (line 96-105) pulls label from all card.labelIds on board
- [x] AC-4: `POST /cards/:cardId/labels` idempotently adds label — Uses `$addToSet` (line 35 in card-labels.ts)
- [x] AC-5: `DELETE /cards/:cardId/labels/:labelId` removes association — Uses `$pull` (line 60)

**US-12: Team Member Management**
- [x] AC-1: `GET /teams/:teamId/members` lists members with email, role, joinedAt — Route returns array with all fields (routes/teams.ts:35-57)
- [x] AC-2: `PATCH /members/:userId` with `{ role: 'admin' }` promotes — `setMemberRole()` updates role to 'admin'
- [x] AC-3: `PATCH` with `{ role: 'member' }` demotes — `setMemberRole()` updates role to 'member'
- [x] AC-4: Last-admin guard prevents demotion — Line 63-70 in services/teams.ts checks if demoting only admin, throws `CONFLICT` (409)
- [x] AC-5: Member cannot change roles — Line 54-56 checks actor is admin; Member gets `FORBIDDEN` (403)

**US-13: Real-Time Board Updates via SSE**
- [x] AC-1: `GET /api/boards/:boardId/events` with `Accept: text/event-stream` establishes SSE — Routes uses `streamSSE()` from Hono
- [x] AC-2: Mutations emit events to subscribers — Every service function calls `eventBus.emit()` with correct `boardId` and event type
- [x] AC-3: Session expiry closes connection — Line 34-45 in routes/sse.ts checks session every 60s; if null, emits error event and closes
- [x] AC-4: Disconnect cleans up subscription — Line 47-51 calls `stream.onAbort()` to unsubscribe and clear intervals
- [x] AC-5: Board not found returns 404 before upgrade — `loadBoardAccess` runs before SSE stream setup, throws `NOT_FOUND`
- [x] AC-6: User not authorized returns 403 before upgrade — `loadBoardAccess` enforces board access
- [x] AC-7: Board-scoped subscriptions — `eventBus.subscribe(boardId, ...)` filters by boardId; events only delivered to matching board subscribers

**Findings:**

All 13 user stories and their acceptance criteria are correctly implemented. The business logic properly:
- Enforces domain-based authentication and provisioning
- Auto-creates personal and team boards on first login
- Manages column and card ordering via fractional indexing
- Validates team membership for assignees on team boards
- Cascades deletes for attachments, labels, and checklists
- Enforces role-based access control (personal-owner, team-admin, team-member)
- Emits board-scoped SSE events for all mutations
- Validates input constraints (comment body limits, color format, label names, file sizes, MIME types)

**Test Coverage:**

All critical business logic paths are exercisable via the API endpoints. The implementation is well-separated into service functions (business logic), routes (HTTP contract), and middleware (authorization). Services accept `unknown` boardId and pass through Mongoose queries, making them mockable for unit testing. However, no unit tests are present in the codebase — only the developer tasks verify acceptance criteria through manual testing or integration checks. A future task should add unit tests for:
- Position calculation edge cases (insertBetween on empty column, end of column, reordering permutations)
- Cascade delete transaction atomicity
- Concurrent team creation (idempotency via upsert)
- Session expiry on SSE
- Label cascade deletion consistency

The implementation correctly encodes all business rules from REQ-002 with no deviations or missing functionality.

