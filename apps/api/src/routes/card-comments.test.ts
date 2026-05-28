import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { cards } from "../db/schema/index.js";
import { mockBetterAuth, setCurrentUser } from "../../test/helpers/mock-session.js";
import { apiRequest } from "../../test/helpers/request.js";
import {
	seedUser,
	seedPersonalBoard,
	seedTeamWithBoard,
	seedColumn,
	seedCard,
} from "../../test/helpers/seed.js";
import { newId } from "../db/ids.js";
import type { Comment } from "../db/schema/cards.js";

mockBetterAuth();

// eslint-disable-next-line import/first
import app from "../app.js";

void app;

beforeEach(() => {
	setCurrentUser(null);
});

// ── POST /api/boards/:boardId/cards/:cardId/comments ──────────────────────────

describe("POST /api/boards/:boardId/cards/:cardId/comments", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest(
			"POST",
			"/api/boards/fakeid/cards/fakecardid/comments",
			{ body: { body: "hello" } },
		);
		expect(res.status).toBe(401);
		const body = await res.json() as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("returns 201 with comment payload on success", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/comments`,
			{ body: { body: "This is a comment." } },
		);
		expect(res.status).toBe(201);

		const payload = await res.json() as {
			id: string;
			authorId: string;
			body: string;
			createdAt: string;
		};
		expect(payload.authorId).toBe(user.id);
		expect(payload.body).toBe("This is a comment.");
		expect(typeof payload.id).toBe("string");
		expect(typeof payload.createdAt).toBe("string");
	});

	it("returns 422 when body is empty string", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/comments`,
			{ body: { body: "" } },
		);
		expect(res.status).toBe(422);
	});

	it("returns 201 when body is exactly 10000 characters", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/comments`,
			{ body: { body: "a".repeat(10000) } },
		);
		expect(res.status).toBe(201);
	});

	it("returns 422 when body exceeds 10000 characters", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/comments`,
			{ body: { body: "a".repeat(10001) } },
		);
		expect(res.status).toBe(422);
	});

	it("returns 409 when card already has 500 comments (BUG-009 regression)", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		// Directly set 500 comments on the card via Drizzle
		const preloadedComments: Comment[] = Array.from({ length: 500 }, (_, i) => ({
			id: newId(),
			authorId: user.id,
			body: `Comment ${i + 1}`,
			createdAt: new Date().toISOString(),
		}));

		await db
			.update(cards)
			.set({ comments: preloadedComments })
			.where(eq(cards.id, card.id));

		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/comments`,
			{ body: { body: "This should be rejected" } },
		);
		expect(res.status).toBe(409);

		const body = await res.json() as { error: { message: string } };
		expect(body.error.message).toBe("Comment limit reached.");
	});
});

// ── PATCH /api/boards/:boardId/cards/:cardId/comments/:commentId ───────────────

describe("PATCH /api/boards/:boardId/cards/:cardId/comments/:commentId", () => {
	it("returns 403 when non-author tries to edit a comment", async () => {
		const author = await seedUser();
		const other = await seedUser();
		const { board } = await seedTeamWithBoard({
			domain: "edit-comment.com",
			members: [
				{ userId: author.id, role: "admin" },
				{ userId: other.id, role: "member" },
			],
		});
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		const commentId = newId();
		const comment: Comment = {
			id: commentId,
			authorId: author.id,
			body: "Author's comment",
			createdAt: new Date().toISOString(),
		};
		await db.update(cards).set({ comments: [comment] }).where(eq(cards.id, card.id));

		setCurrentUser({ id: other.id, email: other.email });

		const res = await apiRequest(
			"PATCH",
			`/api/boards/${board.id}/cards/${card.id}/comments/${commentId}`,
			{ body: { body: "Trying to edit" } },
		);
		expect(res.status).toBe(403);

		const body = await res.json() as { error: { message: string } };
		expect(body.error.message).toBe("Only the author may edit this comment.");
	});

	it("returns 200 when author edits their own comment", async () => {
		const author = await seedUser();
		const board = await seedPersonalBoard(author.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		const commentId = newId();
		const comment: Comment = {
			id: commentId,
			authorId: author.id,
			body: "Original comment",
			createdAt: new Date().toISOString(),
		};
		await db.update(cards).set({ comments: [comment] }).where(eq(cards.id, card.id));

		setCurrentUser({ id: author.id, email: author.email });

		const res = await apiRequest(
			"PATCH",
			`/api/boards/${board.id}/cards/${card.id}/comments/${commentId}`,
			{ body: { body: "Edited comment" } },
		);
		expect(res.status).toBe(200);

		const body = await res.json() as { body: string };
		expect(body.body).toBe("Edited comment");
	});
});

// ── DELETE /api/boards/:boardId/cards/:cardId/comments/:commentId ──────────────

describe("DELETE /api/boards/:boardId/cards/:cardId/comments/:commentId", () => {
	it("returns 204 when author deletes their own comment", async () => {
		const author = await seedUser();
		const board = await seedPersonalBoard(author.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		const commentId = newId();
		const comment: Comment = {
			id: commentId,
			authorId: author.id,
			body: "To be deleted",
			createdAt: new Date().toISOString(),
		};
		await db.update(cards).set({ comments: [comment] }).where(eq(cards.id, card.id));

		setCurrentUser({ id: author.id, email: author.email });

		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/comments/${commentId}`,
		);
		expect(res.status).toBe(204);
	});

	it("returns 204 when board admin deletes a comment they did not author", async () => {
		const author = await seedUser();
		const admin = await seedUser();
		const { board } = await seedTeamWithBoard({
			domain: "admin-delete.com",
			members: [
				{ userId: admin.id, role: "admin" },
				{ userId: author.id, role: "member" },
			],
		});
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		const commentId = newId();
		const comment: Comment = {
			id: commentId,
			authorId: author.id,
			body: "Member's comment",
			createdAt: new Date().toISOString(),
		};
		await db.update(cards).set({ comments: [comment] }).where(eq(cards.id, card.id));

		setCurrentUser({ id: admin.id, email: admin.email });

		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/comments/${commentId}`,
		);
		expect(res.status).toBe(204);
	});

	it("returns 403 when non-author non-admin tries to delete a comment", async () => {
		const author = await seedUser();
		const other = await seedUser();
		const { board } = await seedTeamWithBoard({
			domain: "no-delete.com",
			members: [
				{ userId: author.id, role: "admin" },
				{ userId: other.id, role: "member" },
			],
		});
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);

		const commentId = newId();
		const comment: Comment = {
			id: commentId,
			authorId: author.id,
			body: "Protected comment",
			createdAt: new Date().toISOString(),
		};
		await db.update(cards).set({ comments: [comment] }).where(eq(cards.id, card.id));

		setCurrentUser({ id: other.id, email: other.email });

		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/cards/${card.id}/comments/${commentId}`,
		);
		expect(res.status).toBe(403);
	});
});
