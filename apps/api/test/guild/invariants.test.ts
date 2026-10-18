import { beforeEach, describe, expect, it } from "vitest";
import type { GuildCaller, GuildToolDef } from "../../src/guild/registry.js";
import { invariantsTools } from "../../src/guild/tools/invariants.js";
import { libraryTools } from "../../src/guild/tools/library.js";
import { qualityTools } from "../../src/guild/tools/quality.js";
import { INVARIANT_PROCESSES, decisionFindingIds } from "../../src/guild/services/invariants.js";
import { newId } from "../../src/db/ids.js";
import { seedUser } from "../helpers/seed.js";
import { pool } from "../helpers/db.js";
import {
	addCapability,
	addEdge,
	addGate,
	addNode,
	addRequirement,
	addTask,
	one,
	seedGuildBoard,
	type GuildBoard,
	type Keyed,
} from "../helpers/guild.js";

const tools = new Map<string, GuildToolDef>([...invariantsTools, ...libraryTools, ...qualityTools].map((t) => [t.name, t]));

async function call(caller: GuildCaller, name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
	const tool = tools.get(name);
	if (!tool) throw new Error(`no tool ${name}`);
	return tool.handler({ caller }, tool.input.parse(input));
}

interface Report {
	ok: boolean;
	failures: { id: string; description: string; rows: string[][]; advisory?: true }[];
	checked: string[];
	skipped: { id: string; reason: string }[];
}

let board: GuildBoard;
let caller: GuildCaller;
let ws: string;

const check = (input: Record<string, unknown> = {}) =>
	call(caller, "check_invariants", { workspace: ws, ...input }) as Promise<Report>;
const failure = (r: Report, id: string) => r.failures.find((f) => f.id === id);

/**
 * A requirement exactly as guild:new-requirement leaves it: one plan, one implement ticket
 * with a capability and a file, the standard graph (N + 10 = 11 nodes, 2N + 11 = 13 edges, two
 * gates), its template recorded, nothing moved.
 */
async function seedPlanned(b: GuildBoard): Promise<{ req: Keyed; task: Keyed; nodes: Record<string, Keyed> }> {
	const req = await addRequirement(b, { title: "Session auth" });
	const plan = await one<Keyed>(
		`INSERT INTO kumiai_plans (id, team_id, requirement_id, title, status, approval, created_at, updated_at)
		 VALUES ($1, $2, $3, 'Plan', 'todo', 'pending', now(), now()) RETURNING id, key`,
		[newId(), b.teamId, req.id],
	);
	const task = await addTask(b, req.id, { title: "Auth service" });
	await pool.query(`UPDATE kumiai_tasks SET plan_id = $1, node_key = 'implement', files = '["src/auth.ts"]' WHERE id = $2`, [
		plan.id,
		task.id,
	]);
	await addCapability(task.id, "implement");
	const nodes: Record<string, Keyed> = {};
	nodes["gate-plan"] = await addNode(req, "gate-plan", { kind: "gate" });
	nodes["implement"] = await addNode(req, "implement", { suffix: task.key, taskId: task.id });
	for (const k of ["test-plan", "test-write"]) nodes[k] = await addNode(req, k);
	for (const r of ["security", "architecture", "business-logic", "edge-case"]) {
		nodes[`review.${r}`] = await addNode(req, "review", { suffix: `reviewer-${r}` });
	}
	await pool.query(`UPDATE kumiai_graph_node SET parallel_group = 'review' WHERE node_key = 'review'`);
	nodes["gate-repairs"] = await addNode(req, "gate-repairs", { kind: "gate" });
	for (const k of ["repair", "document"]) nodes[k] = await addNode(req, k);
	const n = nodes as Record<string, Keyed>;
	await addEdge(n["gate-plan"]!, n["implement"]!);
	await addEdge(n["implement"]!, n["test-plan"]!);
	await addEdge(n["test-plan"]!, n["test-write"]!);
	for (const r of ["security", "architecture", "business-logic", "edge-case"]) {
		await addEdge(n["test-write"]!, n[`review.${r}`]!);
		await addEdge(n[`review.${r}`]!, n["gate-repairs"]!);
	}
	await addEdge(n["gate-repairs"]!, n["repair"]!);
	await addEdge(n["repair"]!, n["document"]!);
	await addGate(n["gate-plan"]!, "Approve the plan?");
	await addGate(n["gate-repairs"]!, "Which repairs?");
	await pool.query(`UPDATE kumiai_gate SET kind = 'select-findings' WHERE node_id = $1`, [n["gate-repairs"]!.id]);
	await pool.query(`INSERT INTO kumiai_guild_state (workspace_id, team_id, key, value) VALUES ($1, $2, $3, 'standard')`, [
		b.workspaceId,
		b.teamId,
		`graph-template:${req.key}`,
	]);
	return { req, task, nodes };
}

beforeEach(async () => {
	board = await seedGuildBoard();
	ws = board.workspaceId;
	caller = { userId: (await seedUser()).id, teamId: board.teamId };
});

describe("check_invariants on a clean board", () => {
	it("passes the globals on an empty board and lists what stays local", async () => {
		const r = await check();
		expect(r).toMatchObject({ ok: true, failures: [] });
		expect(r.checked).toEqual(["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11"]);
		expect(r.skipped.map((s) => s.id)).toEqual(["G5.roster", "G9.serial"]);
	});

	it("passes every process on a freshly planned requirement", async () => {
		const { req } = await seedPlanned(board);
		for (const process of INVARIANT_PROCESSES) {
			const input = process === "new-requirement" ? { process, requirement: req.key } : { process };
			const r = await check(input);
			expect({ process, failures: r.failures }).toEqual({ process, failures: [] });
			expect(r.ok).toBe(true);
		}
		const nr = await check({ process: "new-requirement", requirement: req.key });
		expect(nr.checked).toEqual(expect.arrayContaining(["4.a", "4.b", "4.c", "4.d", "4.e", "4.f"]));
		expect((await check({ process: "dashboard" })).skipped.map((s) => s.id)).toContain("6");
		expect((await check({ process: "shift" })).skipped.map((s) => s.id)).toEqual(
			expect.arrayContaining(["11.f", "11.G-8"]),
		);
		expect((await check({ process: "release" })).skipped.map((s) => s.id)).toContain("9.a");
	});
});

describe("check_invariants catches seeded violations", () => {
	it("G5 + §4.a: a ticket that names no member and declares nothing", async () => {
		const { req } = await seedPlanned(board);
		const orphan = await addTask(board, req.id, { title: "Nobody" });
		await pool.query(`UPDATE kumiai_tasks SET plan_id = (SELECT plan_id FROM kumiai_tasks WHERE key = 'TASK-001') WHERE id = $1`, [
			orphan.id,
		]);
		const r = await check({ process: "new-requirement", requirement: req.key });
		expect(r.ok).toBe(false);
		expect(failure(r, "G5")).toEqual({
			id: "G5",
			description: "ticket routing",
			rows: [["no-pin-no-capabilities", orphan.key, "todo"]],
		});
		expect(failure(r, "4.a")!.rows).toEqual([["ticket-without-capability-or-pin", orphan.key, ""]]);
	});

	it("G4 + §4.a + §4.b: work moved before gate-plan", async () => {
		const { req, task, nodes } = await seedPlanned(board);
		await pool.query(`UPDATE kumiai_tasks SET status = 'in-progress', claimed_by = 'developer', claimed_at = now() WHERE id = $1`, [
			task.id,
		]);
		await pool.query(`UPDATE kumiai_graph_node SET status = 'running' WHERE id = $1`, [nodes["implement"]!.id]);
		const r = await check({ process: "new-requirement", requirement: req.key });
		expect(failure(r, "G4")!.rows).toEqual([
			["built-before-gate-plan", task.key, "pending"],
			["past-unresolved-gate", nodes["implement"]!.key, nodes["gate-plan"]!.key],
		]);
		expect(failure(r, "4.a")!.rows.map((x) => x[0])).toEqual(["node-already-moved", "task-already-moved", "ticket-already-claimed"]);
		const cr = await check({ process: "check-in" });
		expect(failure(cr, "7.C")!.rows).toEqual([["claimed-before-gate-plan", task.key, "pending"]]);
	});

	it("§4.c: a dropped node breaks the arithmetic; G8 names the dropped key", async () => {
		const { req, nodes } = await seedPlanned(board);
		await pool.query(`DELETE FROM kumiai_graph_node WHERE id = $1`, [nodes["document"]!.id]);
		const r = await check({ process: "new-requirement", requirement: req.key });
		expect(failure(r, "4.c")!.rows).toEqual([
			["edge-count-not-2n-plus-11", req.key, "12 edges, expected 13"],
			["node-count-not-n-plus-10", req.key, "10 nodes, expected 11"],
		]);
		expect(failure(r, "G8")!.rows).toEqual([["dropped-required-node", req.key, "document"]]);
	});

	it("G6 + G7: a finding fixing without a task; a row inserted at its end state", async () => {
		const { task } = await seedPlanned(board);
		const f = await call(caller, "add_finding", { workspace: ws, actor: "reviewer", task: task.key, severity: "major", summary: "s" });
		await pool.query(`UPDATE kumiai_review_finding SET disposition = 'fixing' WHERE id = $1`, [f["id"]]);
		const r = await check();
		expect(failure(r, "G6")!.rows).toEqual([["finding-fixing-without-task", String(f["id"]), "fixing"]]);
		await pool.query(`DELETE FROM kumiai_event WHERE verb = 'created' AND subject_type = 'task'`);
		expect(failure(await check(), "G7")!.rows).toEqual([["no-created-event", "task", task.key]]);
	});

	it("G11: a deleted row and an edge cut out of the work", async () => {
		await call(caller, "file_bug", { workspace: ws, actor: "qa", title: "t" });
		const req = await addRequirement(board);
		await call(caller, "upsert_doc", { workspace: ws, actor: "l", slug: "adr", title: "t", body: "b" });
		const edge = { workspace: ws, actor: "l", rel: "describes", from: { type: "doc", id: "adr" }, to: { type: "requirement", id: req.key } };
		await call(caller, "link", edge);
		await call(caller, "unlink", edge);
		await pool.query(`DELETE FROM kumiai_bug WHERE key = 'BUG-001'`);
		const rows = failure(await check(), "G11")!.rows;
		expect(rows.map((x) => [x[0], x[1]])).toEqual([
			["edge-unlinked", `doc:adr -> requirement:${req.key}`],
			["row-deleted", "bug:BUG-001"],
		]);
		expect(rows[0]![2]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ by l$/);
	});

	it("G10: a dangling knowledge edge", async () => {
		await call(caller, "upsert_doc", { workspace: ws, actor: "l", slug: "adr", title: "t", body: "b" });
		await call(caller, "file_bug", { workspace: ws, actor: "qa", title: "t" });
		await call(caller, "link", { workspace: ws, actor: "l", rel: "describes", from: { type: "doc", id: "adr" }, to: { type: "bug", id: "BUG-001" } });
		await pool.query(`DELETE FROM kumiai_bug`);
		expect(failure(await check(), "G10")!.rows.map((x) => x[0])).toEqual(["knowledge_edge.to"]);
	});

	it("§4.f: a select-findings decision is parsed the SQLite way", async () => {
		const { req, task, nodes } = await seedPlanned(board);
		const f1 = await call(caller, "add_finding", { workspace: ws, actor: "r", task: task.key, severity: "major", summary: "a" });
		const f2 = await call(caller, "add_finding", { workspace: ws, actor: "r", task: task.key, severity: "minor", summary: "b" });
		await pool.query(`UPDATE kumiai_gate SET status = 'approved', decided_at = now(), decision = $1 WHERE node_id = $2`, [
			`[${String(f1["id"])}]`,
			nodes["gate-repairs"]!.id,
		]);
		const r = await check({ process: "new-requirement", requirement: req.key });
		expect(failure(r, "4.f")!.rows).toEqual([
			["approved-finding-without-fix-task", String(f1["id"]), "open"],
			["unselected-finding-not-dispositioned", String(f2["id"]), "open"],
		]);
		// prose is inert
		await pool.query(`UPDATE kumiai_gate SET decision = 'Repair 1 and 2' WHERE node_id = $1`, [nodes["gate-repairs"]!.id]);
		expect(failure(await check({ process: "new-requirement", requirement: req.key }), "4.f")).toBeUndefined();
	});

	it("§7 C.b: a status moved by an agent rather than the orchestrator", async () => {
		const req = await addRequirement(board);
		const task = await addTask(board, req.id, { agent: "developer" });
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(`SELECT set_config('kumiai.actor', 'developer', true)`);
			await client.query(`UPDATE kumiai_tasks SET status = 'blocked' WHERE id = $1`, [task.id]);
			await client.query("COMMIT");
		} finally {
			client.release();
		}
		const r = await check({ process: "check-in" });
		expect(failure(r, "7.C")!.rows).toEqual([["status-moved-by-non-orchestrator", `task:${task.key}`, "developer"]]);
		expect(failure(r, "G5")!.rows).toEqual([["blocked-with-a-pin", task.key, "developer"]]);
	});

	it("§7 C.b is unscoped: a member moving a plan, a bug or a doc is a breach; the orchestrator is not", async () => {
		const req = await addRequirement(board);
		const plan = async () =>
			one<Keyed>(
				`INSERT INTO kumiai_plans (id, team_id, requirement_id, title, status, approval, created_at, updated_at)
				 VALUES ($1, $2, $3, 'Plan', 'todo', 'pending', now(), now()) RETURNING id, key`,
				[newId(), board.teamId, req.id],
			);
		const movePlan = async (planId: string, actor: string) => {
			const client = await pool.connect();
			try {
				await client.query("BEGIN");
				await client.query(`SELECT set_config('kumiai.actor', $1, true)`, [actor]);
				await client.query(`UPDATE kumiai_plans SET status = 'done' WHERE id = $1`, [planId]);
				await client.query("COMMIT");
			} finally {
				client.release();
			}
		};
		const moves = async (by: { plan: string; bug: string; doc: string }, tag: string) => {
			const p = await plan();
			const bug = await call(caller, "file_bug", { workspace: ws, actor: "qa-tester", title: `Broken ${tag}` });
			await call(caller, "upsert_doc", { workspace: ws, actor: "librarian", slug: `old-${tag}`, title: "Old", body: "x" });
			await call(caller, "upsert_doc", { workspace: ws, actor: "librarian", slug: `new-${tag}`, title: "New", body: "y" });
			await movePlan(p.id, by.plan);
			await call(caller, "update_bug", { workspace: ws, actor: by.bug, key: bug["key"], status: "fixed", fix_ref: "abc" });
			await call(caller, "supersede_doc", { workspace: ws, actor: by.doc, old_slug: `old-${tag}`, new: { slug: `new-${tag}` } });
			return { plan: p.key, bug: String(bug["key"]) };
		};

		// the same three moves, made by the orchestrator: clean
		await moves({ plan: "orchestrator", bug: "orchestrator", doc: "orchestrator" }, "a");
		expect(failure(await check({ process: "check-in" }), "7.C")).toBeUndefined();

		// made by the members that did the work: three breaches
		const m = await moves({ plan: "strategist", bug: "qa-tester", doc: "librarian" }, "b");
		const rows = failure(await check({ process: "check-in" }), "7.C")!.rows;
		expect(rows.filter((r) => r[0] === "status-moved-by-non-orchestrator")).toEqual(
			expect.arrayContaining([
				["status-moved-by-non-orchestrator", `plan:${m.plan}`, "strategist"],
				["status-moved-by-non-orchestrator", `bug:${m.bug}`, "qa-tester"],
				["status-moved-by-non-orchestrator", "doc:old-b", "librarian"],
			]),
		);
		expect(rows.filter((r) => r[0] === "status-moved-by-non-orchestrator")).toHaveLength(3);
	});

	it("§9.b/§9.c: a malformed release record, and the advisory clause does not fail the run", async () => {
		const req = await addRequirement(board);
		await addTask(board, req.id, { agent: "developer" });
		const state = (key: string, value: string) =>
			pool.query(`INSERT INTO kumiai_guild_state (workspace_id, team_id, key, value) VALUES ($1, $2, $3, $4)`, [
				ws,
				board.teamId,
				key,
				value,
			]);
		await state("release:v1.0.0", JSON.stringify({ released: "2026-10-18", requirements: [req.key] }));
		let r = await check({ process: "release" });
		expect(failure(r, "9.b")!.rows).toEqual([["released-requirement-not-done", req.key, "todo"]]);
		expect(failure(r, "9.c")).toMatchObject({ advisory: true, rows: [["released-over-open-task", req.key, "open=1 blocked=0 failed=0"]] });
		await state("release:v1.1.0", "shipped it");
		await state("release:v1.2.0", JSON.stringify({ requirements: [req.key] }));
		r = await check({ process: "release" });
		expect(failure(r, "9.b")!.rows).toEqual([
			["release-missing-field", "release:v1.2.0", "released"],
			["release-value-not-json", "release:v1.1.0", "shipped it"],
			["released-requirement-not-done", req.key, "todo"],
			["released-requirement-not-done", req.key, "todo"],
			["requirement-released-twice", req.key, "2"],
		]);

		// only the advisory fires on a done requirement with an open ticket
		await pool.query(`DELETE FROM kumiai_guild_state WHERE key IN ('release:v1.1.0', 'release:v1.2.0')`);
		await pool.query(`UPDATE kumiai_requirements SET status = 'done' WHERE id = $1`, [req.id]);
		r = await check({ process: "release" });
		expect(failure(r, "9.b")).toBeUndefined();
		expect(failure(r, "9.c")).toBeDefined();
		expect(r.failures.filter((f) => !f.id.startsWith("9."))).toEqual([
			expect.objectContaining({ id: "G6" }), // requirement-done-over-open-task, as the guild reports it
		]);
	});

	it("§10.c: two testers at once", async () => {
		const qa = await addRequirement(board);
		const t1 = await addTask(board, qa.id, { agent: "qa-tester" });
		const t2 = await addTask(board, qa.id, { agent: "qa-tester" });
		await pool.query(
			`UPDATE kumiai_tasks SET node_key = 'qa-execute', status = 'in-progress', claimed_by = 'qa-tester', claimed_at = now() WHERE id IN ($1, $2)`,
			[t1.id, t2.id],
		);
		const r = await check({ process: "qa" });
		expect(failure(r, "10.c")!.rows).toEqual([
			["two-mission-tickets-in-flight", t1.key, qa.key],
			["two-mission-tickets-in-flight", t2.key, qa.key],
		]);
		expect(failure(r, "G9")!.rows).toEqual([["agent-double-booked", "qa-tester", "2 in-flight"]]);
	});

	it("§11.a/§11.e: a gate decided during an open shift, and a shift that ended badly", async () => {
		const { nodes } = await seedPlanned(board);
		await call(caller, "record_event", {
			workspace: ws,
			actor: "orchestrator",
			verb: "started",
			subject_type: "shift",
			subject_id: "SHIFT-1",
			payload: { max_tasks: 2, max_minutes: 60 },
		});
		await pool.query(`UPDATE kumiai_gate SET status = 'approved', decided_at = (now() AT TIME ZONE 'UTC') WHERE node_id = $1`, [
			nodes["gate-plan"]!.id,
		]);
		await pool.query(`UPDATE kumiai_graph_node SET status = 'done' WHERE id = $1`, [nodes["gate-plan"]!.id]);
		let r = await check({ process: "shift" });
		expect(failure(r, "11.a")!.rows.map((x) => [x[0], x[1]])).toEqual([
			["gate-approved-with-no-shift-boundary", nodes["gate-plan"]!.key],
			["gate-decided-during-shift", nodes["gate-plan"]!.key],
		]);
		await call(caller, "record_event", {
			workspace: ws,
			actor: "orchestrator",
			verb: "ended",
			subject_type: "shift",
			subject_id: "SHIFT-1",
			payload: { reason: "ran out of stuff", tasks: 44 },
		});
		r = await check({ process: "shift" });
		expect(failure(r, "11.e")!.rows).toEqual([
			["over-budget", "SHIFT-1", "tasks=44"],
			["stop-reason-outside-the-vocabulary", "SHIFT-1", "ran out of stuff"],
		]);
	});
});

describe("check_invariants input rules", () => {
	it("needs a requirement for new-requirement, resolves it in the workspace", async () => {
		await expect(check({ process: "new-requirement" })).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(check({ process: "new-requirement", requirement: "REQ-404" })).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(tools.get("check_invariants")!.input.safeParse({ workspace: ws, process: "deploy" }).success).toBe(false);
	});

	it("is FORBIDDEN for another team's workspace", async () => {
		const stranger = await seedGuildBoard();
		await expect(call(caller, "check_invariants", { workspace: stranger.workspaceId })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it("only reads the caller's workspace", async () => {
		const sibling = await seedGuildBoard({ teamId: board.teamId, workspaceName: "second" });
		await addTask(sibling, (await addRequirement(sibling)).id); // no pin, no capabilities: a G5 breach over there
		expect((await check()).ok).toBe(true);
		expect((await call(caller, "check_invariants", { workspace: sibling.workspaceId }) as unknown as Report).ok).toBe(false);
	});
});

describe("decisionFindingIds", () => {
	it("reads a decision like json_each + CAST(… AS INTEGER)", () => {
		expect(decisionFindingIds("[1,4,7]")).toEqual([1, 4, 7]);
		expect(decisionFindingIds('[2.9, "3", "5abc", "BUG-004", true, null]')).toEqual([2, 3, 5, 0, 1]);
		expect(decisionFindingIds("7")).toEqual([7]);
		expect(decisionFindingIds("Repair 1, 2 and BUG-004")).toBeNull();
		expect(decisionFindingIds("")).toBeNull();
		expect(decisionFindingIds(null)).toBeNull();
	});
});
