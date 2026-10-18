import { describe, it, expect, beforeEach } from "vitest";
import { truncateAll, seedUser } from "../helpers/index.js";
import { seedGuildBoard, addProject, all, one, type GuildBoard } from "../helpers/guild.js";
import { workTools } from "../../src/guild/tools/work.js";
import type { GuildCaller } from "../../src/guild/registry.js";

beforeEach(() => truncateAll());

interface Ctx {
	board: GuildBoard;
	caller: GuildCaller;
}

type Row = Record<string, unknown>;

async function setup(): Promise<Ctx> {
	const user = await seedUser();
	const board = await seedGuildBoard();
	return { board, caller: { userId: user.id, teamId: board.teamId } };
}

/** Parse like a transport does, then run the handler. */
async function call(ctx: Ctx, name: string, input: Row): Promise<Row> {
	const tool = workTools.find((t) => t.name === name);
	if (!tool) throw new Error(`no tool ${name}`);
	const parsed = tool.input.parse({ workspace: ctx.board.workspaceId, actor: "orchestrator", ...input });
	return (await tool.handler({ caller: ctx.caller }, parsed)) as Row;
}

function events(ws: string, subject: string) {
	return all<{ verb: string; actor: string; user_id: string | null; payload: Row }>(
		`SELECT verb, actor, user_id, payload FROM kumiai_event WHERE workspace_id = $1 AND subject_id = $2 ORDER BY id`,
		[ws, subject],
	);
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
	return (await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, params)).n;
}

/** A requirement plus `n` tasks, keys REQ-001 and TASK-001…. */
async function withTasks(ctx: Ctx, n: number, extra: Row = {}): Promise<void> {
	await call(ctx, "create_requirement", { title: "R" });
	for (let i = 0; i < n; i++) await call(ctx, "create_task", { requirement: "REQ-001", title: `T${i + 1}`, ...extra });
}

describe("requirements", () => {
	it("creates unaffiliated or under a project, and attaches/detaches with a patch", async () => {
		const ctx = await setup();
		await addProject(ctx.board);
		const free = await call(ctx, "create_requirement", { title: "Free", body: "# md; with | pipes" });
		expect(free).toMatchObject({ id: "REQ-001", key: "REQ-001", project_id: null, status: "todo", priority: 3, body: "# md; with | pipes" });
		const owned = await call(ctx, "create_requirement", { title: "Owned", project: "PROJ-001", priority: 1 });
		expect(owned).toMatchObject({ project_id: "PROJ-001", priority: 1 });

		expect(await call(ctx, "update_requirement", { key: "REQ-001", project: "PROJ-001" })).toMatchObject({ project_id: "PROJ-001", title: "Free" });
		expect(await call(ctx, "update_requirement", { key: "REQ-001", project: null })).toMatchObject({ project_id: null });
		await expect(call(ctx, "create_requirement", { title: "x", project: "PROJ-404" })).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("guards the status move", async () => {
		const ctx = await setup();
		await call(ctx, "create_requirement", { title: "R" });
		const r = await call(ctx, "update_requirement", { key: "REQ-001", status: "done", expect_status: ["todo", "in-progress"] });
		expect(r["status"]).toBe("done");
		await expect(call(ctx, "update_requirement", { key: "REQ-001", status: "todo", expect_status: "todo" })).rejects.toMatchObject({ code: "CONFLICT" });
		expect((await events(ctx.board.workspaceId, "REQ-001")).map((e) => e.verb)).toEqual(["created", "moved"]);
	});

	it("FORBIDDEN in another team's workspace", async () => {
		const ctx = await setup();
		const other = await seedGuildBoard();
		await expect(call({ ...ctx, board: other }, "create_requirement", { title: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

describe("plans", () => {
	it("creates pending, moves status and approval separately, and stamps a ruling", async () => {
		const ctx = await setup();
		await withTasks(ctx, 1);
		const plan = await call(ctx, "create_plan", { requirement: "REQ-001", title: "P", task: "TASK-001", actor: "strategist" });
		expect(plan).toMatchObject({ id: "PLAN-001", requirement_id: "REQ-001", task_id: "TASK-001", status: "todo", approval: "pending", approved_at: null });

		const done = await call(ctx, "update_plan", { key: "PLAN-001", status: "done", expect_status: "todo" });
		expect(done).toMatchObject({ status: "done", approval: "pending" });

		const approved = await call(ctx, "update_plan", { key: "PLAN-001", approval: "approved", approved_by: "user" });
		expect(approved).toMatchObject({ approval: "approved", approved_by: "user" });
		expect(typeof approved["approved_at"]).toBe("string");

		const ev = await events(ctx.board.workspaceId, "PLAN-001");
		expect(ev.map((e) => [e.verb, e.actor])).toEqual([
			["created", "strategist"],
			["moved", "orchestrator"],
			["decided", "user"],
		]);
		await expect(call(ctx, "update_plan", { key: "PLAN-001", status: "todo", expect_status: "in-progress" })).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("NOT_FOUND for a missing requirement or gate node", async () => {
		const ctx = await setup();
		await call(ctx, "create_requirement", { title: "R" });
		await expect(call(ctx, "create_plan", { requirement: "REQ-404", title: "P" })).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(call(ctx, "create_plan", { requirement: "REQ-001", title: "P", gate_node_id: "REQ-001/gate-plan" })).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("create_task / update_task", () => {
	it("creates a task with capabilities and dependencies in one call", async () => {
		const ctx = await setup();
		await withTasks(ctx, 1);
		await call(ctx, "create_plan", { requirement: "REQ-001", title: "P" });
		const task = await call(ctx, "create_task", {
			actor: "strategist",
			requirement: "REQ-001",
			plan: "PLAN-001",
			title: "Auth service",
			objective: "## Objective",
			files: ["src/lib/auth.ts"],
			parallel_group: "wave-1",
			node_key: "implement",
			priority: 2,
			capabilities: [
				{ capability: "implement", required: true },
				{ capability: "svelte", required: false },
				{ capability: "frontend" },
			],
			depends_on: ["TASK-001"],
		});
		expect(task).toMatchObject({
			id: "TASK-002",
			key: "TASK-002",
			requirement_id: "REQ-001",
			plan_id: "PLAN-001",
			files: ["src/lib/auth.ts"],
			parallel_group: "wave-1",
			node_key: "implement",
			priority: 2,
			agent: null,
			status: "todo",
			capabilities: [
				{ capability: "frontend", required: true },
				{ capability: "implement", required: true },
				{ capability: "svelte", required: false },
			],
			depends_on: ["TASK-001"],
		});
		expect((await events(ctx.board.workspaceId, "TASK-002"))[0]).toMatchObject({ verb: "created", actor: "strategist" });
	});

	it("is atomic: a bad dependency or capability writes nothing", async () => {
		const ctx = await setup();
		await withTasks(ctx, 0);
		await expect(call(ctx, "create_task", { requirement: "REQ-001", title: "x", depends_on: ["TASK-404"] })).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			call(ctx, "create_task", { requirement: "REQ-001", title: "x", capabilities: [{ capability: "Not Valid" }] }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(
			call(ctx, "create_task", { requirement: "REQ-001", title: "x", capabilities: [{ capability: "a" }, { capability: "a" }] }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		expect(await count(`kumiai_tasks`)).toBe(0);
		expect(await count(`kumiai_event WHERE subject_type = 'task'`)).toBe(0);
		// the rolled-back allocation gave its number back
		expect((await call(ctx, "create_task", { requirement: "REQ-001", title: "ok" }))["id"]).toBe("TASK-001");
	});

	it("patches content: omitted keeps, null clears", async () => {
		const ctx = await setup();
		await withTasks(ctx, 1, { agent: "developer", parallel_group: "g", body: "keep" });
		const t = await call(ctx, "update_task", { key: "TASK-001", title: "Retitled", agent: null, files: ["a.ts"] });
		expect(t).toMatchObject({ title: "Retitled", agent: null, parallel_group: "g", body: "keep", files: ["a.ts"] });
		await expect(call(ctx, "update_task", { key: "TASK-404", title: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("set_task_status", () => {
	it("in-progress claims for claimed_by while the move is attributed to the actor", async () => {
		const ctx = await setup();
		await withTasks(ctx, 1);
		const t = await call(ctx, "set_task_status", {
			key: "TASK-001",
			status: "in-progress",
			expect_status: "todo",
			claimed_by: "developer-svelte",
		});
		expect(t).toMatchObject({ status: "in-progress", claimed_by: "developer-svelte" });
		expect(typeof t["claimed_at"]).toBe("string");
		const ev = (await events(ctx.board.workspaceId, "TASK-001")).slice(1);
		expect(ev).toEqual([
			expect.objectContaining({ verb: "moved", actor: "orchestrator", user_id: ctx.caller.userId, payload: expect.objectContaining({ from: "todo", to: "in-progress", agent: "developer-svelte" }) }),
			expect.objectContaining({ verb: "claimed", actor: "orchestrator", payload: expect.objectContaining({ agent: "developer-svelte" }) }),
		]);
		expect(await count(`kumiai_work_log`)).toBe(0);
	});

	it("defaults the claimant to the actor and keeps an existing claim", async () => {
		const ctx = await setup();
		await withTasks(ctx, 1);
		const t = await call(ctx, "set_task_status", { key: "TASK-001", status: "in-progress", actor: "developer" });
		expect(t["claimed_by"]).toBe("developer");
		await call(ctx, "set_task_status", { key: "TASK-001", status: "blocked" });
		const again = await call(ctx, "set_task_status", { key: "TASK-001", status: "in-progress" });
		expect(again["claimed_by"]).toBe("developer");
	});

	it("claimed_by null clears the claim; reason is written to work_log by the actor", async () => {
		const ctx = await setup();
		await withTasks(ctx, 1);
		await call(ctx, "set_task_status", { key: "TASK-001", status: "in-progress", claimed_by: "developer" });
		const t = await call(ctx, "set_task_status", {
			key: "TASK-001",
			status: "todo",
			claimed_by: null,
			reason: "Retrying after a crash",
		});
		expect(t).toMatchObject({ status: "todo", claimed_by: null, claimed_at: null });
		const log = await all<{ agent: string; entry: string }>(`SELECT agent, entry FROM kumiai_work_log`);
		expect(log).toEqual([{ agent: "orchestrator", entry: "Retrying after a crash" }]);
	});

	it("CONFLICT when the current status is not expected; nothing is written", async () => {
		const ctx = await setup();
		await withTasks(ctx, 1);
		await expect(
			call(ctx, "set_task_status", { key: "TASK-001", status: "done", expect_status: ["in-progress", "blocked"], reason: "x" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await one<{ status: string }>(`SELECT status FROM kumiai_tasks`)).toEqual({ status: "todo" });
		expect(await count(`kumiai_work_log`)).toBe(0);
		expect(await count(`kumiai_event WHERE verb = 'moved'`)).toBe(0);
	});
});

describe("claim_task", () => {
	it("with no key claims v_next_task's row for the claimant, attributed to the actor", async () => {
		const ctx = await setup();
		await withTasks(ctx, 2);
		const { task } = (await call(ctx, "claim_task", { claimant: "developer" })) as { task: Row };
		expect(task).toMatchObject({ id: "TASK-001", status: "in-progress", claimed_by: "developer" });
		const ev = (await events(ctx.board.workspaceId, "TASK-001")).slice(1);
		expect(ev.map((e) => [e.verb, e.actor])).toEqual([
			["moved", "orchestrator"],
			["claimed", "orchestrator"],
		]);
		// resume-first: the same claimant gets its in-progress task back, unchanged
		const resumed = (await call(ctx, "claim_task", { claimant: "developer" })) as { task: Row };
		expect(resumed.task).toMatchObject({ id: "TASK-001", claimed_by: "developer" });
		// somebody else's running task is not theirs, and nothing new is claimed while it runs
		expect(await call(ctx, "claim_task", { claimant: "tester" })).toEqual({ task: null });
	});

	it("returns {task: null} when nothing is claimable", async () => {
		const ctx = await setup();
		await withTasks(ctx, 1, { status: "done" });
		expect(await call(ctx, "claim_task", {})).toEqual({ task: null });
	});

	it("is concurrency-safe: two simultaneous claims never get the same task", async () => {
		const ctx = await setup();
		await withTasks(ctx, 2);
		const results = (await Promise.all([
			call(ctx, "claim_task", { claimant: "developer-a" }),
			call(ctx, "claim_task", { claimant: "developer-b" }),
		])) as { task: Row | null }[];
		const claimed = results.map((r) => r.task).filter((t): t is Row => t !== null);
		expect(claimed).toHaveLength(1);
		const rows = await all<{ key: string; claimed_by: string | null }>(
			`SELECT key, claimed_by FROM kumiai_tasks WHERE status = 'in-progress'`,
		);
		expect(rows).toEqual([{ key: "TASK-001", claimed_by: claimed[0]?.["claimed_by"] }]);
		expect(await count(`kumiai_event WHERE verb = 'claimed'`)).toBe(1);
	});

	it("is concurrency-safe on a named key too", async () => {
		const ctx = await setup();
		await withTasks(ctx, 1);
		const results = await Promise.allSettled([
			call(ctx, "claim_task", { key: "TASK-001", claimant: "a" }),
			call(ctx, "claim_task", { key: "TASK-001", claimant: "b" }),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const rejected = results.find((r) => r.status === "rejected");
		expect(rejected?.status === "rejected" && (rejected.reason as { code: string }).code).toBe("CONFLICT");
	});

	it("with a key: NOT_FOUND for a missing task, CONFLICT for a finished one", async () => {
		const ctx = await setup();
		await withTasks(ctx, 1, { status: "done" });
		await expect(call(ctx, "claim_task", { key: "TASK-404" })).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(call(ctx, "claim_task", { key: "TASK-001" })).rejects.toMatchObject({ code: "CONFLICT" });
	});
});

describe("dependencies, capabilities, work log", () => {
	it("adds (idempotently) and removes a dependency", async () => {
		const ctx = await setup();
		await withTasks(ctx, 2);
		const added = await call(ctx, "add_task_dependency", { task: "TASK-002", depends_on: "TASK-001" });
		expect(added["depends_on"]).toEqual(["TASK-001"]);
		await call(ctx, "add_task_dependency", { task: "TASK-002", depends_on: "TASK-001" });
		await expect(call(ctx, "add_task_dependency", { task: "TASK-002", depends_on: "TASK-002" })).rejects.toMatchObject({ code: "VALIDATION" });
		expect((await call(ctx, "remove_task_dependency", { task: "TASK-002", depends_on: "TASK-001" }))["depends_on"]).toEqual([]);
		await expect(call(ctx, "remove_task_dependency", { task: "TASK-002", depends_on: "TASK-001" })).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("set_task_capabilities replaces the set", async () => {
		const ctx = await setup();
		await withTasks(ctx, 1, { capabilities: [{ capability: "implement" }, { capability: "svelte" }] });
		const t = await call(ctx, "set_task_capabilities", {
			task: "TASK-001",
			capabilities: [{ capability: "test-authoring", required: false }],
		});
		expect(t["capabilities"]).toEqual([{ capability: "test-authoring", required: false }]);
		await expect(
			call(ctx, "set_task_capabilities", { task: "TASK-001", capabilities: [{ capability: "9bad" }] }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		// the failed replace left the previous set intact
		expect(await count(`kumiai_task_capability`)).toBe(1);
	});

	it("log_work appends a line whose agent is the actor and emits `logged`", async () => {
		const ctx = await setup();
		await withTasks(ctx, 1);
		const line = await call(ctx, "log_work", { task: "TASK-001", actor: "test-writer", entry: "Suite cannot reach the DB" });
		expect(line).toMatchObject({ task_id: "TASK-001", agent: "test-writer", entry: "Suite cannot reach the DB" });
		expect(typeof line["id"]).toBe("number");
		const ev = await events(ctx.board.workspaceId, "TASK-001");
		expect(ev.at(-1)).toMatchObject({ verb: "logged", actor: "test-writer", user_id: ctx.caller.userId });
		await expect(call(ctx, "log_work", { task: "TASK-404", entry: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
