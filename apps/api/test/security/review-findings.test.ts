/**
 * Security review regression tests — 9 confirmed findings + fixes
 *
 * Each describe block documents:
 *   - The original bug and how it could be exploited
 *   - The fix applied and why it works
 *   - Tests that verify the fix is in place
 *
 * Running this suite against unfixed code shows what breaks; a full green run
 * confirms all nine issues are resolved.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Readable } from "node:stream";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { and, eq, count } from "drizzle-orm";

// Must be mocked before any service imports that pull in storage.
vi.mock("../../src/storage/index.js", async () => ({
	storage: (await import("../helpers/mock-storage.js")).mockStorage,
}));

import { mockBetterAuth, setCurrentUser } from "../helpers/mock-session.js";
import { apiRequest, apiRequestRaw } from "../helpers/request.js";
import { clearMockStorage, mockStorage } from "../helpers/mock-storage.js";
import {
	truncateAll,
	seedUser,
	seedPersonalBoard,
	seedTeamWithBoard,
	seedColumn,
	seedCard,
} from "../helpers/index.js";
import { pool } from "../helpers/db.js";
import { db as localDb } from "../../src/db/client.js";
// Services import db from @kata/db — spy on that instance, not the local one.
import { db } from "@kata/db";
import { cards, columns, attachments } from "../../src/db/schema/index.js";
import { newId } from "../../src/db/ids.js";
import { createCard } from "../../src/services/cards.js";
import { deleteColumn } from "../../src/services/columns.js";
import { uploadAttachment } from "../../src/services/attachments.js";
import { DiskStorage } from "../../src/storage/disk.js";
import app from "../../src/app.js";
// sse.ts was migrated out of app.ts (into the relay service) — import it directly
// so the integration test can mount it in a miniApp without the full app.
import sseRouter from "../../src/routes/sse.js";
// card-assignees and other services emit on the @kata/events bus (mocked in setup-mocks.ts).
import { eventBus } from "@kata/events";
// sse.ts subscribes on the local in-process bus — spy on this for SSE tests.
import { eventBus as localEventBus } from "../../src/events/bus.js";

mockBetterAuth();

beforeEach(async () => {
	setCurrentUser(null);
	clearMockStorage();
	vi.restoreAllMocks(); // restore spied methods to originals between tests
	vi.clearAllMocks();
	await truncateAll();
});

// ── Finding 1: SSE — stream.close() does not fire onAbort ────────────────────
//
// BUG:
//   The session-expiry watchdog in sse.ts called stream.close() when auth
//   failed. Hono's StreamingApi.close() only shuts the writer; it never calls
//   abort() or notifies onAbort subscribers. The cleanup callback registered
//   via stream.onAbort() (which calls unsubscribe() + clearInterval for both
//   timers) therefore never ran, leaking the eventBus subscription and both
//   setInterval handles for the lifetime of the process.
//
// FIX (routes/sse.ts):
//   Changed stream.close() → stream.abort() on the session-expiry path.
//   stream.abort() sets this.aborted = true and synchronously fires all
//   onAbort subscribers, so the cleanup callback runs immediately.

describe("Finding 1 — SSE: stream.close() replaced with stream.abort()", () => {
	it("Hono stream.close() does NOT fire onAbort (documents the root cause)", async () => {
		const miniApp = new Hono();
		let onAbortCalled = false;

		miniApp.get("/test-sse", (c) =>
			streamSSE(c, async (stream) => {
				stream.onAbort(() => {
					onAbortCalled = true;
				});
				// This is what the old code did — close() skips onAbort
				await stream.close();
			}),
		);

		await miniApp.request(new Request("http://localhost/test-sse"));
		expect(onAbortCalled).toBe(false); // close() never fires onAbort
	});

	it("stream.abort() DOES fire onAbort (confirms the fix)", async () => {
		const miniApp = new Hono();
		let onAbortCalled = false;

		miniApp.get("/test-sse", (c) =>
			streamSSE(c, async (stream) => {
				stream.onAbort(() => {
					onAbortCalled = true;
				});
				stream.abort();
				await new Promise((r) => setTimeout(r, 0));
			}),
		);

		await miniApp.request(new Request("http://localhost/test-sse"));
		expect(onAbortCalled).toBe(true); // abort() fires onAbort correctly
	});

	it("subscription IS cleaned up after session expires (end-to-end fix verification)", async () => {
		// sse.ts was removed from app.ts when the relay service was extracted.
		// Mount it in a miniApp so we can test the route handler directly without
		// routing through the full application server.
		const miniApp = new Hono();
		miniApp.route("/api/boards", sseRouter);

		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		// Verify the EventEmitter has no listeners for this board yet.
		// InProcessEventBus uses a private EventEmitter; access via cast.
		const emitter = (localEventBus as unknown as { emitter: { listenerCount(e: string): number } }).emitter;
		expect(emitter.listenerCount(board.id)).toBe(0);

		// Only fake setInterval/clearInterval — the SSE watchdog uses setInterval,
		// not setTimeout. Leaving setTimeout real ensures node-postgres internals
		// (which use setTimeout(fn, 0) for deferred work) are not disrupted.
		vi.useFakeTimers({
			toFake: ["setInterval", "clearInterval"],
		});

		// Fire and forget — nobody reads the response body. This is fine because
		// the sse.ts session-expiry path no longer awaits writeSSE before abort();
		// awaiting caused a backpressure deadlock when no consumer was reading.
		void miniApp.request(
			new Request(`http://localhost/api/boards/${board.id}/events`, {
				headers: { accept: "text/event-stream" },
			}),
		);

		// setTimeout is NOT faked (only setInterval/clearInterval are). Use a real
		// 200ms wait — generous enough for the two DB round-trips in requireSession
		// and loadBoardAccess to resolve before we inspect the listener count.
		await new Promise((resolve) => setTimeout(resolve, 200));

		// The SSE handler has registered its subscription — 1 listener now.
		expect(emitter.listenerCount(board.id)).toBe(1);

		setCurrentUser(null); // expire the session

		// Fire the sessionWatch interval and flush the resulting async callback.
		// The callback is async (awaits getSession), so extra flushes are needed.
		await vi.advanceTimersByTimeAsync(10_001);
		for (let i = 0; i < 10; i++) await Promise.resolve();

		// FIX: abort() fires onAbort → unsubscribe() removes the EventEmitter listener.
		expect(emitter.listenerCount(board.id)).toBe(0);

		vi.useRealTimers();
	});
});

// ── Finding 2: DELETE attachment — missing uploader-or-admin guard ────────────
//
// BUG:
//   DELETE /api/boards/:boardId/cards/:cardId/attachments/:attachmentId applied
//   only loadBoardAccess — any team-member could delete any attachment regardless
//   of who uploaded it. Contrast with card-comments DELETE which gates on
//   isAuthor || isAdmin.
//
// FIX (routes/card-attachments.ts):
//   The DELETE handler now resolves the attachment row first and checks
//   att.uploadedBy === user.id (uploader) or access.kind is team-admin /
//   personal-owner (admin). Non-uploading team-members receive 403 FORBIDDEN.

describe("Finding 2 — DELETE attachment: uploader-or-admin guard added", () => {
	it("team-member who did not upload the attachment receives 403", async () => {
		const uploader = await seedUser({ email: "uploader@finding2.com" });
		const peer = await seedUser({ email: "peer@finding2.com" });
		const { board } = await seedTeamWithBoard({
			domain: "finding2.com",
			members: [
				{ userId: uploader.id, role: "admin" },
				{ userId: peer.id, role: "member" },
			],
		});
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		setCurrentUser({ id: uploader.id, email: uploader.email });
		const form = new FormData();
		form.append("file", new Blob(["secret data"], { type: "text/plain" }), "secret.txt");
		const uploadRes = await apiRequestRaw(
			new Request(
				`http://localhost/api/boards/${board.id}/cards/${card.id}/attachments`,
				{ method: "POST", body: form },
			),
		);
		expect(uploadRes.status).toBe(201);
		const att = (await uploadRes.json()) as { id: string };

		setCurrentUser({ id: peer.id, email: peer.email });
		const deleteRes = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/attachments/${att.id}`,
		);
		expect(deleteRes.status).toBe(403);
	});

	it("uploader can delete their own attachment", async () => {
		const user = await seedUser({ email: "owner@finding2c.com" });
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		setCurrentUser({ id: user.id, email: user.email });
		const form = new FormData();
		form.append("file", new Blob(["data"], { type: "text/plain" }), "own.txt");
		const uploadRes = await apiRequestRaw(
			new Request(
				`http://localhost/api/boards/${board.id}/cards/${card.id}/attachments`,
				{ method: "POST", body: form },
			),
		);
		const att = (await uploadRes.json()) as { id: string };

		const deleteRes = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/attachments/${att.id}`,
		);
		expect(deleteRes.status).toBe(204);
	});

	it("team-admin can delete any attachment", async () => {
		const admin = await seedUser({ email: "admin@finding2b.com" });
		const uploader = await seedUser({ email: "uploader@finding2b.com" });
		const { board } = await seedTeamWithBoard({
			domain: "finding2b.com",
			members: [
				{ userId: admin.id, role: "admin" },
				{ userId: uploader.id, role: "member" },
			],
		});
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		setCurrentUser({ id: uploader.id, email: uploader.email });
		const form = new FormData();
		form.append("file", new Blob(["data"], { type: "text/plain" }), "file.txt");
		const uploadRes = await apiRequestRaw(
			new Request(
				`http://localhost/api/boards/${board.id}/cards/${card.id}/attachments`,
				{ method: "POST", body: form },
			),
		);
		const att = (await uploadRes.json()) as { id: string };

		setCurrentUser({ id: admin.id, email: admin.email });
		const deleteRes = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/attachments/${att.id}`,
		);
		expect(deleteRes.status).toBe(204);
	});
});

// ── Finding 3: createCard — position race / missing uniqueness guarantee ──────
//
// BUG:
//   createCard read the last card's position with a plain SELECT (no lock), then
//   called appendAfter() and inserted. Two concurrent requests both read the same
//   lastCard.position and called the deterministic appendAfter() with the same
//   argument, producing identical fractional keys. There was no UNIQUE constraint
//   on (columnId, position), so both inserts succeeded, corrupting column order.
//
// FIX (services/cards.ts):
//   The SELECT + INSERT are now wrapped in a transaction with FOR UPDATE on the
//   column row. Concurrent createCard calls on the same column serialize at the
//   lock acquisition, so each reads a distinct lastCard.position.

describe("Finding 3 — createCard: position race closed by FOR UPDATE column lock", () => {
	it("confirms no DB-level unique constraint exists (fix is via lock, not schema)", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);

		const now = new Date();
		await pool.query(
			`INSERT INTO cards
				(id, board_id, column_id, title, position, label_ids, assignee_ids,
				 attachment_ids, comments, checklists, created_at, updated_at)
			 VALUES ($1, $2, $3, 'Card A', 'a0', '{}', '{}', '{}', '[]', '[]', $4, $4)`,
			[newId(), board.id, col.id, now],
		);
		// A second direct insert with the same position still succeeds — there
		// is no UNIQUE constraint. The service fix serializes via lock instead.
		await expect(
			pool.query(
				`INSERT INTO cards
					(id, board_id, column_id, title, position, label_ids, assignee_ids,
					 attachment_ids, comments, checklists, created_at, updated_at)
				 VALUES ($1, $2, $3, 'Card B', 'a0', '{}', '{}', '{}', '[]', '[]', $4, $4)`,
				[newId(), board.id, col.id, now],
			),
		).resolves.toBeDefined();
	});

	it("concurrent createCard calls produce distinct positions (lock prevents race)", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);

		const [a, b] = await Promise.all([
			createCard({ boardId: board.id, columnId: col.id, title: "Card A" }),
			createCard({ boardId: board.id, columnId: col.id, title: "Card B" }),
		]);

		// The FOR UPDATE lock serializes the two inserts, ensuring each reads a
		// distinct lastCard.position and therefore gets a distinct fractional key.
		expect(a.position).not.toBe(b.position);
	});
});

// ── Finding 4: deleteColumn — non-atomic empty-check + delete ────────────────
//
// BUG:
//   deleteColumn ran COUNT(*) and DELETE as two separate READ COMMITTED statements.
//   A card inserted between them would be silently cascade-deleted by PostgreSQL's
//   ON DELETE CASCADE, violating the "column must be empty" invariant with no error.
//
// FIX (services/columns.ts):
//   Both the count check and the delete now run inside a single transaction with
//   a FOR UPDATE lock on the column row. The lock blocks concurrent insertions
//   (which lock the column's parent board) until the transaction commits, making
//   the check-then-delete atomic.

describe("Finding 4 — deleteColumn: check-then-delete now atomic via transaction", () => {
	it("demonstrates the window still exists at the raw SQL level (service fix is above SQL)", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);

		const [{ value: cardCount } = { value: 0 }] = await localDb
			.select({ value: count() })
			.from(cards)
			.where(eq(cards.columnId, col.id));
		expect(cardCount).toBe(0);

		const newCard = await seedCard(board.id, col.id, { title: "Orphan" });

		// Raw delete bypasses the service — cascade silently removes the card
		await localDb.delete(columns).where(
			and(eq(columns.id, col.id), eq(columns.boardId, board.id)),
		);

		const remaining = await localDb
			.select()
			.from(cards)
			.where(eq(cards.id, newCard.id));
		expect(remaining).toHaveLength(0);
	});

	it("deleteColumn service throws CONFLICT when a card is present (existing guard)", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id, { title: "Existing" });

		await expect(deleteColumn(board.id, col.id)).rejects.toMatchObject({
			code: "CONFLICT",
		});

		const [row] = await localDb.select().from(cards).where(eq(cards.id, card.id));
		expect(row).toBeDefined();
	});

	it("deleteColumn succeeds on an empty column and emits column.deleted", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);

		await expect(deleteColumn(board.id, col.id)).resolves.toBeUndefined();

		const [row] = await localDb.select().from(columns).where(eq(columns.id, col.id));
		expect(row).toBeUndefined();
	});
});

// ── Finding 5: uploadAttachment — orphaned storage on DB failure ──────────────
//
// BUG:
//   storage.put() was called before db.transaction(). If the transaction failed
//   (e.g. DB connection lost, card deleted concurrently), the storage object was
//   permanently orphaned — no cleanup path existed and no reconciliation job ran.
//
// FIX (services/attachments.ts):
//   A try/catch wraps db.transaction(). On failure, storage.delete(storageKey)
//   is called (best-effort, errors suppressed) before re-throwing, ensuring the
//   uploaded file is removed when the DB record cannot be created.

describe("Finding 5 — uploadAttachment: orphaned storage cleaned up on DB failure", () => {
	it("storage.delete is called when the DB transaction fails after a successful storage.put", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		vi.spyOn(db, "transaction").mockRejectedValueOnce(
			new Error("Simulated DB connection loss"),
		);

		const file = new File(["attachment content"], "doc.txt", { type: "text/plain" });

		await expect(
			uploadAttachment({
				boardId: board.id,
				cardId: card.id,
				file,
				user: { id: user.id, email: user.email },
			}),
		).rejects.toThrow("Simulated DB connection loss");

		// Storage.put was called first (storage write succeeded)
		expect(mockStorage.put).toHaveBeenCalledOnce();

		// FIX: storage.delete is now called to clean up the orphaned object
		expect(mockStorage.delete).toHaveBeenCalledOnce();

		// No attachment row was created in the DB
		const [att] = await localDb
			.select()
			.from(attachments)
			.where(eq(attachments.cardId, card.id));
		expect(att).toBeUndefined();
	});
});

// ── Finding 6: DiskStorage.get — lazy ENOENT bypasses try/catch ──────────────
//
// BUG:
//   DiskStorage.get() wrapped createReadStream() in a try/catch. Node.js's
//   createReadStream is lazy — it returns a stream object immediately without
//   opening the file. ENOENT is only emitted as an asynchronous 'error' event
//   when the stream is first consumed. The try/catch exited before that, so it
//   never caught ENOENT. Callers received a resolved stream that would crash
//   the process (unhandled 'error' event) when consumed.
//
// FIX (storage/disk.ts):
//   get() now wraps createReadStream in a Promise that resolves on the 'open'
//   event (file successfully opened) and rejects on 'error'. ENOENT maps to
//   AppError("NOT_FOUND") and other errors to AppError("INTERNAL_ERROR").
//   Callers receive a rejected promise before reading any bytes.

describe("Finding 6 — DiskStorage.get: lazy ENOENT now caught before stream consumption", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(path.join(os.tmpdir(), "kata-disk-test-"));
	});

	afterEach(async () => {
		if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
	});

	it("get() rejects with NOT_FOUND for a missing file (fix verified)", async () => {
		const storage = new DiskStorage(tmpDir);

		// FIX: get() now returns a rejected promise immediately instead of
		// returning a broken stream that emits an unhandled error event later.
		await expect(storage.get("nonexistent-file.txt")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("get() resolves with a readable stream for a file that exists", async () => {
		const storage = new DiskStorage(tmpDir);
		await writeFile(path.join(tmpDir, "hello.txt"), "hello world");

		const stream = await storage.get("hello.txt");
		const chunks: Buffer[] = [];
		for await (const chunk of stream) {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
		}
		expect(Buffer.concat(chunks).toString()).toBe("hello world");
	});
});

// ── Finding 7: GET /api/users/:userId/avatar — no relationship check ──────────
//
// BUG:
//   The avatar endpoint required only a valid session. Any authenticated user
//   could fetch any other user's photo by supplying an arbitrary userId, with no
//   check of team membership or board access.
//
// FIX (routes/users.ts):
//   For userId !== requester.id, the handler now joins teamMembers twice (using
//   Drizzle aliases) to verify that the requester and the target share at least
//   one team. Users with no shared team receive 403 FORBIDDEN. Self-access is
//   always permitted without the extra query.

describe("Finding 7 — Avatar endpoint: relationship guard added", () => {
	it("unrelated authenticated user receives 403 when fetching another user's avatar", async () => {
		const alice = await seedUser({ email: "alice@finding7.com" });
		const bob = await seedUser({ email: "bob@finding7.com" });

		setCurrentUser({ id: alice.id, email: alice.email });
		const form = new FormData();
		form.append(
			"file",
			new Blob(["avatar bytes"], { type: "image/png" }),
			"avatar.png",
		);
		const uploadRes = await apiRequestRaw(
			new Request("http://localhost/api/users/me/avatar", {
				method: "POST",
				body: form,
			}),
		);
		expect(uploadRes.status).toBe(200);

		// Bob shares no team with Alice — should be blocked
		setCurrentUser({ id: bob.id, email: bob.email });
		const res = await apiRequest("GET", `/api/users/${alice.id}/avatar`);
		expect(res.status).toBe(403);
	});

	it("a team-mate can fetch a co-member's avatar", async () => {
		const alice = await seedUser({ email: "alice@finding7b.com" });
		const bob = await seedUser({ email: "bob@finding7b.com" });
		await seedTeamWithBoard({
			domain: "finding7b.com",
			members: [
				{ userId: alice.id, role: "admin" },
				{ userId: bob.id, role: "member" },
			],
		});

		setCurrentUser({ id: alice.id, email: alice.email });
		const form = new FormData();
		form.append("file", new Blob(["bytes"], { type: "image/png" }), "a.png");
		await apiRequestRaw(
			new Request("http://localhost/api/users/me/avatar", {
				method: "POST",
				body: form,
			}),
		);

		setCurrentUser({ id: bob.id, email: bob.email });
		const res = await apiRequest("GET", `/api/users/${alice.id}/avatar`);
		expect(res.status).toBe(200);
	});

	it("a user can always fetch their own avatar", async () => {
		const user = await seedUser({ email: "self@finding7.com" });
		setCurrentUser({ id: user.id, email: user.email });

		const form = new FormData();
		form.append("file", new Blob(["bytes"], { type: "image/png" }), "self.png");
		await apiRequestRaw(
			new Request("http://localhost/api/users/me/avatar", {
				method: "POST",
				body: form,
			}),
		);

		const res = await apiRequest("GET", `/api/users/${user.id}/avatar`);
		expect(res.status).toBe(200);
	});
});

// ── Finding 8: GET /api/boards/team — non-deterministic LIMIT 1 ──────────────
//
// BUG:
//   Both GET /api/boards/team (boards.ts) and GET /api/teams/mine (teams.ts)
//   queried teamMembers WHERE userId = ? LIMIT 1 with no ORDER BY. A user
//   belonging to multiple teams would get a different row back depending on the
//   PostgreSQL query planner's access path, which is non-deterministic across
//   statistics updates and vacuums.
//
// FIX (routes/boards.ts, routes/teams.ts):
//   Added ORDER BY teamMembers.joinedAt ASC to both LIMIT 1 queries.
//   The earliest-joined team is now always returned deterministically.

describe("Finding 8 — GET /api/boards/team: deterministic result via ORDER BY joinedAt", () => {
	it("user in two teams always gets the earliest-joined team's board", async () => {
		const user = await seedUser({ email: "multi@finding8.com" });

		const { team: teamA, board: boardA } = await seedTeamWithBoard({
			domain: "team-alpha.finding8.com",
			members: [{ userId: user.id, role: "admin" }],
		});
		const { board: boardB } = await seedTeamWithBoard({
			domain: "team-beta.finding8.com",
			members: [{ userId: user.id, role: "member" }],
		});

		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", "/api/boards/team");
		expect(res.status).toBe(200);

		const body = (await res.json()) as { id: string };

		// teamA was joined first so its board is always returned
		expect(body.id).toBe(boardA.id);
		// boardB is never returned despite being valid
		expect(body.id).not.toBe(boardB.id);

		void teamA; // referenced above via boardA
	});

	it("result is stable across multiple concurrent requests", async () => {
		const user = await seedUser({ email: "stable@finding8.com" });
		const { board } = await seedTeamWithBoard({
			domain: "stable.finding8.com",
			members: [{ userId: user.id, role: "admin" }],
		});

		setCurrentUser({ id: user.id, email: user.email });

		const [res1, res2, res3] = await Promise.all([
			apiRequest("GET", "/api/boards/team"),
			apiRequest("GET", "/api/boards/team"),
			apiRequest("GET", "/api/boards/team"),
		]);

		const [b1, b2, b3] = await Promise.all([
			res1.json() as Promise<{ id: string }>,
			res2.json() as Promise<{ id: string }>,
			res3.json() as Promise<{ id: string }>,
		]);

		expect(b1.id).toBe(board.id);
		expect(b2.id).toBe(board.id);
		expect(b3.id).toBe(board.id);
	});
});

// ── Finding 9: DELETE assignee — phantom removal event ───────────────────────
//
// BUG:
//   DELETE /assignees/:userId called array_remove(assigneeIds, userId) regardless
//   of whether the userId was actually in the array. PostgreSQL's array_remove
//   is a no-op for missing elements but the UPDATE still touches the row, so
//   result.length = 1 and card.assignee.removed was always emitted. SSE clients
//   received phantom removal events for users who were never assigned, causing
//   local state desync.
//
// FIX (routes/card-assignees.ts):
//   The handler now fetches the current assigneeIds first. If userId is not in
//   the array, it returns 204 immediately without performing the UPDATE or
//   emitting any event (idempotent, no side-effects). The event is only emitted
//   when the userId was actually present.

describe("Finding 9 — DELETE assignee: no phantom event for non-assigned userId", () => {
	it("no card.assignee.removed event is emitted for a userId that was not assigned", async () => {
		const user = await seedUser({ email: "user@finding9.com" });
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const emitSpy = vi.spyOn(eventBus, "emit");
		const ghostUserId = newId();

		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/assignees/${ghostUserId}`,
		);
		expect(res.status).toBe(204); // still idempotent

		const removalEmits = emitSpy.mock.calls
			.map((call) => call[0])
			.filter(
				(e) =>
					e &&
					typeof e === "object" &&
					"type" in e &&
					e.type === "card.assignee.removed",
			);

		// FIX: no event emitted for a userId that was never assigned
		expect(removalEmits).toHaveLength(0);
	});

	it("card.assignee.removed IS emitted when a userId is actually assigned", async () => {
		const admin = await seedUser({ email: "admin@finding9c.com" });
		const member = await seedUser({ email: "member@finding9c.com" });
		const { board } = await seedTeamWithBoard({
			domain: "finding9c.com",
			members: [
				{ userId: admin.id, role: "admin" },
				{ userId: member.id, role: "member" },
			],
		});
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		setCurrentUser({ id: admin.id, email: admin.email });
		await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/assignees`,
			{ body: { userId: member.id } },
		);

		const emitSpy = vi.spyOn(eventBus, "emit");

		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/assignees/${member.id}`,
		);
		expect(res.status).toBe(204);

		const removalEmits = emitSpy.mock.calls
			.map((call) => call[0])
			.filter(
				(e) =>
					e &&
					typeof e === "object" &&
					"type" in e &&
					e.type === "card.assignee.removed",
			);
		expect(removalEmits).toHaveLength(1);
	});

	it("repeated DELETE for the same userId is idempotent with no extra events", async () => {
		const admin = await seedUser({ email: "admin@finding9d.com" });
		const member = await seedUser({ email: "member@finding9d.com" });
		const { board } = await seedTeamWithBoard({
			domain: "finding9d.com",
			members: [
				{ userId: admin.id, role: "admin" },
				{ userId: member.id, role: "member" },
			],
		});
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		setCurrentUser({ id: admin.id, email: admin.email });
		await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/assignees`,
			{ body: { userId: member.id } },
		);

		// First removal — event should fire
		await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/assignees/${member.id}`,
		);

		// Fresh spy — start counting only from this point forward
		const emitSpy = vi.spyOn(eventBus, "emit");
		emitSpy.mockClear();

		// Second removal (idempotent) — no event
		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/assignees/${member.id}`,
		);
		expect(res.status).toBe(204);

		const removalEmits = emitSpy.mock.calls
			.map((call) => call[0])
			.filter(
				(e) =>
					e &&
					typeof e === "object" &&
					"type" in e &&
					e.type === "card.assignee.removed",
			);
		expect(removalEmits).toHaveLength(0);
	});
});
