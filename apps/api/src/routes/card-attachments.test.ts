import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the storage module before importing the service so the service
// receives the in-memory adapter instead of the real DiskStorage/GcsStorage.
vi.mock("../storage/index.js", async () => ({
	storage: (await import("../../test/helpers/mock-storage.js")).mockStorage,
}));

// Mock eventBus so tests don't depend on bus internals.
vi.mock("../events/bus.js", () => ({
	eventBus: { emit: vi.fn(), subscribe: vi.fn(() => vi.fn()) },
}));

import { mockBetterAuth, setCurrentUser } from "../../test/helpers/mock-session.js";
import { apiRequest, apiRequestRaw } from "../../test/helpers/request.js";
import { clearMockStorage } from "../../test/helpers/mock-storage.js";
import {
	seedUser,
	seedPersonalBoard,
	seedTeamWithBoard,
	seedColumn,
	seedCard,
} from "../../test/helpers/seed.js";

mockBetterAuth();

import app from "../app.js";

void app;

beforeEach(() => {
	setCurrentUser(null);
	clearMockStorage();
	vi.clearAllMocks();
});

// ── POST /api/boards/:boardId/cards/:cardId/attachments ───────────────────────

describe("POST /api/boards/:boardId/cards/:cardId/attachments", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest(
			"POST",
			"/api/boards/fakeid/cards/fakecardid/attachments",
		);
		expect(res.status).toBe(401);
		const body = await res.json() as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("returns 201 with attachment metadata on success", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const form = new FormData();
		form.append("file", new Blob(["hello"], { type: "text/plain" }), "hello.txt");

		const res = await apiRequestRaw(
			new Request(
				`http://localhost/api/boards/${board.id}/cards/${card.id}/attachments`,
				{ method: "POST", body: form },
			),
		);
		expect(res.status).toBe(201);

		const body = await res.json() as {
			id: string;
			filename: string;
			mimeType: string;
			sizeBytes: number;
			url: string;
			uploadedBy: string;
		};
		expect(body.filename).toBe("hello.txt");
		expect(body.mimeType).toBe("text/plain");
		expect(body.uploadedBy).toBe(user.id);
		expect(body.url).toContain("/api/attachments/");
		expect(typeof body.id).toBe("string");
	});

	it("returns 413 when file exceeds MAX_ATTACHMENT_BYTES", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const oversizedContent = "x".repeat(30_000_000); // 30 MB, above default 26 MB limit
		const form = new FormData();
		form.append("file", new Blob([oversizedContent], { type: "text/plain" }), "big.txt");

		const res = await apiRequestRaw(
			new Request(
				`http://localhost/api/boards/${board.id}/cards/${card.id}/attachments`,
				{ method: "POST", body: form },
			),
		);
		expect(res.status).toBe(413);
	});

	it("returns 415 when file MIME type is not allowed", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const form = new FormData();
		form.append("file", new Blob(["#!/bin/sh"], { type: "application/x-sh" }), "script.sh");

		const res = await apiRequestRaw(
			new Request(
				`http://localhost/api/boards/${board.id}/cards/${card.id}/attachments`,
				{ method: "POST", body: form },
			),
		);
		expect(res.status).toBe(415);
	});

	it("returns 422 when FormData has no file field", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const form = new FormData();
		form.append("other", "not-a-file");

		const res = await apiRequestRaw(
			new Request(
				`http://localhost/api/boards/${board.id}/cards/${card.id}/attachments`,
				{ method: "POST", body: form },
			),
		);
		expect(res.status).toBe(422);
	});

	it("BUG-004 regression: returns 404 when cardId belongs to a different board", async () => {
		const userA = await seedUser();
		const boardA = await seedPersonalBoard(userA.id);

		const userB = await seedUser();
		const boardB = await seedPersonalBoard(userB.id);
		const colB = await seedColumn(boardB.id);
		const cardB = await seedCard(boardB.id, colB.id);

		// Authenticate as userA but supply boardA.id with cardB.id (from boardB)
		setCurrentUser({ id: userA.id, email: userA.email });

		const form = new FormData();
		form.append("file", new Blob(["data"], { type: "text/plain" }), "data.txt");

		const res = await apiRequestRaw(
			new Request(
				`http://localhost/api/boards/${boardA.id}/cards/${cardB.id}/attachments`,
				{ method: "POST", body: form },
			),
		);
		expect(res.status).toBe(404);
	});
});

// ── DELETE /api/boards/:boardId/cards/:cardId/attachments/:attachmentId ───────

describe("DELETE /api/boards/:boardId/cards/:cardId/attachments/:attachmentId", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest(
			"DELETE",
			"/api/boards/fakeid/cards/fakecardid/attachments/fakeattachmentid",
		);
		expect(res.status).toBe(401);
		const body = await res.json() as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("returns 204 on successful deletion", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		// First upload an attachment so we have one to delete
		const form = new FormData();
		form.append("file", new Blob(["bytes"], { type: "text/plain" }), "file.txt");
		const uploadRes = await apiRequestRaw(
			new Request(
				`http://localhost/api/boards/${board.id}/cards/${card.id}/attachments`,
				{ method: "POST", body: form },
			),
		);
		expect(uploadRes.status).toBe(201);
		const att = await uploadRes.json() as { id: string };

		const deleteRes = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/attachments/${att.id}`,
		);
		expect(deleteRes.status).toBe(204);
	});

	it("BUG-004 regression: returns 404 when cardId does not match the attachment's card", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const cardA = await seedCard(board.id, col.id, { title: "Card A" });
		const cardB = await seedCard(board.id, col.id, { title: "Card B" });
		setCurrentUser({ id: user.id, email: user.email });

		// Upload attachment to cardA
		const form = new FormData();
		form.append("file", new Blob(["bytes"], { type: "text/plain" }), "file.txt");
		const uploadRes = await apiRequestRaw(
			new Request(
				`http://localhost/api/boards/${board.id}/cards/${cardA.id}/attachments`,
				{ method: "POST", body: form },
			),
		);
		expect(uploadRes.status).toBe(201);
		const att = await uploadRes.json() as { id: string };

		// Attempt delete scoped to cardB (wrong cardId)
		const deleteRes = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${cardB.id}/attachments/${att.id}`,
		);
		expect(deleteRes.status).toBe(404);
	});

	it("returns 403 when a non-member tries to delete an attachment", async () => {
		const owner = await seedUser({ email: "owner@test.com" });
		const stranger = await seedUser({ email: "stranger@test.com" });
		const { board } = await seedTeamWithBoard({
			domain: "delete-attach.com",
			members: [{ userId: owner.id, role: "admin" }],
		});
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		// Upload as owner first
		setCurrentUser({ id: owner.id, email: owner.email });
		const form = new FormData();
		form.append("file", new Blob(["bytes"], { type: "text/plain" }), "file.txt");
		const uploadRes = await apiRequestRaw(
			new Request(
				`http://localhost/api/boards/${board.id}/cards/${card.id}/attachments`,
				{ method: "POST", body: form },
			),
		);
		expect(uploadRes.status).toBe(201);
		const att = await uploadRes.json() as { id: string };

		// Attempt delete as stranger (not a team member)
		setCurrentUser({ id: stranger.id, email: stranger.email });
		const deleteRes = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/attachments/${att.id}`,
		);
		expect(deleteRes.status).toBe(403);
	});
});
