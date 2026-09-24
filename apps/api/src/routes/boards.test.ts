import { describe, it, expect, beforeEach } from "vitest";
import { mockBetterAuth, setCurrentUser } from "../../test/helpers/mock-session.js";
import { apiRequest } from "../../test/helpers/request.js";
import { seedUser, seedPersonalBoard, seedTeamWithBoard, seedColumn, seedCard } from "../../test/helpers/seed.js";
import { pool } from "../../test/helpers/db.js";

mockBetterAuth();

import app from "../app.js";

void app; // imported for side-effects (registers routes)

beforeEach(() => {
	setCurrentUser(null);
});

// ── GET /api/boards/personal ───────────────────────────────────────────────────

describe("GET /api/boards/personal", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest("GET", "/api/boards/personal");
		expect(res.status).toBe(401);
		const body = await res.json() as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("returns 200 with BoardWithColumnsAndCards shape when personal board exists", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const col = await seedColumn(board.id, { title: "To Do" });
		await seedCard(board.id, col.id, { title: "My Task" });

		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", "/api/boards/personal");
		expect(res.status).toBe(200);

		const body = await res.json() as {
			id: string;
			kind: string;
			columns: Array<{ id: string; title: string; cards: unknown[] }>;
		};
		expect(body.id).toBe(board.id);
		expect(body.kind).toBe("personal");
		expect(Array.isArray(body.columns)).toBe(true);
		expect(body.columns[0]?.title).toBe("To Do");
		expect(Array.isArray(body.columns[0]?.cards)).toBe(true);
	});

	it("returns 404 when user has no personal board", async () => {
		const user = await seedUser();
		// Do NOT seed a personal board. Ensure personalBoardId is null.
		await pool.query("UPDATE users SET personal_board_id = NULL WHERE id = $1", [user.id]);

		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", "/api/boards/personal");
		expect(res.status).toBe(404);
	});
});

// ── GET /api/boards/team ───────────────────────────────────────────────────────

describe("GET /api/boards/team", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest("GET", "/api/boards/team");
		expect(res.status).toBe(401);
	});

	it("returns 200 with BoardWithColumnsAndCards when team membership exists", async () => {
		const admin = await seedUser();
		const { team: _team, board } = await seedTeamWithBoard({
			domain: "acme.com",
			members: [{ userId: admin.id, role: "admin" }],
		});
		const col = await seedColumn(board.id, { title: "Backlog" });
		await seedCard(board.id, col.id, { title: "Team Task" });

		setCurrentUser({ id: admin.id, email: admin.email });

		const res = await apiRequest("GET", "/api/boards/team");
		expect(res.status).toBe(200);

		const body = await res.json() as {
			id: string;
			kind: string;
			columns: Array<{ id: string; cards: unknown[] }>;
		};
		expect(body.id).toBe(board.id);
		expect(body.kind).toBe("team");
		expect(Array.isArray(body.columns)).toBe(true);
	});

	it("returns 404 when user has no team membership", async () => {
		const user = await seedUser();
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", "/api/boards/team");
		expect(res.status).toBe(404);
	});
});
