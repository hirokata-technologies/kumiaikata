import { describe, it, expect, beforeEach } from "vitest";
import { truncateAll, seedUser } from "../helpers/index.js";
import { seedGuildBoard, all, one, type GuildBoard } from "../helpers/guild.js";
import { directionTools } from "../../src/guild/tools/direction.js";
import type { GuildCaller } from "../../src/guild/registry.js";

beforeEach(() => truncateAll());

interface Ctx {
	board: GuildBoard;
	caller: GuildCaller;
}

async function setup(): Promise<Ctx> {
	const user = await seedUser();
	const board = await seedGuildBoard();
	return { board, caller: { userId: user.id, teamId: board.teamId } };
}

/** Parse like a transport does, then run the handler. */
async function call(ctx: Ctx, name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
	const tool = directionTools.find((t) => t.name === name);
	if (!tool) throw new Error(`no tool ${name}`);
	const parsed = tool.input.parse({ workspace: ctx.board.workspaceId, actor: "orchestrator", ...input });
	return (await tool.handler({ caller: ctx.caller }, parsed)) as Record<string, unknown>;
}

function events(ws: string, subject: string) {
	return all<{ verb: string; actor: string; user_id: string | null; payload: Record<string, unknown> }>(
		`SELECT verb, actor, user_id, payload FROM kumiai_event WHERE workspace_id = $1 AND subject_id = $2 ORDER BY id`,
		[ws, subject],
	);
}

describe("create_goal / update_goal", () => {
	it("creates a goal with a server key and guild defaults, attributed to the actor", async () => {
		const ctx = await setup();
		const goal = await call(ctx, "create_goal", { title: "Onboarding", actor: "strategist" });
		// the seeded board already has GOAL-001
		expect(goal).toMatchObject({ id: "GOAL-002", key: "GOAL-002", status: "todo", priority: 3, body: "" });
		expect(goal["created_at"]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);
		expect(goal).not.toHaveProperty("workspace_id");
		const ev = await events(ctx.board.workspaceId, "GOAL-002");
		expect(ev).toEqual([
			expect.objectContaining({ verb: "created", actor: "strategist", user_id: ctx.caller.userId }),
		]);
	});

	it("patches a goal: omitted fields keep their value", async () => {
		const ctx = await setup();
		await call(ctx, "create_goal", { title: "T", body: "keep me", priority: 2 });
		const goal = await call(ctx, "update_goal", { key: "GOAL-002", status: "in-progress", expect_status: "todo" });
		expect(goal).toMatchObject({ title: "T", body: "keep me", priority: 2, status: "in-progress" });
		const ev = await events(ctx.board.workspaceId, "GOAL-002");
		expect(ev.at(-1)).toMatchObject({ verb: "moved", actor: "orchestrator", payload: { from: "todo", to: "in-progress" } });
	});

	it("CONFLICT on an expect_status mismatch, with nothing written", async () => {
		const ctx = await setup();
		await call(ctx, "create_goal", { title: "T" });
		await expect(
			call(ctx, "update_goal", { key: "GOAL-002", status: "done", title: "changed", expect_status: ["in-progress"] }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		const row = await one<{ status: string; title: string }>(`SELECT status, title FROM kumiai_goals WHERE key = 'GOAL-002'`);
		expect(row).toEqual({ status: "todo", title: "T" });
	});

	it("NOT_FOUND for a missing key, FORBIDDEN for another team's workspace", async () => {
		const ctx = await setup();
		await expect(call(ctx, "update_goal", { key: "GOAL-999", title: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
		const other = await seedGuildBoard();
		await expect(
			call({ ...ctx, board: other }, "create_goal", { title: "Intruder" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("rejects an out-of-vocabulary status at the input", async () => {
		const ctx = await setup();
		await expect(call(ctx, "create_goal", { title: "T", status: "blocked" })).rejects.toThrow();
	});
});

describe("create_project / update_project", () => {
	it("creates with the guild defaults: next ordinal, impact 50, effort 5, priority mapped", async () => {
		const ctx = await setup();
		const first = await call(ctx, "create_project", { goal: "GOAL-001", title: "A", priority: 2 });
		const second = await call(ctx, "create_project", { goal: "GOAL-001", title: "B", priority: 5 });
		expect(first).toMatchObject({
			id: "PROJ-001",
			key: "PROJ-001",
			goal_id: "GOAL-001",
			ordinal: 1,
			priority: 2,
			status: "todo",
			concurrent: 0,
			isolation: "shared",
			worktree_path: null,
		});
		// 5 is stored as `low` and reads back as 4
		expect(second).toMatchObject({ ordinal: 2, priority: 4 });
		const raw = await one<{ impact: number; effort: number; priority: string }>(
			`SELECT impact, effort, priority FROM kumiai_projects WHERE key = 'PROJ-001'`,
		);
		expect(raw).toEqual({ impact: 50, effort: 5, priority: "high" });
		const unordered = await call(ctx, "create_project", { goal: "GOAL-001", title: "C", ordinal: null });
		expect(unordered["ordinal"]).toBeNull();
	});

	it("NOT_FOUND for a goal that is not in the workspace", async () => {
		const ctx = await setup();
		await expect(call(ctx, "create_project", { goal: "GOAL-404", title: "A" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("patches isolation and worktree_path together; a path on a shared project is VALIDATION", async () => {
		const ctx = await setup();
		await call(ctx, "create_project", { goal: "GOAL-001", title: "A" });
		await expect(
			call(ctx, "update_project", { key: "PROJ-001", worktree_path: ".worktrees/PROJ-001" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		const p = await call(ctx, "update_project", {
			key: "PROJ-001",
			isolation: "worktree",
			worktree_path: ".worktrees/PROJ-001",
			concurrent: true,
			ordinal: null,
		});
		expect(p).toMatchObject({ isolation: "worktree", worktree_path: ".worktrees/PROJ-001", concurrent: 1, ordinal: null, title: "A" });
		const ev = await events(ctx.board.workspaceId, "PROJ-001");
		expect(ev.map((e) => e.verb)).toEqual(["created", "isolated"]);
	});

	it("guards on the guild-read status: Kumiai `backlog` reads as `todo`", async () => {
		const ctx = await setup();
		await call(ctx, "create_project", { goal: "GOAL-001", title: "A" });
		await one(`UPDATE kumiai_projects SET status = 'backlog' WHERE key = 'PROJ-001' RETURNING id`);
		const p = await call(ctx, "update_project", { key: "PROJ-001", status: "in-progress", expect_status: "todo" });
		expect(p["status"]).toBe("in-progress");
		await expect(
			call(ctx, "update_project", { key: "PROJ-001", status: "done", expect_status: "todo" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});
});
