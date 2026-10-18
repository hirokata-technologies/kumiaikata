import { beforeEach, describe, expect, it } from "vitest";
import type { GuildCaller, GuildToolDef } from "../../src/guild/registry.js";
import { qualityTools } from "../../src/guild/tools/quality.js";
import { seedUser } from "../helpers/seed.js";
import { addRequirement, addTask, all, seedGuildBoard, type GuildBoard, type Keyed } from "../helpers/guild.js";

const tools = new Map<string, GuildToolDef>(qualityTools.map((t) => [t.name, t]));

async function call(caller: GuildCaller, name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
	const tool = tools.get(name);
	if (!tool) throw new Error(`no tool ${name}`);
	return tool.handler({ caller }, tool.input.parse(input));
}

function parses(name: string, input: Record<string, unknown>): boolean {
	return tools.get(name)!.input.safeParse(input).success;
}

let board: GuildBoard;
let caller: GuildCaller;
let ws: string;
let req: Keyed;
let task: Keyed;
let fixTask: Keyed;

const events = (verb: string) =>
	all<{ actor: string; subject_type: string; subject_id: string; payload: Record<string, unknown>; user_id: string | null }>(
		`SELECT actor, subject_type, subject_id, payload, user_id FROM kumiai_event WHERE workspace_id = $1 AND verb = $2 ORDER BY id`,
		[ws, verb],
	);

beforeEach(async () => {
	board = await seedGuildBoard();
	ws = board.workspaceId;
	const user = await seedUser();
	caller = { userId: user.id, teamId: board.teamId };
	req = await addRequirement(board);
	task = await addTask(board, req.id);
	fixTask = await addTask(board, req.id, { title: "Fix" });
});

describe("add_finding / update_finding", () => {
	it("files a finding with the actor as reviewer and a found event on the task", async () => {
		const f = await call(caller, "add_finding", {
			workspace: ws,
			actor: "reviewer-security",
			task: task.key,
			severity: "major",
			summary: "Unsigned token accepted",
			file: "src/lib/auth.ts",
			line: 42,
		});
		expect(f).toMatchObject({
			task_id: task.key,
			reviewer: "reviewer-security",
			severity: "major",
			disposition: "open",
			detail: "",
			file: "src/lib/auth.ts",
			line: 42,
			fix_task_id: null,
			fix_ref: "",
		});
		expect(typeof f["id"]).toBe("number");
		expect(f["created_at"]).toMatch(/Z$/);
		const found = await events("found");
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ actor: "reviewer-security", subject_type: "task", subject_id: task.key });
		expect(found[0]!.payload["finding_id"]).toBe(f["id"]);
	});

	it("is NOT_FOUND for an unknown task and VALIDATION for a bad severity", async () => {
		await expect(
			call(caller, "add_finding", { workspace: ws, actor: "r", task: "TASK-404", severity: "major", summary: "x" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(parses("add_finding", { workspace: ws, actor: "r", task: task.key, severity: "huge", summary: "x" })).toBe(false);
	});

	it("patches disposition and the fix, guarded by expect_status", async () => {
		const f = await call(caller, "add_finding", { workspace: ws, actor: "r", task: task.key, severity: "minor", summary: "x" });
		const id = f["id"];
		const fixing = await call(caller, "update_finding", {
			workspace: ws,
			actor: "orchestrator",
			id,
			expect_status: "open",
			disposition: "fixing",
			fix_task: fixTask.key,
		});
		expect(fixing).toMatchObject({ disposition: "fixing", fix_task_id: fixTask.key, summary: "x" });
		await expect(
			call(caller, "update_finding", { workspace: ws, actor: "orchestrator", id, expect_status: "open", disposition: "waived" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		const fixed = await call(caller, "update_finding", {
			workspace: ws,
			actor: "orchestrator",
			id,
			expect_status: ["fixing", "open"],
			disposition: "fixed",
			fix_task: null,
			fix_ref: "9f2c1ab",
		});
		expect(fixed).toMatchObject({ disposition: "fixed", fix_task_id: null, fix_ref: "9f2c1ab" });
		const moves = await events("dispositioned");
		expect(moves.map((e) => [e.actor, e.payload["from"], e.payload["to"]])).toEqual([
			["orchestrator", "open", "fixing"],
			["orchestrator", "fixing", "fixed"],
		]);
	});

	it("is NOT_FOUND for an unknown finding or fix task", async () => {
		await expect(call(caller, "update_finding", { workspace: ws, actor: "o", id: 999 })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		const f = await call(caller, "add_finding", { workspace: ws, actor: "r", task: task.key, severity: "nit", summary: "x" });
		await expect(
			call(caller, "update_finding", { workspace: ws, actor: "o", id: f["id"], fix_task: "TASK-404" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("file_bug / update_bug", () => {
	it("allocates BUG-NNN with guild defaults", async () => {
		const bug = await call(caller, "file_bug", { workspace: ws, actor: "qa-tester", title: "Quantity 0 accepted" });
		expect(bug).toMatchObject({
			id: "BUG-001",
			key: "BUG-001",
			status: "open",
			severity: "major",
			found_by: "qa-tester",
			requirement_id: null,
			body: "",
			repro: "",
		});
		const second = await call(caller, "file_bug", {
			workspace: ws,
			actor: "orchestrator",
			title: "Second",
			severity: "critical",
			requirement: req.key,
			found_by: "user",
			repro: "1. click\n2. boom; really",
		});
		expect(second).toMatchObject({ id: "BUG-002", requirement_id: req.key, found_by: "user", repro: "1. click\n2. boom; really" });
		expect((await events("created")).filter((e) => e.subject_type === "bug").map((e) => e.actor)).toEqual(["qa-tester", "user"]);
	});

	it("refuses a nit and an unknown requirement", async () => {
		expect(parses("file_bug", { workspace: ws, actor: "q", title: "t", severity: "nit" })).toBe(false);
		await expect(
			call(caller, "file_bug", { workspace: ws, actor: "q", title: "t", requirement: "REQ-404" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(await all(`SELECT 1 FROM kumiai_bug`)).toHaveLength(0);
	});

	it("patches a bug, guarded by expect_status", async () => {
		await call(caller, "file_bug", { workspace: ws, actor: "q", title: "t", body: "keep me" });
		const fixing = await call(caller, "update_bug", {
			workspace: ws,
			actor: "orchestrator",
			key: "BUG-001",
			expect_status: "open",
			status: "fixing",
			fix_task: fixTask.key,
		});
		expect(fixing).toMatchObject({ status: "fixing", fix_task_id: fixTask.key, body: "keep me", title: "t" });
		await expect(
			call(caller, "update_bug", { workspace: ws, actor: "orchestrator", key: "BUG-001", expect_status: "open", status: "fixed" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		const fixed = await call(caller, "update_bug", {
			workspace: ws,
			actor: "orchestrator",
			key: "BUG-001",
			status: "fixed",
			fix_ref: "abc123",
			severity: "minor",
		});
		expect(fixed).toMatchObject({ status: "fixed", fix_ref: "abc123", severity: "minor" });
		expect((await events("moved")).filter((e) => e.subject_type === "bug")).toHaveLength(2);
		await expect(call(caller, "update_bug", { workspace: ws, actor: "o", key: "BUG-404" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("upsert_coverage", () => {
	it("creates with area, then patches; null clears a nullable field", async () => {
		await expect(call(caller, "upsert_coverage", { workspace: ws, actor: "qa", id: "checkout" })).rejects.toMatchObject({
			code: "VALIDATION",
		});
		const created = await call(caller, "upsert_coverage", {
			workspace: ws,
			actor: "qa-strategist",
			id: "checkout",
			area: "Checkout flow",
			risk: "high",
			spec_path: "e2e/checkout.spec.ts",
			notes: "Money moves here",
		});
		expect(created).toMatchObject({
			id: "checkout",
			area: "Checkout flow",
			risk: "high",
			spec_path: "e2e/checkout.spec.ts",
			last_inspected_at: null,
		});
		expect(created).not.toHaveProperty("key");
		const stamped = await call(caller, "upsert_coverage", {
			workspace: ws,
			actor: "qa-tester",
			id: "checkout",
			last_inspected_at: "2026-10-18T09:42:00Z",
		});
		expect(stamped).toMatchObject({ risk: "high", notes: "Money moves here", last_inspected_at: "2026-10-18T09:42:00Z" });
		const cleared = await call(caller, "upsert_coverage", { workspace: ws, actor: "qa", id: "checkout", spec_path: null });
		expect(cleared).toMatchObject({ spec_path: null, last_inspected_at: "2026-10-18T09:42:00Z" });
		expect((await events("created")).filter((e) => e.subject_type === "coverage")).toHaveLength(1);
		expect(await events("inspected")).toHaveLength(1);
		expect(parses("upsert_coverage", { workspace: ws, actor: "qa", id: "c", last_inspected_at: "soon" })).toBe(false);
		expect(parses("upsert_coverage", { workspace: ws, actor: "qa", id: "c", risk: "extreme" })).toBe(false);
	});
});

describe("inspections", () => {
	beforeEach(async () => {
		for (const id of ["auth", "checkout"]) {
			await call(caller, "upsert_coverage", { workspace: ws, actor: "qa", id, area: id });
		}
	});

	it("creates an inspection with its seeded areas", async () => {
		const insp = await call(caller, "create_inspection", {
			workspace: ws,
			actor: "qa-strategist",
			scope: "whole product",
			coverage: ["checkout", "auth", "checkout"],
		});
		expect(insp).toMatchObject({
			id: "INSP-001",
			key: "INSP-001",
			scope: "whole product",
			trigger: "manual",
			status: "todo",
			started_at: null,
			coverage: [
				{ coverage_id: "auth", verdict: null },
				{ coverage_id: "checkout", verdict: null },
			],
		});
	});

	it("is atomic: an unknown area writes nothing", async () => {
		await expect(
			call(caller, "create_inspection", { workspace: ws, actor: "qa", scope: "s", coverage: ["auth", "nope"] }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(await all(`SELECT 1 FROM kumiai_inspection`)).toHaveLength(0);
		expect((await call(caller, "create_inspection", { workspace: ws, actor: "qa", scope: "s" }))["id"]).toBe("INSP-001");
	});

	it("moves an inspection under a guard and records verdicts", async () => {
		await call(caller, "create_inspection", { workspace: ws, actor: "qa", scope: "s", coverage: ["auth"] });
		const started = await call(caller, "update_inspection", {
			workspace: ws,
			actor: "orchestrator",
			key: "INSP-001",
			expect_status: "todo",
			status: "in-progress",
			started_at: "2026-10-18T09:00:00Z",
		});
		expect(started).toMatchObject({ status: "in-progress", started_at: "2026-10-18T09:00:00Z" });
		await expect(
			call(caller, "update_inspection", { workspace: ws, actor: "o", key: "INSP-001", expect_status: "todo", status: "done" }),
		).rejects.toMatchObject({ code: "CONFLICT" });

		expect(
			await call(caller, "set_inspection_verdict", {
				workspace: ws,
				actor: "qa-tester",
				inspection: "INSP-001",
				coverage: "auth",
				verdict: "issues",
			}),
		).toEqual({ inspection_id: "INSP-001", coverage_id: "auth", verdict: "issues" });
		// an area that was not seeded is added
		await call(caller, "set_inspection_verdict", {
			workspace: ws,
			actor: "qa-tester",
			inspection: "INSP-001",
			coverage: "checkout",
			verdict: "not-reached",
		});
		const done = await call(caller, "update_inspection", {
			workspace: ws,
			actor: "orchestrator",
			key: "INSP-001",
			status: "done",
			finished_at: "2026-10-18T10:00:00Z",
		});
		expect(done["coverage"]).toEqual([
			{ coverage_id: "auth", verdict: "issues" },
			{ coverage_id: "checkout", verdict: "not-reached" },
		]);
		expect((await events("moved")).filter((e) => e.subject_type === "inspection")).toHaveLength(2);

		await expect(
			call(caller, "set_inspection_verdict", { workspace: ws, actor: "q", inspection: "INSP-404", coverage: "auth", verdict: "pass" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			call(caller, "set_inspection_verdict", { workspace: ws, actor: "q", inspection: "INSP-001", coverage: "nope", verdict: "pass" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(
			parses("set_inspection_verdict", { workspace: ws, actor: "q", inspection: "INSP-001", coverage: "auth", verdict: "ok" }),
		).toBe(false);
	});
});

describe("workspace scope", () => {
	it("every write is FORBIDDEN in another team's workspace", async () => {
		const stranger = (await seedGuildBoard()).workspaceId;
		const writes: [string, Record<string, unknown>][] = [
			["add_finding", { task: "TASK-001", severity: "major", summary: "x" }],
			["update_finding", { id: 1 }],
			["file_bug", { title: "t" }],
			["update_bug", { key: "BUG-001" }],
			["upsert_coverage", { id: "c", area: "a" }],
			["create_inspection", { scope: "s" }],
			["update_inspection", { key: "INSP-001" }],
			["set_inspection_verdict", { inspection: "INSP-001", coverage: "c", verdict: "pass" }],
		];
		for (const [name, input] of writes) {
			await expect(call(caller, name, { workspace: stranger, actor: "orchestrator", ...input })).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
		}
	});

	it("keys of a sibling workspace are NOT_FOUND", async () => {
		const other = await seedGuildBoard({ teamId: board.teamId, workspaceName: "second" });
		const otherTask = await addTask(other, (await addRequirement(other)).id);
		await expect(
			call(caller, "add_finding", { workspace: ws, actor: "r", task: "TASK-404", severity: "major", summary: "x" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		const f = await call(caller, "add_finding", {
			workspace: other.workspaceId,
			actor: "r",
			task: otherTask.key,
			severity: "major",
			summary: "x",
		});
		await expect(call(caller, "update_finding", { workspace: ws, actor: "o", id: f["id"] })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});
