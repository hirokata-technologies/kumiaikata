import { describe, it, expect, beforeEach } from "vitest";
import { setCurrentUser } from "../helpers/mock-session.js";
import { apiRequest } from "../helpers/request.js";
import { seedTeamWithBoard, seedUser } from "../helpers/seed.js";

/**
 * End to end: one guild lifecycle driven through POST /api/kumiai/guild/:tool with a session,
 * following the guild plugin's kumiai prose (skills/warehouse/references/kumiai.md and the
 * per-skill kumiai paths) literally — the same tool names, argument names and shapes, and the
 * same result fields read back. Every step reads what the prose says it reads; when a later
 * step needs a value it takes it from the earlier result exactly as the prose does.
 *
 * One `it`: setup-db truncates after every test, and the lifecycle is one board.
 */

type Row = Record<string, unknown>;
interface Page {
	rows: Row[];
	next_offset: number | null;
}

async function call<T = Row>(tool: string, body: Row = {}): Promise<T> {
	const res = await apiRequest("POST", `/api/kumiai/guild/${tool}`, { body });
	const json = (await res.json()) as unknown;
	if (res.status !== 200) throw new Error(`${tool} → ${res.status} ${JSON.stringify(json)}`);
	return json as T;
}

/** A call the guild expects to be refused: the status and the contract code. */
async function refused(tool: string, body: Row): Promise<{ status: number; code: string }> {
	const res = await apiRequest("POST", `/api/kumiai/guild/${tool}`, { body });
	const json = (await res.json()) as { code: string };
	return { status: res.status, code: json.code };
}

/** "Do not stop at the first page": call again with `offset: next_offset` until it is null. */
async function readAll(tool: "read_view" | "list", body: Row, limit = 500): Promise<{ rows: Row[]; pages: number }> {
	const rows: Row[] = [];
	let offset: number | null = 0;
	let pages = 0;
	while (offset !== null) {
		const page: Page = await call<Page>(tool, { ...body, limit, offset });
		rows.push(...page.rows);
		offset = page.next_offset;
		pages += 1;
	}
	return { rows, pages };
}

/** The current UTC time as the guild generates it: ISO-8601, whole seconds, `Z`. */
function nowIso(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Invariants {
	ok: boolean;
	failures: { id: string; description: string; rows: string[][]; advisory?: boolean }[];
	checked: string[];
	skipped: { id: string; reason: string }[];
}

beforeEach(() => {
	setCurrentUser(null);
});

describe("guild lifecycle over REST, as the guild's kumiai prose drives it", () => {
	it("runs a requirement from first check-in to release, then validates the board", async () => {
		const user = await seedUser({ email: "guild-master@test.com", name: "Guild Master" });
		await seedTeamWithBoard({ domain: "lifecycle.test.com", members: [{ userId: user.id, role: "admin" }] });
		setCurrentUser({ id: user.id, email: user.email });

		// ── check-in "First check-in" (kumiai) ────────────────────────────────────────────
		const who = await call<{ user: Row; team: Row; contract: string }>("whoami", {});
		expect(who.user["id"]).toBe(user.id);
		expect(who.contract.split(".")[0]).toBe("1"); // refuse a different major version

		const before = await call<{ workspaces: Row[] }>("list_workspaces", {});
		expect(before.workspaces[0]?.["isDefault"]).toBe(true); // the default first
		const created = await call("create_workspace", { name: "guild" });
		const ws = String(created["id"]); // the config stores the workspace id, not its name
		const listed = await call<{ workspaces: Row[] }>("list_workspaces", {});
		expect(listed.workspaces.map((w) => w["id"])).toContain(ws);

		// kumiai.md §3 "What moved since the last check-in"
		const lastCheckin = await call<{ rows: { key: string; value: string }[] }>("get_state", {
			workspace: ws,
			key: "last-checkin",
		});
		expect(lastCheckin.rows).toEqual([{ key: "last-checkin", value: "null" }]); // "null" = never
		// never checked in: leave the `where` out
		await call<Page>("read_view", {
			workspace: ws,
			view: "v_recent_activity",
			order_by: [{ col: "ts", dir: "desc" }],
			limit: 50,
		});
		const startedAt = nowIso();

		// ── new-requirement: the project-manager writes the requirement ──────────────────
		const req = await call("create_requirement", {
			workspace: ws,
			actor: "project-manager",
			title: "Session-backed authentication",
			body: "# Session-backed authentication\n\n## Summary\nLog in; `fail()` on a bad token; 100% of 5 | 6.\n```ts\nconst a = 1;\n```",
			priority: 1,
		});
		expect(req).toMatchObject({ key: "REQ-001", status: "todo", project_id: null });
		const REQ = String(req["key"]);

		// placement: create_goal then create_project, then attach (new-requirement, kumiai.md §1)
		const goal = await call("create_goal", {
			workspace: ws,
			actor: "orchestrator",
			title: "Self-serve onboarding",
			priority: 2,
		});
		expect(goal["key"]).toBe("GOAL-001");
		const project = await call("create_project", {
			workspace: ws,
			actor: "orchestrator",
			goal: "GOAL-001",
			title: "Account creation",
			priority: 3,
			concurrent: false,
			isolation: "shared",
		});
		expect(project).toMatchObject({ key: "PROJ-001", ordinal: 1 });
		await call("update_project", { workspace: ws, actor: "orchestrator", key: "PROJ-001", concurrent: true });
		const isolated = await call("update_project", {
			workspace: ws,
			actor: "orchestrator",
			key: "PROJ-001",
			isolation: "worktree",
			worktree_path: ".worktrees/PROJ-001",
		});
		expect(isolated).toMatchObject({ concurrent: 1, isolation: "worktree", worktree_path: ".worktrees/PROJ-001" });
		const attached = await call("update_requirement", { workspace: ws, actor: "orchestrator", key: REQ, project: "PROJ-001" });
		expect(attached["project_id"]).toBe("PROJ-001");
		const runnable = await call<Page>("read_view", { workspace: ws, view: "v_projects_runnable", where: { goal_id: "GOAL-001" } });
		expect(runnable.rows.map((r) => r["id"])).toEqual(["PROJ-001"]);

		// ── new-requirement: the strategist plans, tickets, and builds the graph ─────────
		// orphan check (strategist.md): expect none
		expect((await call<Page>("list", { workspace: ws, type: "plan", where: { requirement_id: REQ } })).rows).toEqual([]);
		const preflight = await call<Page>("list", {
			workspace: ws,
			type: "graph_node",
			where: { requirement_id: REQ },
			limit: 1,
		});
		expect(preflight.rows).toEqual([]);
		const body = await call("get", { workspace: ws, type: "requirement", key: REQ });
		expect(String(body["body"])).toContain("100% of 5 | 6"); // free text survives untouched

		const plan = await call("create_plan", {
			workspace: ws,
			actor: "strategist",
			requirement: REQ,
			title: "Session-backed authentication — implementation plan",
			body: "# … Implementation Plan\n…",
		});
		expect(plan).toMatchObject({ key: "PLAN-001", status: "todo", approval: "pending" });
		const PLAN = String(plan["key"]);

		await call("upsert_doc", {
			workspace: ws,
			actor: "strategist",
			slug: "adr-session-store",
			title: "Sessions live in Redis",
			body: "## Context\nWe need sessions.",
			kind: "decision",
			area: "auth",
			source: "strategist",
		});
		await call("link", {
			workspace: ws,
			actor: "strategist",
			rel: "decides",
			from: { type: "doc", id: "adr-session-store" },
			to: { type: "requirement", id: REQ },
			note: `Chosen at gate-plan for ${REQ}`,
		});

		// each ticket is ONE create_task (kumiai.md §1 Task)
		const auth = await call("create_task", {
			workspace: ws,
			actor: "strategist",
			requirement: REQ,
			plan: PLAN,
			title: "Auth service",
			objective: "## Objective\n…",
			body: "",
			files: ["src/lib/auth.ts", "src/routes/login/+page.server.ts"],
			parallel_group: "wave-1",
			node_key: "implement",
			priority: 2,
			capabilities: [
				{ capability: "implement", required: true },
				{ capability: "frontend", required: true },
				{ capability: "svelte", required: false },
				{ capability: "sveltekit", required: false },
			],
			depends_on: [],
		});
		expect(auth).toMatchObject({ key: "TASK-001", agent: null, depends_on: [] });
		expect(auth["capabilities"]).toContainEqual({ capability: "svelte", required: false });
		const ticket = async (fields: Row): Promise<string> =>
			String((await call("create_task", { workspace: ws, actor: "strategist", requirement: REQ, plan: PLAN, ...fields }))["key"]);
		const login = await ticket({
			title: "Login page",
			objective: "## Objective\n…",
			files: ["src/routes/login/+page.svelte"],
			parallel_group: "wave-1",
			node_key: "implement",
			capabilities: [
				{ capability: "implement", required: true },
				{ capability: "svelte", required: true },
			],
		});
		const testPlan = await ticket({
			title: "Test plan",
			node_key: "test-plan",
			capabilities: [{ capability: "test-planning", required: true }],
		});
		const reviewers = ["reviewer-security", "reviewer-architecture", "reviewer-business-logic", "reviewer-edge-case"];
		const reviewTask: Record<string, string> = {};
		for (const reviewer of reviewers) {
			reviewTask[reviewer] = await ticket({
				title: `Review — ${reviewer}`,
				node_key: "review",
				parallel_group: "review",
				agent: reviewer,
				capabilities: [{ capability: "review", required: true }],
			});
		}
		const docTask = await ticket({
			title: "Document the requirement",
			node_key: "document",
			capabilities: [{ capability: "document", required: true }],
		});
		const AUTH = String(auth["key"]);

		// the graph is ONE instantiate_graph (kumiai.md §4), standard with two implement tickets
		const graph = await call<{ nodes: Row[]; edges: Row[]; gates: Row[]; deviations: Row[] }>("instantiate_graph", {
			workspace: ws,
			actor: "strategist",
			requirement: REQ,
			nodes: [
				{
					node_key: "gate-plan",
					kind: "gate",
					gate: { kind: "approve", prompt: `Plan for ${REQ} is ready for review. Approve implementation?` },
				},
				{ node_key: "implement", suffix: AUTH, kind: "work", task: AUTH, parallel_group: "wave-1" },
				{ node_key: "implement", suffix: login, kind: "work", task: login, parallel_group: "wave-1" },
				{ node_key: "test-plan", kind: "work" },
				{ node_key: "test-write", kind: "work" },
				{
					node_key: "review",
					suffix: "reviewer-security",
					kind: "work",
					task: reviewTask["reviewer-security"],
					parallel_group: "review",
				},
				{ node_key: "review", suffix: "reviewer-architecture", kind: "work", parallel_group: "review" },
				{ node_key: "review", suffix: "reviewer-business-logic", kind: "work", parallel_group: "review" },
				{ node_key: "review", suffix: "reviewer-edge-case", kind: "work", parallel_group: "review" },
				{
					node_key: "gate-repairs",
					kind: "gate",
					gate: { kind: "select-findings", prompt: `Findings and bugs from ${REQ} — approve which get repaired.` },
				},
				{ node_key: "repair", kind: "work" },
				{ node_key: "document", kind: "work" },
			],
			edges: [
				{ from: "gate-plan", to: `implement.${AUTH}` },
				{ from: "gate-plan", to: `implement.${login}` },
				{ from: `implement.${AUTH}`, to: "test-plan" },
				{ from: `implement.${login}`, to: "test-plan" },
				{ from: "test-plan", to: "test-write" },
				{ from: "test-write", to: "review.reviewer-security" },
				{ from: "test-write", to: "review.reviewer-architecture" },
				{ from: "test-write", to: "review.reviewer-business-logic" },
				{ from: "test-write", to: "review.reviewer-edge-case" },
				{ from: "review.reviewer-security", to: "gate-repairs" },
				{ from: "review.reviewer-architecture", to: "gate-repairs" },
				{ from: "review.reviewer-business-logic", to: "gate-repairs" },
				{ from: "review.reviewer-edge-case", to: "gate-repairs" },
				{ from: "gate-repairs", to: "repair" },
				{ from: "repair", to: "document" },
			],
			deviations: [],
		});
		// N + 10 = 12 nodes, 2N + 11 = 15 edges, 2 gates
		expect([graph.nodes.length, graph.edges.length, graph.gates.length, graph.deviations.length]).toEqual([12, 15, 2, 0]);
		const implementNode = graph.nodes.find((n) => n["id"] === `${REQ}/implement.${AUTH}`);
		expect(implementNode).toMatchObject({ node_key: "implement", task_id: AUTH, status: "pending" });
		await call("set_state", { workspace: ws, actor: "strategist", key: `graph-template:${REQ}`, value: "standard" });

		// a ticket the strategist adds after instantiation fans out the same way (kumiai.md §4)
		const session = await ticket({
			title: "Session store",
			files: ["src/lib/session.ts"],
			parallel_group: "wave-1",
			node_key: "implement",
			capabilities: [{ capability: "implement", required: true }],
		});
		const fanned = await call("add_graph_node", {
			workspace: ws,
			actor: "strategist",
			requirement: REQ,
			node_key: "implement",
			suffix: session,
			kind: "work",
			task: session,
			parallel_group: "wave-1",
		});
		expect(fanned).toMatchObject({ id: `${REQ}/implement.${session}`, node_key: "implement", gate: null });
		await call("add_graph_edge", {
			workspace: ws,
			actor: "strategist",
			from: `${REQ}/gate-plan`,
			to: `${REQ}/implement.${session}`,
		});
		await call("add_graph_edge", {
			workspace: ws,
			actor: "strategist",
			from: `${REQ}/implement.${session}`,
			to: `${REQ}/test-plan`,
		});

		// reading the graph back (standard.md §7)
		const nodes = await call<Page>("list", {
			workspace: ws,
			type: "graph_node",
			where: { requirement_id: REQ },
			order_by: [{ col: "id", dir: "asc" }],
		});
		const edges = await call<Page>("list", { workspace: ws, type: "graph_edge", where: { requirement_id: REQ } });
		const gates = await call<Page>("list", { workspace: ws, type: "gate", where: { requirement_id: REQ } });
		const deviations = await call<Page>("list", { workspace: ws, type: "graph_deviation", where: { requirement_id: REQ } });
		expect([nodes.rows.length, edges.rows.length, gates.rows.length, deviations.rows.length]).toEqual([13, 17, 2, 0]);
		await call<Page>("read_view", { workspace: ws, view: "v_task_who", where: { task_id: AUTH } });
		// the strategist reports `plan PLAN-NNN written`; new-requirement Step 8 marks it (strategist.md §7)
		await call("update_plan", {
			workspace: ws,
			actor: "orchestrator",
			key: PLAN,
			status: "done",
			expect_status: ["todo", "in-progress"],
		});

		// new-requirement's postconditions, before the gate (§4)
		const built = await call<Invariants>("check_invariants", { workspace: ws, process: "new-requirement", requirement: REQ });
		expect(built.failures).toEqual([]);
		expect(built.ok).toBe(true);

		// ── gate-plan (new-requirement, kumiai) ─────────────────────────────────────────────
		const pendingApproval = await call<Page>("read_view", { workspace: ws, view: "v_plans_pending_approval" });
		expect(pendingApproval.rows.map((r) => r["id"])).toEqual([PLAN]);
		expect(
			(await call<Page>("read_view", { workspace: ws, view: "v_ready_nodes", where: { id: `${REQ}/gate-plan` } })).rows,
		).toHaveLength(1);
		const ownPlan = await call<Page>("list", {
			workspace: ws,
			type: "plan",
			where: { requirement_id: REQ, task_id: { op: "is_null" }, approval: "pending" },
		});
		expect(ownPlan.rows.map((r) => r["id"])).toEqual([PLAN]);
		const approved = await call<{ gate: Row; node: Row; plan: Row | null }>("resolve_gate", {
			workspace: ws,
			actor: "orchestrator",
			node: `${REQ}/gate-plan`,
			status: "approved",
			decision: "Approved as written.",
			plan: PLAN,
		});
		expect(approved.gate).toMatchObject({ node_id: `${REQ}/gate-plan`, status: "approved", decision: "Approved as written." });
		expect(approved.gate["decided_at"]).toMatch(/Z$/);
		expect(approved.node).toMatchObject({ id: `${REQ}/gate-plan`, status: "done" });
		expect(approved.plan).toMatchObject({ id: PLAN, approval: "approved", approved_by: "user", gate_node_id: `${REQ}/gate-plan` });

		// ── check-in: the loop ──────────────────────────────────────────────────────────────
		const started = await call("update_requirement", {
			workspace: ws,
			actor: "orchestrator",
			key: REQ,
			status: "in-progress",
			expect_status: "todo",
		});
		expect(started["status"]).toBe("in-progress");
		// recovery triage: nothing in flight
		expect((await call<Page>("list", { workspace: ws, type: "task", where: { status: "in-progress" } })).rows).toEqual([]);

		const readyOrder = [
			{ col: "node_key", dir: "asc" },
			{ col: "parallel_group", dir: "asc" },
			{ col: "id", dir: "asc" },
		];
		const ready = async (): Promise<Row[]> =>
			(await call<Page>("read_view", { workspace: ws, view: "v_ready_nodes", where: { requirement_id: REQ }, order_by: readyOrder }))
				.rows;
		expect((await ready()).map((n) => n["id"])).toEqual([
			`${REQ}/implement.${AUTH}`,
			`${REQ}/implement.${login}`,
			`${REQ}/implement.${session}`,
		]);
		const next = await call<Page>("read_view", { workspace: ws, view: "v_next_task" });
		expect(next.rows.map((r) => r["id"])).toEqual([AUTH]);
		const batch = await call<Page>("read_view", { workspace: ws, view: "v_batch", where: { task_id: AUTH } });
		expect(batch.rows.map((r) => r["member_id"]).sort()).toEqual([AUTH, login, session].sort());
		const routing = await call("get", { workspace: ws, type: "task", key: AUTH });
		expect(routing["agent"]).toBeNull(); // no pin: the required capabilities are `--covers`
		expect((routing["capabilities"] as Row[]).filter((c) => c["required"] === true).map((c) => c["capability"])).toEqual([
			"frontend",
			"implement",
		]);

		/** Dispatch one bound node (check-in 3.3, kumiai): the claim names the member, the move is ours. */
		const dispatch = async (node: string, task: string, member: string): Promise<void> => {
			const moved = await call("set_task_status", {
				workspace: ws,
				actor: "orchestrator",
				key: task,
				status: "in-progress",
				expect_status: "todo",
				claimed_by: member,
			});
			expect(moved).toMatchObject({ status: "in-progress", claimed_by: member });
			const running = await call("set_node_status", {
				workspace: ws,
				actor: "orchestrator",
				node,
				status: "running",
				expect_status: ["pending", "ready"],
				task,
			});
			expect(running).toMatchObject({ status: "running", task_id: task });
		};
		/** Record a finished ticket — both halves, always. */
		const finish = async (node: string, task: string, member: string): Promise<void> => {
			await call("log_work", { workspace: ws, actor: member, task, entry: `Finished ${task}` });
			await call("set_task_status", { workspace: ws, actor: "orchestrator", key: task, status: "done", expect_status: "in-progress" });
			await call("set_node_status", { workspace: ws, actor: "orchestrator", node, status: "done", expect_status: "running" });
		};

		// batch 1: the cursor claim (claim_task {key, claimant}) and the dispatch move
		const claimed = await call<{ task: Row | null }>("claim_task", {
			workspace: ws,
			actor: "orchestrator",
			key: AUTH,
			claimant: "developer",
		});
		expect(claimed.task).toMatchObject({ id: AUTH, status: "in-progress", claimed_by: "developer" });
		await call("set_node_status", {
			workspace: ws,
			actor: "orchestrator",
			node: `${REQ}/implement.${AUTH}`,
			status: "running",
			expect_status: ["pending", "ready"],
			task: AUTH,
		});
		await dispatch(`${REQ}/implement.${login}`, login, "developer-svelte");
		// the member reads its ticket and log, and writes only log_work (developer.md)
		const mine = await call("get", { workspace: ws, type: "task", key: AUTH });
		expect(mine).toMatchObject({ plan_id: PLAN, requirement_id: REQ, files: ["src/lib/auth.ts", "src/routes/login/+page.server.ts"] });
		const logged = await call("log_work", {
			workspace: ws,
			actor: "developer",
			task: AUTH,
			entry: "Implemented the session store in src/lib/session.ts",
		});
		expect(logged).toMatchObject({ task_id: AUTH, agent: "developer" });
		const log = await call<Page>("list", {
			workspace: ws,
			type: "work_log",
			where: { task_id: AUTH },
			order_by: [
				{ col: "ts", dir: "asc" },
				{ col: "id", dir: "asc" },
			],
		});
		expect(log.rows.map((r) => r["entry"])).toEqual(["Implemented the session store in src/lib/session.ts"]);
		await finish(`${REQ}/implement.${AUTH}`, AUTH, "developer");
		await finish(`${REQ}/implement.${login}`, login, "developer-svelte");
		// somebody already moved it: CONFLICT, nothing written
		expect(
			await refused("set_task_status", { workspace: ws, actor: "orchestrator", key: AUTH, status: "done", expect_status: "todo" }),
		).toEqual({ status: 409, code: "CONFLICT" });

		// batch 2
		expect((await ready()).map((n) => n["id"])).toEqual([`${REQ}/implement.${session}`]);
		await dispatch(`${REQ}/implement.${session}`, session, "developer");
		await finish(`${REQ}/implement.${session}`, session, "developer");

		// test-plan: the test-planner writes the test plan and the test-writer ticket
		expect((await ready()).map((n) => n["id"])).toEqual([`${REQ}/test-plan`]);
		await dispatch(`${REQ}/test-plan`, testPlan, "test-planner");
		const inventory = await call<Page>("list", { workspace: ws, type: "task", where: { requirement_id: REQ, node_key: "implement" } });
		expect(inventory.rows.map((r) => r["id"])).toEqual([AUTH, login, session]);
		await call<Page>("list", { workspace: ws, type: "work_log", where: { task_id: [AUTH, login, session] } });
		const testPlanDoc = await call("create_plan", {
			workspace: ws,
			actor: "test-planner",
			requirement: REQ,
			task: testPlan,
			title: "Test plan",
			body: "## Cases\n…",
		});
		expect(testPlanDoc).toMatchObject({ key: "PLAN-002", task_id: testPlan });
		const testWrite = String(
			(
				await call("create_task", {
					workspace: ws,
					actor: "test-planner",
					requirement: REQ,
					plan: "PLAN-002",
					title: "Write the auth tests",
					files: ["src/lib/auth.test.ts"],
					node_key: "test-write",
					capabilities: [{ capability: "test-authoring", required: true }],
				})
			)["key"],
		);
		await finish(`${REQ}/test-plan`, testPlan, "test-planner");

		// test-write: one anchor, its ticket underneath
		await dispatch(`${REQ}/test-write`, testWrite, "test-writer");
		await finish(`${REQ}/test-write`, testWrite, "test-writer");

		// review: four reviewers in one wave, each pinned and claimed by its own pin
		const reviewReady = await call<Page>("read_view", {
			workspace: ws,
			view: "v_ready_nodes",
			where: { kind: "work", gate_status: { op: "is_null" } },
		});
		expect(reviewReady.rows.map((n) => n["id"]).sort()).toEqual(reviewers.map((r) => `${REQ}/review.${r}`).sort());
		for (const reviewer of reviewers) await dispatch(`${REQ}/review.${reviewer}`, reviewTask[reviewer] ?? "", reviewer);
		const major = await call("add_finding", {
			workspace: ws,
			actor: "reviewer-security",
			task: AUTH,
			severity: "major",
			summary: "Unsigned callback token accepted",
			detail: "consume() trusts the token's payload before verifying …",
			file: "src/lib/auth.ts",
			line: 42,
		});
		expect(major).toMatchObject({ disposition: "open", reviewer: "reviewer-security", task_id: AUTH, line: 42 });
		expect(typeof major["id"]).toBe("number"); // a finding's id is a number, not a key
		const minor = await call("add_finding", {
			workspace: ws,
			actor: "reviewer-edge-case",
			task: login,
			severity: "minor",
			summary: "Empty password is not trimmed",
		});
		for (const reviewer of reviewers) await finish(`${REQ}/review.${reviewer}`, reviewTask[reviewer] ?? "", reviewer);

		// a bug the orchestrator saw during the run (check-in, kumiai.md §1 Bug)
		const bug = await call("file_bug", {
			workspace: ws,
			actor: "orchestrator",
			title: "Login spinner never stops on a 500",
			repro: "1. Stop the API\n2. Log in\nExpected: an error\nActual: a spinner",
			severity: "minor",
			requirement: REQ,
			found_by: "orchestrator",
		});
		expect(bug).toMatchObject({ key: "BUG-001", status: "open", found_by: "orchestrator" });

		// ── gate-repairs (check-in 3.5, kumiai) ──────────────────────────────────────────────
		expect(
			(await call<Page>("read_view", { workspace: ws, view: "v_ready_nodes", where: { id: `${REQ}/gate-repairs` } })).rows,
		).toHaveLength(1);
		const findings = await call<Page>("read_view", { workspace: ws, view: "v_open_findings", where: { requirement_id: REQ } });
		expect(findings.rows.map((f) => f["id"]).sort()).toEqual([major["id"], minor["id"]].sort());
		const failed = await call<Page>("read_view", { workspace: ws, view: "v_failed_tasks", where: { requirement_id: REQ } });
		expect(failed.rows).toEqual([]);
		expect((await call<Page>("read_view", { workspace: ws, view: "v_open_bugs" })).rows.map((b) => b["id"])).toEqual(["BUG-001"]);
		const repairsGate = await call("get", { workspace: ws, type: "gate", key: `${REQ}/gate-repairs` });
		expect(repairsGate).toMatchObject({ kind: "select-findings", status: "pending" });
		const ruled = await call<{ gate: Row; node: Row; plan: Row | null }>("resolve_gate", {
			workspace: ws,
			actor: "orchestrator",
			node: `${REQ}/gate-repairs`,
			status: "approved",
			decision: `Repair ${String(major["id"])} and BUG-001. Leave the rest.`,
		});
		expect(ruled.node["status"]).toBe("done");
		expect(ruled.plan).toBeNull(); // no plan is linked to gate-repairs

		const fixFinding = await ticket({
			title: "Fix: verify the callback token",
			files: ["src/lib/auth.ts"],
			parallel_group: "wave-1",
			node_key: "repair",
			capabilities: [{ capability: "implement", required: true }],
		});
		const fixBug = await ticket({
			title: "Fix: BUG-001",
			files: ["src/routes/login/+page.svelte"],
			node_key: "repair",
			capabilities: [{ capability: "implement", required: true }],
		});
		const fixing = await call("update_finding", {
			workspace: ws,
			actor: "orchestrator",
			id: major["id"],
			disposition: "fixing",
			fix_task: fixFinding,
		});
		expect(fixing).toMatchObject({ disposition: "fixing", fix_task_id: fixFinding });
		await call("update_finding", { workspace: ws, actor: "orchestrator", id: minor["id"], disposition: "waived", expect_status: "open" });
		const bugFixing = await call("update_bug", {
			workspace: ws,
			actor: "orchestrator",
			key: "BUG-001",
			status: "fixing",
			expect_status: "open",
			fix_task: fixBug,
		});
		expect(bugFixing).toMatchObject({ status: "fixing", fix_task_id: fixBug });

		// repair: one anchor, two tickets underneath
		await dispatch(`${REQ}/repair`, fixFinding, "developer");
		await call("log_work", { workspace: ws, actor: "developer", task: fixFinding, entry: "Verified the signature first" });
		await call("set_task_status", { workspace: ws, actor: "orchestrator", key: fixFinding, status: "done", expect_status: "in-progress" });
		await call("update_finding", { workspace: ws, actor: "orchestrator", id: major["id"], disposition: "fixed", fix_ref: "9f2c1ab" });
		await call("set_task_status", {
			workspace: ws,
			actor: "orchestrator",
			key: fixBug,
			status: "in-progress",
			expect_status: "todo",
			claimed_by: "developer-svelte",
		});
		await call("log_work", { workspace: ws, actor: "developer-svelte", task: fixBug, entry: "Spinner stops on error" });
		await call("set_task_status", { workspace: ws, actor: "orchestrator", key: fixBug, status: "done", expect_status: "in-progress" });
		await call("update_bug", {
			workspace: ws,
			actor: "orchestrator",
			key: "BUG-001",
			status: "fixed",
			expect_status: ["open", "fixing"],
			fix_ref: "a1b2c3d",
		});
		await call("set_node_status", { workspace: ws, actor: "orchestrator", node: `${REQ}/repair`, status: "done", expect_status: "running" });

		// ── document: the librarian (librarian.md, kumiai.md §1) ────────────────────────────
		await dispatch(`${REQ}/document`, docTask, "librarian");
		await call("get", { workspace: ws, type: "requirement", key: REQ });
		expect((await call<Page>("list", { workspace: ws, type: "plan", where: { requirement_id: REQ } })).rows).toHaveLength(2);
		const decided = await call<Page>("list", { workspace: ws, type: "gate", where: { requirement_id: REQ } });
		expect(decided.rows.map((g) => g["status"])).toEqual(["approved", "approved"]);
		const reqTasks = (await call<Page>("list", { workspace: ws, type: "task", where: { requirement_id: REQ } })).rows.map((t) => t["id"]);
		const filed = await call<Page>("list", { workspace: ws, type: "review_finding", where: { task_id: reqTasks } });
		expect(filed.rows.map((f) => f["disposition"]).sort()).toEqual(["fixed", "waived"]);
		await call<Page>("list", { workspace: ws, type: "graph_deviation", where: { requirement_id: REQ } });
		const already = await call<{ type: string; id: string; rows: Row[] }>("doc_neighbors", {
			workspace: ws,
			type: "requirement",
			id: REQ,
		});
		expect(already.rows.map((n) => [n["direction"], n["rel"], n["other_id"]])).toEqual([["in", "decides", "adr-session-store"]]);
		await call<Page>("read_view", { workspace: ws, view: "v_doc_current" });

		const technical = await call("upsert_doc", {
			workspace: ws,
			actor: "librarian",
			slug: "auth-session-flow",
			title: "How a session is created",
			body: "## Flow\nThe token is verified, then `fail()` on 100% of bad tokens.",
			kind: "technical",
			status: "current",
			area: "auth",
			source: "librarian",
		});
		expect(technical).toMatchObject({ slug: "auth-session-flow", kind: "technical", status: "current" });
		await call("link", {
			workspace: ws,
			actor: "librarian",
			rel: "describes",
			from: { type: "doc", id: "auth-session-flow" },
			to: { type: "requirement", id: REQ },
		});
		await call("upsert_doc", {
			workspace: ws,
			actor: "librarian",
			slug: "account-worktree",
			title: "Account creation runs in its own worktree",
			body: "PROJ-001 is isolated in .worktrees/PROJ-001.",
			kind: "runbook",
			status: "current",
			area: "ops",
			source: "librarian",
		});
		await call("link", {
			workspace: ws,
			actor: "librarian",
			rel: "describes",
			from: { type: "doc", id: "account-worktree" },
			to: { type: "project", id: "PROJ-001" },
		});
		// both ends must exist: the dangling-edge refusal
		expect(
			await refused("link", {
				workspace: ws,
				actor: "librarian",
				rel: "describes",
				from: { type: "doc", id: "auth-session-flow" },
				to: { type: "requirement", id: "REQ-999" },
			}),
		).toEqual({ status: 404, code: "NOT_FOUND" });

		// a rewrite snapshots the previous body; leave `status` out of it
		await call("upsert_doc", {
			workspace: ws,
			actor: "librarian",
			slug: "auth-session-flow",
			title: "How a session is created",
			body: "## Flow\nVerified first, always.",
		});
		const revisions = await call<Page>("list", {
			workspace: ws,
			type: "doc_revision",
			where: { slug: "auth-session-flow" },
			order_by: [{ col: "replaced_at", dir: "desc" }],
		});
		expect(revisions.rows.map((r) => r["body"])).toEqual(["## Flow\nThe token is verified, then `fail()` on 100% of bad tokens."]);

		// a changed decision: the librarian writes the new page and reports
		// `doc adr-session-store-v2 supersedes adr-session-store` (librarian.md §5)
		await call("upsert_doc", {
			workspace: ws,
			actor: "librarian",
			slug: "adr-session-store-v2",
			title: "Sessions move to Postgres",
			body: "## Context\n…",
			kind: "decision",
			area: "auth",
			source: "strategist",
		});
		await call("link", {
			workspace: ws,
			actor: "librarian",
			rel: "decides",
			from: { type: "doc", id: "adr-session-store-v2" },
			to: { type: "requirement", id: REQ },
		});
		await finish(`${REQ}/document`, docTask, "librarian");
		// check-in §3.4: the orchestrator makes the move the report names — one supersede_doc, no body
		const superseded = await call<{ new: Row; old: Row; edge: Row }>("supersede_doc", {
			workspace: ws,
			actor: "orchestrator",
			old_slug: "adr-session-store",
			new: { slug: "adr-session-store-v2" },
			note: "Redis was a second store to operate for one feature",
		});
		expect(superseded.old["status"]).toBe("superseded");
		expect(superseded.new).toMatchObject({ slug: "adr-session-store-v2", status: "current", body: "## Context\n…" });
		expect(superseded.edge).toMatchObject({ rel: "supersedes", from_id: "adr-session-store-v2", to_id: "adr-session-store" });

		// the supersession chain, one hop per call, looped and capped by the caller
		let slug: string | null = "adr-session-store";
		const chain: string[] = [];
		for (let n = 0; slug && n < 20; n++) {
			if (chain.includes(slug)) throw new Error(`cycle at ${slug}`);
			chain.push(slug);
			const rows: Page = await call<Page>("list", {
				workspace: ws,
				type: "knowledge_edge",
				where: { rel: "supersedes", to_type: "doc", to_id: slug },
				limit: 1,
			});
			slug = rows.rows[0] ? String(rows.rows[0]["from_id"]) : null;
		}
		expect(chain).toEqual(["adr-session-store", "adr-session-store-v2"]);

		const neighbours = await call<{ rows: Row[] }>("doc_neighbors", { workspace: ws, type: "doc", id: "adr-session-store" });
		expect(neighbours.rows.map((n) => [n["direction"], n["rel"], n["other_id"]])).toEqual([
			["in", "supersedes", "adr-session-store-v2"],
			["out", "decides", REQ],
		]);
		const decidesOnly = await call<{ rows: Row[] }>("doc_neighbors", { workspace: ws, type: "requirement", id: REQ, rel: "decides" });
		expect(decidesOnly.rows.map((n) => n["other_id"]).sort()).toEqual(["adr-session-store", "adr-session-store-v2"]);
		const viewNeighbours = await call<Page>("read_view", { workspace: ws, view: "v_doc_neighbors", where: { slug: "adr-session-store" } });
		expect(viewNeighbours.rows).toHaveLength(2);
		const log2 = await call<Page>("read_view", { workspace: ws, view: "v_decision_log" });
		expect(log2.rows.find((d) => d["slug"] === "adr-session-store")?.["superseded_by"]).toBe("adr-session-store-v2");
		const found = await call<Page>("search_docs", { workspace: ws, query: "fail()", limit: 20 });
		expect(found.rows.map((d) => d["slug"])).toEqual([]); // the rewrite dropped it from the body
		expect((await call<Page>("search_docs", { workspace: ws, query: "100%", kind: "business", limit: 20 })).rows).toEqual([]);
		expect(
			(await call<Page>("search_docs", { workspace: ws, query: "verified first", kind: "technical", limit: 20 })).rows.map(
				(d) => d["slug"],
			),
		).toEqual(["auth-session-flow"]);
		// the drift reads
		expect((await call<Page>("read_view", { workspace: ws, view: "v_doc_current", where: { edges: 0 } })).rows).toEqual([]);
		await call<Page>("read_view", { workspace: ws, view: "v_doc_stale" });
		await call<Page>("read_view", { workspace: ws, view: "v_undocumented_work" });

		// ── closing the requirement and the direction above it ─────────────────────────────
		const progress = await call<Page>("read_view", { workspace: ws, view: "v_requirement_progress", where: { id: REQ } });
		expect(progress.rows[0]).toMatchObject({ tasks_open: 0, tasks_failed: 0 });
		await call("update_requirement", {
			workspace: ws,
			actor: "orchestrator",
			key: REQ,
			status: "done",
			expect_status: ["todo", "in-progress"],
		});
		await call("update_project", { workspace: ws, actor: "orchestrator", key: "PROJ-001", status: "done", expect_status: ["todo", "in-progress"] });
		await call("update_goal", { workspace: ws, actor: "orchestrator", key: "GOAL-001", status: "done", expect_status: ["todo", "in-progress"] });
		// a move to `done` is not drift, and documented work is not undocumented
		expect((await call<Page>("read_view", { workspace: ws, view: "v_doc_stale" })).rows).toEqual([]);
		expect((await call<Page>("read_view", { workspace: ws, view: "v_undocumented_work" })).rows).toEqual([]);

		// drift: the subject moves after its page was written → stale until the page is rewritten
		await sleep(1100);
		await call("update_project", {
			workspace: ws,
			actor: "orchestrator",
			key: "PROJ-001",
			isolation: "shared",
			worktree_path: null,
		});
		const stale = await call<Page>("read_view", { workspace: ws, view: "v_doc_stale" });
		expect(stale.rows.map((r) => [r["slug"], r["subject_type"], r["subject_id"]])).toEqual([["account-worktree", "project", "PROJ-001"]]);
		await call("upsert_doc", {
			workspace: ws,
			actor: "librarian",
			slug: "account-worktree",
			title: "Account creation runs in the shared tree",
			body: "PROJ-001 is back on the shared tree.",
		});
		expect((await call<Page>("read_view", { workspace: ws, view: "v_doc_stale" })).rows).toEqual([]);

		// ── qa: the standing carrier and one maintenance inspection ─────────────────────────
		expect(
			(await call<Page>("list", { workspace: ws, type: "requirement", where: { title: "Product QA & E2E Regression" } })).rows,
		).toEqual([]);
		const carrier = await call("create_requirement", {
			workspace: ws,
			actor: "orchestrator",
			title: "Product QA & E2E Regression",
			body: "# Product QA\n\nStanding work.",
			project: null,
			priority: 3,
		});
		const QA = String(carrier["key"]);
		// opened by a move, not inserted at its end state, so the feed has its history (G7)
		await call("update_requirement", { workspace: ws, actor: "orchestrator", key: QA, status: "in-progress", expect_status: "todo" });
		const qaTicket = async (fields: Row): Promise<string> =>
			String((await call("create_task", { workspace: ws, actor: "orchestrator", requirement: QA, priority: 2, ...fields }))["key"]);
		const qaCheck = await qaTicket({ title: "Is an inspection due?", objective: "…", body: "", node_key: "qa-check", capabilities: [{ capability: "qa-planning", required: true }] });
		const qaPlan = await qaTicket({ title: "Plan the inspection", node_key: "qa-plan", capabilities: [{ capability: "qa-planning", required: true }] });
		const mission = await qaTicket({ title: "MISSION-checkout", node_key: "qa-execute", capabilities: [{ capability: "qa-execution", required: true }] });
		const qaReport = await qaTicket({ title: "Compile the report", node_key: "qa-report", capabilities: [{ capability: "qa-planning", required: true }] });
		const qaGraph = await call<{ nodes: Row[]; edges: Row[]; gates: Row[] }>("instantiate_graph", {
			workspace: ws,
			actor: "orchestrator",
			requirement: QA,
			nodes: [
				{ node_key: "qa-check", kind: "work", task: qaCheck },
				{ node_key: "qa-plan", kind: "work", task: qaPlan },
				{ node_key: "qa-execute", kind: "work" },
				{ node_key: "qa-report", kind: "work", task: qaReport },
				{
					node_key: "gate-repairs",
					kind: "gate",
					gate: { kind: "select-findings", prompt: `Findings and bugs from ${QA} — approve which get repaired.` },
				},
				{ node_key: "repair", kind: "work" },
			],
			edges: [
				{ from: "qa-check", to: "qa-plan" },
				{ from: "qa-plan", to: "qa-execute" },
				{ from: "qa-execute", to: "qa-report" },
				{ from: "qa-report", to: "gate-repairs" },
				{ from: "gate-repairs", to: "repair" },
			],
		});
		expect([qaGraph.nodes.length, qaGraph.edges.length, qaGraph.gates.length]).toEqual([6, 5, 1]);
		await call("set_state", { workspace: ws, actor: "orchestrator", key: `graph-template:${QA}`, value: "maintenance" });

		await dispatch(`${QA}/qa-check`, qaCheck, "qa-strategist");
		expect((await call<Page>("read_view", { workspace: ws, view: "v_coverage_due" })).rows).toEqual([]);
		await finish(`${QA}/qa-check`, qaCheck, "qa-strategist");

		await dispatch(`${QA}/qa-plan`, qaPlan, "qa-strategist");
		const area = await call("upsert_coverage", {
			workspace: ws,
			actor: "qa-strategist",
			id: "checkout-flow",
			area: "Checkout flow",
			risk: "high",
			spec_path: "e2e/checkout.spec.ts",
			notes: "Money moves here …",
		});
		expect(area).toMatchObject({ id: "checkout-flow", risk: "high", last_inspected_at: null });
		await call("upsert_coverage", { workspace: ws, actor: "qa-strategist", id: "auth", area: "Sign-in", risk: "medium" });
		const due = await call<Page>("read_view", { workspace: ws, view: "v_coverage_due" });
		expect(due.rows.map((r) => [r["id"], r["days_since"]]).sort()).toEqual([
			["auth", null],
			["checkout-flow", null],
		]); // never inspected: null, not 0
		const areas = (await call<Page>("list", { workspace: ws, type: "coverage" })).rows.map((c) => String(c["id"]));
		const inspection = await call("create_inspection", {
			workspace: ws,
			actor: "qa-strategist",
			scope: "whole product",
			trigger: "manual",
			coverage: areas,
		});
		expect(inspection).toMatchObject({ key: "INSP-001", status: "todo" });
		expect(inspection["coverage"]).toEqual([
			{ coverage_id: "auth", verdict: null },
			{ coverage_id: "checkout-flow", verdict: null },
		]);
		await call("log_work", { workspace: ws, actor: "qa-strategist", task: qaPlan, entry: "Follow-up: MISSION-checkout" });
		await finish(`${QA}/qa-plan`, qaPlan, "qa-strategist");

		await call("update_inspection", {
			workspace: ws,
			actor: "orchestrator",
			key: "INSP-001",
			status: "in-progress",
			started_at: nowIso(),
			expect_status: "todo",
		});
		// the serial guard (maintenance.md §5): both must be empty before qa-execute
		expect((await call<Page>("list", { workspace: ws, type: "graph_node", where: { node_key: "qa-execute", status: "running" } })).rows).toEqual([]);
		expect((await call<Page>("list", { workspace: ws, type: "task", where: { claimed_by: "qa-tester", status: "in-progress" } })).rows).toEqual([]);
		await dispatch(`${QA}/qa-execute`, mission, "qa-tester");
		await call("get", { workspace: ws, type: "coverage", key: "checkout-flow" });
		await call("set_inspection_verdict", {
			workspace: ws,
			actor: "qa-tester",
			inspection: "INSP-001",
			coverage: "checkout-flow",
			verdict: "issues",
		});
		const qaBug = await call("file_bug", {
			workspace: ws,
			actor: "qa-tester",
			title: "Checkout accepts quantity 0 and places an order for nothing",
			repro: "1. Add any item…\nExpected: …\nActual: …",
			body: "Area: Checkout · Mission: MISSION-checkout …",
			severity: "major",
			requirement: QA,
			found_by: "qa-tester",
		});
		expect(qaBug).toMatchObject({ key: "BUG-002", status: "open" });
		await call("upsert_coverage", { workspace: ws, actor: "qa-tester", id: "checkout-flow", last_inspected_at: nowIso() });
		await call("set_inspection_verdict", { workspace: ws, actor: "qa-tester", inspection: "INSP-001", coverage: "auth", verdict: "pass" });
		await call("upsert_coverage", { workspace: ws, actor: "qa-tester", id: "auth", last_inspected_at: nowIso() });
		const respec = await call("upsert_coverage", {
			workspace: ws,
			actor: "qa-tester",
			id: "checkout-flow",
			spec_path: "e2e/checkout/place-order.spec.ts",
		});
		// a patch: area, risk and notes are kept
		expect(respec).toMatchObject({ area: "Checkout flow", risk: "high", notes: "Money moves here …", spec_path: "e2e/checkout/place-order.spec.ts" });
		await finish(`${QA}/qa-execute`, mission, "qa-tester");

		await dispatch(`${QA}/qa-report`, qaReport, "qa-strategist");
		const closed = await call("update_inspection", {
			workspace: ws,
			actor: "orchestrator",
			key: "INSP-001",
			status: "done",
			finished_at: nowIso(),
			expect_status: "in-progress",
		});
		expect(closed["coverage"]).toEqual([
			{ coverage_id: "auth", verdict: "pass" },
			{ coverage_id: "checkout-flow", verdict: "issues" },
		]);
		await finish(`${QA}/qa-report`, qaReport, "qa-strategist");

		await call("resolve_gate", {
			workspace: ws,
			actor: "orchestrator",
			node: `${QA}/gate-repairs`,
			status: "approved",
			decision: "Repair BUG-002.",
		});
		const qaFix = await qaTicket({ title: "Fix: BUG-002", files: ["src/lib/cart.ts"], node_key: "repair", capabilities: [{ capability: "implement", required: true }] });
		await call("update_bug", { workspace: ws, actor: "orchestrator", key: "BUG-002", fix_task: qaFix, status: "fixing", expect_status: "open" });
		await dispatch(`${QA}/repair`, qaFix, "developer");
		await call("log_work", { workspace: ws, actor: "developer", task: qaFix, entry: "Quantity must be at least 1" });
		await call("set_task_status", { workspace: ws, actor: "orchestrator", key: qaFix, status: "done", expect_status: "in-progress" });
		await call("set_node_status", { workspace: ws, actor: "orchestrator", node: `${QA}/repair`, status: "done", expect_status: "running" });
		// the re-verify: the qa-tester empirically confirms it and reports `BUG-002 re-verified fixed`
		// (qa-tester.md §6); the orchestrator closes the bug (qa SKILL.md, check-in §3.4)
		await call("update_bug", { workspace: ws, actor: "orchestrator", key: "BUG-002", status: "fixed", expect_status: ["open", "fixing"] });
		expect((await call<Page>("read_view", { workspace: ws, view: "v_open_bugs" })).rows).toEqual([]);

		// ── release (release SKILL.md, kumiai) ─────────────────────────────────────────────
		const releasable = await readAll("list", { workspace: ws, type: "requirement", where: { status: "done" } });
		expect(releasable.rows.map((r) => r["id"])).toEqual([REQ]);
		const priorReleases = await readAll("list", { workspace: ws, type: "guild_state", where: { key: { op: "like", value: "release:%" } } });
		expect(priorReleases.rows).toEqual([]);
		const gateCheck = await call<Page>("read_view", { workspace: ws, view: "v_requirement_progress", where: { id: [REQ] } });
		expect(gateCheck.rows[0]).toMatchObject({ tasks_open: 0, tasks_failed: 0 });
		expect((await call<Page>("read_view", { workspace: ws, view: "v_failed_tasks", where: { requirement_id: [REQ] } })).rows).toEqual([]);
		expect((await call<{ rows: Row[] }>("get_state", { workspace: ws, key: "release:v1.0.0" })).rows).toEqual([]);

		type Fingerprint = { tables: Record<string, { count: number; max_key: unknown }>; events: { count: number; max_id: number | null } };
		const fpBefore = await call<Fingerprint>("fingerprint", { workspace: ws });
		const record = await call("set_state", {
			workspace: ws,
			actor: "orchestrator",
			key: "release:v1.0.0",
			value: JSON.stringify({ released: "2026-10-18", requirements: [REQ] }),
		});
		expect(record).toEqual({ key: "release:v1.0.0", value: `{"released":"2026-10-18","requirements":["${REQ}"]}` });
		const released = await call("record_event", {
			workspace: ws,
			actor: "orchestrator",
			verb: "released",
			subject_type: "release",
			subject_id: "v1.0.0",
			payload: { requirements: [REQ] },
		});
		expect(released).toMatchObject({ verb: "released", actor: "orchestrator", subject_id: "v1.0.0" });
		const fpAfter = await call<Fingerprint>("fingerprint", { workspace: ws });
		// the only differences permitted: one guild_state row and the one `released` event
		const changed = Object.keys(fpAfter.tables).filter(
			(t) => JSON.stringify(fpAfter.tables[t]) !== JSON.stringify(fpBefore.tables[t]),
		);
		expect(changed).toEqual(["guild_state"]);
		expect(fpAfter.tables["guild_state"]?.count).toBe((fpBefore.tables["guild_state"]?.count ?? 0) + 1);
		expect(fpAfter.events.count).toBe(fpBefore.events.count + 1);
		expect(fpAfter.events.max_id).toBe(released["id"]);

		// ── brief (brief SKILL.md, kumiai) ─────────────────────────────────────────────────
		const brief = await call<Page>("read_view", { workspace: ws, view: "v_brief" });
		expect(brief.rows.length).toBeGreaterThan(0);
		expect(Object.keys(brief.rows[0] ?? {})).toEqual(["ord", "fact", "value"]);
		for (const view of ["v_goal_progress", "v_projects_runnable", "v_in_flight", "v_open_bounties", "v_blocked_tasks", "v_open_findings", "v_gates_pending", "v_plans_pending_approval"]) {
			await call<Page>("read_view", { workspace: ws, view });
		}
		const open = await call<Page>("read_view", {
			workspace: ws,
			view: "v_requirement_progress",
			where: { status: { op: "<>", value: "done" } },
		});
		expect(open.rows.map((r) => r["id"])).toEqual([QA]);
		const moved = await call<Page>("read_view", {
			workspace: ws,
			view: "v_recent_activity",
			where: { ts: { op: ">=", value: startedAt } },
			order_by: [{ col: "ts", dir: "desc" }],
			limit: 50,
		});
		expect(moved.rows).toHaveLength(50);
		expect(moved.next_offset).toBe(50); // more than 50 moved: say "50+", not "50"

		// the shift's `used` count (shift SKILL.md 2.6, kumiai): distinct graph nodes moved since t0.
		// A node move is the `node-moved` verb; `moved` is the verb of tickets and the direction.
		const nodeMoves = await readAll("list", {
			workspace: ws,
			type: "event",
			where: { subject_type: "graph_node", verb: "node-moved", ts: { op: ">=", value: startedAt } },
		});
		expect(new Set(nodeMoves.rows.map((e) => e["subject_id"])).size).toBe(19); // every node of both graphs
		const wrongVerb = await call<Page>("list", {
			workspace: ws,
			type: "event",
			where: { subject_type: "graph_node", verb: "moved" },
		});
		expect(wrongVerb.rows).toEqual([]);

		// ── dashboard (dashboard SKILL.md, kumiai): page every key to the end ────────────────
		const keys: [string, "read_view" | "list", Row][] = [
			["brief", "read_view", { view: "v_brief" }],
			["goals", "read_view", { view: "v_goal_progress", order_by: [{ col: "priority", dir: "asc" }, { col: "id", dir: "asc" }] }],
			["projects", "read_view", { view: "v_project_progress" }],
			["requirements", "read_view", { view: "v_requirement_progress" }],
			["tasks", "read_view", { view: "v_board" }],
			["blocked", "read_view", { view: "v_blocked_tasks" }],
			["approvals", "read_view", { view: "v_plans_pending_approval" }],
			["nodes", "list", { type: "graph_node", order_by: [{ col: "requirement_id", dir: "asc" }, { col: "id", dir: "asc" }] }],
			["edges", "list", { type: "graph_edge", order_by: [{ col: "from_node", dir: "asc" }, { col: "to_node", dir: "asc" }] }],
			["gates", "list", { type: "gate", order_by: [{ col: "node_id", dir: "asc" }] }],
			["bugs", "list", { type: "bug", order_by: [{ col: "id", dir: "asc" }] }],
			["findings", "list", { type: "review_finding", order_by: [{ col: "id", dir: "asc" }] }],
			["coverage", "list", { type: "coverage", order_by: [{ col: "id", dir: "asc" }] }],
			["docs", "read_view", { view: "v_doc_current" }],
			["decisions", "read_view", { view: "v_decision_log" }],
			["docs_stale", "read_view", { view: "v_doc_stale" }],
			["undocumented", "read_view", { view: "v_undocumented_work" }],
			["links", "list", { type: "knowledge_edge", order_by: [{ col: "id", dir: "asc" }] }],
		];
		for (const [key, tool, args] of keys) {
			const paged = await readAll(tool, { workspace: ws, ...args }, 4);
			const whole = await call<Page>(tool, { workspace: ws, ...args, limit: 500 });
			expect(whole.next_offset, key).toBeNull();
			// small pages concatenate to the whole (v_brief's clock is the only moving value)
			const still = (rows: Row[]) => rows.filter((r) => r["fact"] !== "generated_at");
			expect(still(paged.rows), key).toEqual(still(whole.rows));
		}
		const nodesPaged = await readAll("list", { workspace: ws, type: "graph_node", order_by: [{ col: "id", dir: "asc" }] }, 4);
		expect(nodesPaged.rows).toHaveLength(19);
		expect(nodesPaged.pages).toBe(5);
		await call<Page>("read_view", { workspace: ws, view: "v_recent_activity", order_by: [{ col: "ts", dir: "desc" }], limit: 200 });

		// ── the check-in stamp, last — then validate (validate SKILL.md, kumiai) ────────────
		await call("set_state", { workspace: ws, actor: "orchestrator", key: "last-checkin", value: nowIso() });
		for (const args of [
			{},
			{ process: "check-in" },
			{ process: "brief" },
			{ process: "dashboard" },
			{ process: "release" },
			{ process: "qa" },
		]) {
			const report = await call<Invariants>("check_invariants", { workspace: ws, ...args });
			expect(report.failures, JSON.stringify(args)).toEqual([]);
			expect(report.ok).toBe(true);
			expect(report.checked).toContain("G1");
		}
	}, 60_000);
});
