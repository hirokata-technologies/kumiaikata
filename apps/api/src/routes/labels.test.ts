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
	seedLabel,
} from "../../test/helpers/seed.js";

mockBetterAuth();

// eslint-disable-next-line import/first
import app from "../app.js";

void app;

beforeEach(() => {
	setCurrentUser(null);
});

// ── GET /api/boards/:boardId/labels ───────────────────────────────────────────

describe("GET /api/boards/:boardId/labels (BUG-005 regression)", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest("GET", "/api/boards/fakeid/labels");
		expect(res.status).toBe(401);
		const body = await res.json() as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("returns 200 with array of labels for the board", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		await seedLabel(board.id, { name: "Bug", color: "#e11d48" });
		await seedLabel(board.id, { name: "Feature", color: "#0ea5e9" });
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", `/api/boards/${board.id}/labels`);
		expect(res.status).toBe(200);

		const body = await res.json() as Array<{ id: string; name: string; color: string; boardId: string }>;
		expect(Array.isArray(body)).toBe(true);
		expect(body.length).toBe(2);

		const names = body.map((l) => l.name).sort();
		expect(names).toEqual(["Bug", "Feature"]);
	});

	it("returns 200 with empty array when board has no labels", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", `/api/boards/${board.id}/labels`);
		expect(res.status).toBe(200);

		const body = await res.json() as unknown[];
		expect(Array.isArray(body)).toBe(true);
		expect(body.length).toBe(0);
	});
});

// ── POST /api/boards/:boardId/labels ─────────────────────────────────────────

describe("POST /api/boards/:boardId/labels", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest("POST", "/api/boards/fakeid/labels", {
			body: { name: "Bug", color: "#e11d48" },
		});
		expect(res.status).toBe(401);
	});

	it("returns 201 with label detail when called by board admin", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", `/api/boards/${board.id}/labels`, {
			body: { name: "Critical", color: "#e11d48" },
		});
		expect(res.status).toBe(201);

		const body = await res.json() as {
			id: string;
			name: string;
			color: string;
			boardId: string;
		};
		expect(body.name).toBe("Critical");
		expect(body.color).toBe("#e11d48");
		expect(body.boardId).toBe(board.id);
	});

	it("returns 422 when color is not a valid hex color", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", `/api/boards/${board.id}/labels`, {
			body: { name: "Bad Color", color: "notacolor" },
		});
		expect(res.status).toBe(422);
	});

	it("returns 422 when name is empty", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", `/api/boards/${board.id}/labels`, {
			body: { name: "", color: "#e11d48" },
		});
		expect(res.status).toBe(422);
	});

	it("returns 403 when called by a team member (not admin)", async () => {
		const admin = await seedUser();
		const member = await seedUser();
		const { board } = await seedTeamWithBoard({
			domain: "labels-member.com",
			members: [
				{ userId: admin.id, role: "admin" },
				{ userId: member.id, role: "member" },
			],
		});
		setCurrentUser({ id: member.id, email: member.email });

		const res = await apiRequest("POST", `/api/boards/${board.id}/labels`, {
			body: { name: "Member Label", color: "#6366f1" },
		});
		expect(res.status).toBe(403);
	});
});

// ── PATCH /api/boards/:boardId/labels/:labelId ────────────────────────────────

describe("PATCH /api/boards/:boardId/labels/:labelId", () => {
	it("returns 200 with updated label", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const label = await seedLabel(board.id, { name: "Old Name", color: "#000000" });
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"PATCH",
			`/api/boards/${board.id}/labels/${label.id}`,
			{ body: { name: "New Name", color: "#ffffff" } },
		);
		expect(res.status).toBe(200);

		const body = await res.json() as { name: string; color: string };
		expect(body.name).toBe("New Name");
		expect(body.color).toBe("#ffffff");
	});
});

// ── DELETE /api/boards/:boardId/labels/:labelId ───────────────────────────────

describe("DELETE /api/boards/:boardId/labels/:labelId", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest("DELETE", "/api/boards/fakeid/labels/fakelabelid");
		expect(res.status).toBe(401);
	});

	it("returns 204 and removes label from all referencing cards atomically", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id);
		const card = await seedCard(board.id, col.id);
		const label = await seedLabel(board.id, { name: "To Delete", color: "#6366f1" });
		setCurrentUser({ id: user.id, email: user.email });

		// Add label to card first
		await apiRequest(
			"POST",
			`/api/boards/${board.id}/cards/${card.id}/labels`,
			{ body: { labelId: label.id } },
		);

		// Delete the label
		const deleteRes = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/labels/${label.id}`,
		);
		expect(deleteRes.status).toBe(204);

		// Verify label is removed from the card's labelIds
		const [row] = await db
			.select({ labelIds: cards.labelIds })
			.from(cards)
			.where(eq(cards.id, card.id));
		expect(row?.labelIds ?? []).not.toContain(label.id);
	});

	it("returns 404 for a label that does not exist on the board", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest(
			"DELETE",
			`/api/boards/${board.id}/labels/nonexistent-label-id`,
		);
		expect(res.status).toBe(404);
	});
});
