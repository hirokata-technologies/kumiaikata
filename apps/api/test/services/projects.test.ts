import { describe, it, expect } from "vitest";
import { pool, seedUser, seedPersonalBoard } from "../helpers/index.js";
import { createProject, updateProject, deleteProject, listProjects } from "../../src/services/projects.js";
import { newId } from "../../src/db/ids.js";

// ── listProjects ──────────────────────────────────────────────────────────────

describe("listProjects", () => {
	it("returns an empty array when no projects exist for the board", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		const result = await listProjects(board.id);

		expect(result).toEqual([]);
	});

	it("returns projects sorted by name ascending", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		await createProject(board.id, { name: "Zebra", color: "#ff0000" });
		await createProject(board.id, { name: "Alpha", color: "#00ff00" });
		await createProject(board.id, { name: "Middle", color: "#0000ff" });

		const result = await listProjects(board.id);

		expect(result).toHaveLength(3);
		expect(result[0]!.name).toBe("Alpha");
		expect(result[1]!.name).toBe("Middle");
		expect(result[2]!.name).toBe("Zebra");
	});

	it("returns projects only for the given board", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const otherUser = await seedUser();
		const otherBoard = await seedPersonalBoard(otherUser.id);

		await createProject(board.id, { name: "Mine", color: "#111111" });
		await createProject(otherBoard.id, { name: "Other", color: "#222222" });

		const result = await listProjects(board.id);

		expect(result).toHaveLength(1);
		expect(result[0]!.name).toBe("Mine");
	});
});

// ── createProject ─────────────────────────────────────────────────────────────

describe("createProject", () => {
	it("creates a project and returns the detail", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		const project = await createProject(board.id, { name: "Feature A", color: "#e11d48" });

		expect(project.name).toBe("Feature A");
		expect(project.color).toBe("#e11d48");
		expect(project.boardId).toBe(board.id);
		expect(typeof project.id).toBe("string");
		expect(project.id.length).toBeGreaterThan(0);
	});

	it("persists the project in the database", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		const project = await createProject(board.id, { name: "Persisted", color: "#aabbcc" });

		const { rows } = await pool.query<{ id: string; name: string; color: string; board_id: string }>(
			"SELECT id, name, color, board_id FROM projects WHERE id = $1",
			[project.id],
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]!.name).toBe("Persisted");
		expect(rows[0]!.color).toBe("#aabbcc");
		expect(rows[0]!.board_id).toBe(board.id);
	});

	it("creates multiple projects on the same board", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		const p1 = await createProject(board.id, { name: "P1", color: "#111111" });
		const p2 = await createProject(board.id, { name: "P2", color: "#222222" });

		expect(p1.id).not.toBe(p2.id);

		const { rows } = await pool.query(
			"SELECT id FROM projects WHERE board_id = $1",
			[board.id],
		);
		expect(rows).toHaveLength(2);
	});
});

// ── updateProject ─────────────────────────────────────────────────────────────

describe("updateProject", () => {
	it("updates the project name", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const project = await createProject(board.id, { name: "Old Name", color: "#ffffff" });

		const updated = await updateProject(board.id, project.id, { name: "New Name" });

		expect(updated.name).toBe("New Name");
		expect(updated.color).toBe("#ffffff");
		expect(updated.id).toBe(project.id);
	});

	it("updates the project color", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const project = await createProject(board.id, { name: "Keep Name", color: "#000000" });

		const updated = await updateProject(board.id, project.id, { color: "#ff5500" });

		expect(updated.name).toBe("Keep Name");
		expect(updated.color).toBe("#ff5500");
	});

	it("updates both name and color at once", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const project = await createProject(board.id, { name: "Original", color: "#000000" });

		const updated = await updateProject(board.id, project.id, {
			name: "Updated",
			color: "#abcdef",
		});

		expect(updated.name).toBe("Updated");
		expect(updated.color).toBe("#abcdef");
	});

	it("persists the updated values in the database", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const project = await createProject(board.id, { name: "Before", color: "#000000" });

		await updateProject(board.id, project.id, { name: "After", color: "#123456" });

		const { rows } = await pool.query<{ name: string; color: string }>(
			"SELECT name, color FROM projects WHERE id = $1",
			[project.id],
		);
		expect(rows[0]!.name).toBe("After");
		expect(rows[0]!.color).toBe("#123456");
	});

	it("throws NOT_FOUND when project does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		await expect(
			updateProject(board.id, newId(), { name: "Ghost" }),
		).rejects.toMatchObject({ code: "NOT_FOUND", message: "Project not found." });
	});

	it("throws NOT_FOUND when project belongs to a different board", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const otherUser = await seedUser();
		const otherBoard = await seedPersonalBoard(otherUser.id);

		const project = await createProject(otherBoard.id, { name: "Other Board", color: "#ff0000" });

		await expect(
			updateProject(board.id, project.id, { name: "Hijacked" }),
		).rejects.toMatchObject({ code: "NOT_FOUND", message: "Project not found." });
	});
});

// ── deleteProject ─────────────────────────────────────────────────────────────

describe("deleteProject", () => {
	it("deletes an existing project without error", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const project = await createProject(board.id, { name: "To Delete", color: "#ff0000" });

		await expect(deleteProject(board.id, project.id)).resolves.toBeUndefined();

		const { rows } = await pool.query(
			"SELECT id FROM projects WHERE id = $1",
			[project.id],
		);
		expect(rows).toHaveLength(0);
	});

	it("throws NOT_FOUND when project does not exist", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		await expect(
			deleteProject(board.id, newId()),
		).rejects.toMatchObject({ code: "NOT_FOUND", message: "Project not found." });
	});

	it("throws NOT_FOUND when project belongs to a different board", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);
		const otherUser = await seedUser();
		const otherBoard = await seedPersonalBoard(otherUser.id);

		const project = await createProject(otherBoard.id, { name: "Other", color: "#000000" });

		await expect(
			deleteProject(board.id, project.id),
		).rejects.toMatchObject({ code: "NOT_FOUND", message: "Project not found." });
	});

	it("does not delete other projects on the same board", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id);

		const p1 = await createProject(board.id, { name: "Keep", color: "#111111" });
		const p2 = await createProject(board.id, { name: "Delete", color: "#222222" });

		await deleteProject(board.id, p2.id);

		const { rows } = await pool.query(
			"SELECT id FROM projects WHERE board_id = $1",
			[board.id],
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]!.id).toBe(p1.id);
	});
});
