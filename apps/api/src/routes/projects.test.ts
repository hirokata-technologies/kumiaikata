import { describe, it, expect, beforeEach } from "vitest";
import { mockBetterAuth, setCurrentUser } from "../../test/helpers/mock-session.js";
import { apiRequest } from "../../test/helpers/request.js";
import { seedUser, seedPersonalBoard, seedTeamWithBoard } from "../../test/helpers/seed.js";

mockBetterAuth();

// eslint-disable-next-line import/first
import app from "../app.js";

void app;

beforeEach(() => {
	setCurrentUser(null);
});

// ── GET /api/boards/:boardId/projects ─────────────────────────────────────────

describe("GET /api/boards/:boardId/projects", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest("GET", "/api/boards/fakeid/projects");
		expect(res.status).toBe(401);
		const body = await res.json() as { error: { code: string } };
		expect(body.error.code).toBe("UNAUTHENTICATED");
	});

	it("returns 200 with empty array when board has no projects", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", `/api/boards/${board.id}/projects`);
		expect(res.status).toBe(200);
		const body = await res.json() as unknown[];
		expect(Array.isArray(body)).toBe(true);
		expect(body).toHaveLength(0);
	});

	it("returns 200 with projects after creation", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		// Create a project first
		await apiRequest("POST", `/api/boards/${board.id}/projects`, {
			body: { name: "Feature X", color: "#e11d48" },
		});

		const res = await apiRequest("GET", `/api/boards/${board.id}/projects`);
		expect(res.status).toBe(200);
		const body = await res.json() as Array<{ id: string; name: string; color: string }>;
		expect(body).toHaveLength(1);
		expect(body[0]!.name).toBe("Feature X");
		expect(body[0]!.color).toBe("#e11d48");
	});

	it("returns 403 when user has no access to the board", async () => {
		const owner = await seedUser();
		const board = await seedPersonalBoard(owner.id);
		const stranger = await seedUser();
		setCurrentUser({ id: stranger.id, email: stranger.email });

		const res = await apiRequest("GET", `/api/boards/${board.id}/projects`);
		expect(res.status).toBe(403);
	});

	it("returns 404 when board does not exist", async () => {
		const user = await seedUser();
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", "/api/boards/nonexistentboard/projects");
		expect(res.status).toBe(404);
	});
});

// ── POST /api/boards/:boardId/projects ────────────────────────────────────────

describe("POST /api/boards/:boardId/projects", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest("POST", "/api/boards/fakeid/projects", {
			body: { name: "Test", color: "#fff" },
		});
		expect(res.status).toBe(401);
	});

	it("returns 201 with project payload on success (personal board owner)", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", `/api/boards/${board.id}/projects`, {
			body: { name: "My Project", color: "#6366f1" },
		});
		expect(res.status).toBe(201);

		const body = await res.json() as { id: string; name: string; color: string; boardId: string };
		expect(body.name).toBe("My Project");
		expect(body.color).toBe("#6366f1");
		expect(body.boardId).toBe(board.id);
		expect(typeof body.id).toBe("string");
	});

	it("returns 422 when name is empty", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", `/api/boards/${board.id}/projects`, {
			body: { name: "", color: "#ffffff" },
		});
		expect(res.status).toBe(422);
	});

	it("returns 422 when color is not a valid hex", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", `/api/boards/${board.id}/projects`, {
			body: { name: "Test", color: "not-a-color" },
		});
		expect(res.status).toBe(422);
	});

	it("returns 201 with 3-character hex color", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", `/api/boards/${board.id}/projects`, {
			body: { name: "Short Hex", color: "#fff" },
		});
		expect(res.status).toBe(201);
	});

	it("returns 201 when any team member creates a project", async () => {
		const admin = await seedUser();
		const member = await seedUser();
		const { board } = await seedTeamWithBoard({
			domain: "test.com",
			members: [
				{ userId: admin.id, role: "admin" },
				{ userId: member.id, role: "member" },
			],
		});
		setCurrentUser({ id: member.id, email: member.email });

		const res = await apiRequest("POST", `/api/boards/${board.id}/projects`, {
			body: { name: "Member Project", color: "#ff0000" },
		});
		expect(res.status).toBe(201);
	});

	it("returns 201 when team admin creates a project", async () => {
		const admin = await seedUser();
		const { board } = await seedTeamWithBoard({
			domain: "admin-test.com",
			members: [{ userId: admin.id, role: "admin" }],
		});
		setCurrentUser({ id: admin.id, email: admin.email });

		const res = await apiRequest("POST", `/api/boards/${board.id}/projects`, {
			body: { name: "Admin Project", color: "#00ff00" },
		});
		expect(res.status).toBe(201);
	});
});

// ── PATCH /api/boards/:boardId/projects/:projectId ────────────────────────────

describe("PATCH /api/boards/:boardId/projects/:projectId", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest("PATCH", "/api/boards/fakeid/projects/fakeprojid", {
			body: { name: "Updated" },
		});
		expect(res.status).toBe(401);
	});

	it("returns 200 and updates the project name", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const createRes = await apiRequest("POST", `/api/boards/${board.id}/projects`, {
			body: { name: "Original", color: "#aabbcc" },
		});
		const { id: projectId } = await createRes.json() as { id: string };

		const res = await apiRequest("PATCH", `/api/boards/${board.id}/projects/${projectId}`, {
			body: { name: "Updated Name" },
		});
		expect(res.status).toBe(200);
		const body = await res.json() as { id: string; name: string; color: string };
		expect(body.name).toBe("Updated Name");
		expect(body.color).toBe("#aabbcc");
		expect(body.id).toBe(projectId);
	});

	it("returns 200 and updates the project color", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const createRes = await apiRequest("POST", `/api/boards/${board.id}/projects`, {
			body: { name: "Color Test", color: "#000000" },
		});
		const { id: projectId } = await createRes.json() as { id: string };

		const res = await apiRequest("PATCH", `/api/boards/${board.id}/projects/${projectId}`, {
			body: { color: "#ff5500" },
		});
		expect(res.status).toBe(200);
		const body = await res.json() as { name: string; color: string };
		expect(body.name).toBe("Color Test");
		expect(body.color).toBe("#ff5500");
	});

	it("returns 404 when project does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("PATCH", `/api/boards/${board.id}/projects/nonexistent`, {
			body: { name: "Ghost" },
		});
		expect(res.status).toBe(404);
	});

	it("returns 422 when color is invalid", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const createRes = await apiRequest("POST", `/api/boards/${board.id}/projects`, {
			body: { name: "Validate Color", color: "#ffffff" },
		});
		const { id: projectId } = await createRes.json() as { id: string };

		const res = await apiRequest("PATCH", `/api/boards/${board.id}/projects/${projectId}`, {
			body: { color: "bad-color" },
		});
		expect(res.status).toBe(422);
	});

	it("returns 200 when any team member updates a project", async () => {
		const admin = await seedUser();
		const member = await seedUser();
		const { board } = await seedTeamWithBoard({
			domain: "patch-test.com",
			members: [
				{ userId: admin.id, role: "admin" },
				{ userId: member.id, role: "member" },
			],
		});

		// One member creates the project
		setCurrentUser({ id: admin.id, email: admin.email });
		const createRes = await apiRequest("POST", `/api/boards/${board.id}/projects`, {
			body: { name: "Initial Name", color: "#112233" },
		});
		const { id: projectId } = await createRes.json() as { id: string };

		// Another member updates it
		setCurrentUser({ id: member.id, email: member.email });
		const res = await apiRequest("PATCH", `/api/boards/${board.id}/projects/${projectId}`, {
			body: { name: "Member Update" },
		});
		expect(res.status).toBe(200);
	});
});

// ── DELETE /api/boards/:boardId/projects/:projectId ───────────────────────────

describe("DELETE /api/boards/:boardId/projects/:projectId", () => {
	it("returns 401 when no session", async () => {
		const res = await apiRequest("DELETE", "/api/boards/fakeid/projects/fakeprojid");
		expect(res.status).toBe(401);
	});

	it("returns 204 when project is deleted successfully", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const createRes = await apiRequest("POST", `/api/boards/${board.id}/projects`, {
			body: { name: "To Delete", color: "#ff0000" },
		});
		const { id: projectId } = await createRes.json() as { id: string };

		const res = await apiRequest("DELETE", `/api/boards/${board.id}/projects/${projectId}`);
		expect(res.status).toBe(204);
	});

	it("returns 404 when project does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("DELETE", `/api/boards/${board.id}/projects/nonexistent`);
		expect(res.status).toBe(404);
	});

	it("returns 204 when any team member deletes a project", async () => {
		const admin = await seedUser();
		const member = await seedUser();
		const { board } = await seedTeamWithBoard({
			domain: "delete-test.com",
			members: [
				{ userId: admin.id, role: "admin" },
				{ userId: member.id, role: "member" },
			],
		});

		setCurrentUser({ id: admin.id, email: admin.email });
		const createRes = await apiRequest("POST", `/api/boards/${board.id}/projects`, {
			body: { name: "Deletable", color: "#445566" },
		});
		const { id: projectId } = await createRes.json() as { id: string };

		setCurrentUser({ id: member.id, email: member.email });
		const res = await apiRequest("DELETE", `/api/boards/${board.id}/projects/${projectId}`);
		expect(res.status).toBe(204);
	});

	it("returns 204 when team admin deletes a project", async () => {
		const admin = await seedUser();
		const { board } = await seedTeamWithBoard({
			domain: "admin-delete.com",
			members: [{ userId: admin.id, role: "admin" }],
		});
		setCurrentUser({ id: admin.id, email: admin.email });

		const createRes = await apiRequest("POST", `/api/boards/${board.id}/projects`, {
			body: { name: "Admin Delete", color: "#778899" },
		});
		const { id: projectId } = await createRes.json() as { id: string };

		const res = await apiRequest("DELETE", `/api/boards/${board.id}/projects/${projectId}`);
		expect(res.status).toBe(204);
	});
});
