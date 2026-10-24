import { describe, it, expect } from "vitest";
import { pool } from "../helpers/index.js";
import {
	seedGuildBoard,
	one,
	all,
	addProject,
	addRequirement,
	addTask,
	addCapability,
	addDependency,
	addNode,
	addEdge,
	addGate,
	logWork,
	type GuildBoard,
} from "../helpers/guild.js";

/** Every v_* view in guild schema.sql v9.3. */
const GUILD_VIEWS = [
	"v_task_who",
	"v_task_deps",
	"v_task_blockers",
	"v_task_actionable",
	"v_next_task",
	"v_batch",
	"v_open_bounties",
	"v_blocked_tasks",
	"v_ready_nodes",
	"v_gates_pending",
	"v_plans_pending_approval",
	"v_board",
	"v_requirement_progress",
	"v_projects_runnable",
	"v_project_progress",
	"v_goal_progress",
	"v_in_flight",
	"v_failed_tasks",
	"v_open_findings",
	"v_open_bugs",
	"v_recent_activity",
	"v_coverage_due",
	"v_knowledge_ref",
	"v_doc_current",
	"v_doc_neighbors",
	"v_doc_stale",
	"v_undocumented_work",
	"v_decision_log",
	"v_knowledge_dangling",
	"v_brief",
];

function view<T>(name: string, board: GuildBoard, where = "true", params: unknown[] = []): Promise<T[]> {
	return all<T>(`SELECT * FROM kumiai_${name} WHERE workspace_id = $1 AND (${where})`, [board.workspaceId, ...params]);
}

async function setStatus(table: string, id: string, status: string): Promise<void> {
	await pool.query(`UPDATE ${table} SET status = $1 WHERE id = $2`, [status, id]);
}

describe("guild views exist and can be selected", () => {
	it("defines kumiai_<name> for every guild view, each with a workspace_id column", async () => {
		const rows = await all<{ viewname: string }>(
			`SELECT viewname FROM pg_views WHERE schemaname = 'public' AND viewname LIKE 'kumiai\\_v\\_%' ORDER BY viewname`,
		);
		expect(rows.map((r) => r.viewname.replace(/^kumiai_/, "")).sort()).toEqual([...GUILD_VIEWS].sort());

		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const task = await addTask(board, req.id, { status: "in-progress" });
		await addNode(req, "implement", { taskId: task.id });
		for (const name of GUILD_VIEWS) {
			const result = await pool.query(`SELECT * FROM kumiai_${name} WHERE workspace_id = $1 LIMIT 5`, [board.workspaceId]);
			expect(result.fields[0]?.name, name).toBe("workspace_id");
		}
	});
});

describe("v_next_task — the cursor rule", () => {
	it("resumes the lowest in-progress task before claiming anything new", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const t1 = await addTask(board, req.id, { agent: "developer" });
		const t2 = await addTask(board, req.id, { agent: "developer" });
		const t3 = await addTask(board, req.id, { status: "in-progress", agent: "developer" });

		expect(await view("v_next_task", board)).toEqual([
			expect.objectContaining({ reason: "resume", id: t3.key, requirement_id: req.key, who: "developer" }),
		]);

		await setStatus("kumiai_tasks", t3.id, "done");
		await setStatus("kumiai_tasks", t2.id, "in-progress");
		expect(await view<{ reason: string; id: string }>("v_next_task", board)).toEqual([
			expect.objectContaining({ reason: "resume", id: t2.key }),
		]);

		await setStatus("kumiai_tasks", t2.id, "done");
		expect(await view("v_next_task", board)).toEqual([expect.objectContaining({ reason: "claim", id: t1.key })]);
	});

	it("is one board per workspace: another workspace's in-flight work does not hold this one", async () => {
		const a = await seedGuildBoard();
		const b = await seedGuildBoard({ teamId: a.teamId, workspaceName: "second" });
		const ta = await addTask(a, (await addRequirement(a)).id);
		await addTask(b, (await addRequirement(b)).id, { status: "in-progress" });
		expect(await view("v_next_task", a)).toEqual([expect.objectContaining({ reason: "claim", id: ta.key })]);
		expect(await view("v_next_task", b)).toEqual([expect.objectContaining({ reason: "resume" })]);
	});
});

describe("v_task_actionable — the review gate", () => {
	it("lets a `failed` task release the reviewer but holds it for a `blocked` one", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const impl = await addTask(board, req.id, { agent: "developer", status: "in-progress" });
		const review = await addTask(board, req.id, { agent: "reviewer" });
		const ids = async () => (await view<{ id: string }>("v_task_actionable", board)).map((r) => r.id);

		expect(await ids()).toEqual([]); // implementation still running
		await setStatus("kumiai_tasks", impl.id, "blocked");
		expect(await ids()).toEqual([]); // a machine verdict nobody ruled on holds the gate
		await setStatus("kumiai_tasks", impl.id, "failed");
		expect(await ids()).toEqual([review.key]); // adjudicated work stops blocking
	});

	it("matches 'reviewer' exactly, and two reviewer tickets do not gate each other", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const r1 = await addTask(board, req.id, { agent: "reviewer" });
		const r2 = await addTask(board, req.id, { agent: "reviewer" });
		const sec = await addTask(board, req.id, { agent: "reviewer-security" });
		const ids = (await view<{ id: string }>("v_task_actionable", board)).map((r) => r.id).sort();
		// reviewer-security is ordinary work, so it holds both reviewers; it is itself actionable
		expect(ids).toEqual([sec.key]);
		await setStatus("kumiai_tasks", sec.id, "done");
		expect((await view<{ id: string }>("v_task_actionable", board)).map((r) => r.id).sort()).toEqual([r1.key, r2.key]);
	});
});

describe("bounties and blocked tasks", () => {
	it("offers only actionable, dependency-free tickets that ask for somebody, and says why the rest are stuck", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const base = await addTask(board, req.id, { agent: "developer" });
		const dependent = await addTask(board, req.id);
		await addCapability(dependent.id, "frontend");
		await addCapability(dependent.id, "implement");
		await addCapability(dependent.id, "svelte", false);
		await addDependency(dependent.id, base.id);
		const unassigned = await addTask(board, req.id);
		const blocked = await addTask(board, req.id, { status: "blocked" });

		expect(await view("v_task_who", board, "task_id = $2", [dependent.key])).toEqual([
			expect.objectContaining({ who: "needs:frontend+implement" }),
		]);
		expect((await view<{ id: string; agent: string }>("v_open_bounties", board)).map((r) => [r.id, r.agent])).toEqual([
			[base.key, "developer"],
		]);
		expect((await view<{ id: string; reason: string }>("v_blocked_tasks", board)).map((r) => [r.id, r.reason])).toEqual([
			[dependent.key, `deps:${base.key}`],
			[unassigned.key, "unassigned"],
			[blocked.key, "status-blocked"],
		]);
		expect(await view("v_task_blockers", board)).toEqual([
			expect.objectContaining({ task_id: dependent.key, blocker_count: 1, blockers: base.key }),
		]);

		// `waived` counts as finished for a successor, exactly like `done`
		await setStatus("kumiai_tasks", base.id, "waived");
		expect((await view<{ id: string }>("v_open_bounties", board)).map((r) => r.id)).toEqual([dependent.key]);
	});

	it("batches a parallel group without its blocked member", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const a = await addTask(board, req.id, { parallelGroup: "g" });
		const b = await addTask(board, req.id, { parallelGroup: "g" });
		await addTask(board, req.id, { parallelGroup: "g", status: "blocked" });
		const solo = await addTask(board, req.id);
		const members = (await view<{ member_id: string }>("v_batch", board, "task_id = $2", [a.key])).map((r) => r.member_id).sort();
		expect(members).toEqual([a.key, b.key]);
		expect(await view("v_batch", board, "task_id = $2", [solo.key])).toEqual([
			expect.objectContaining({ member_id: solo.key, parallel_group: "" }),
		]);
	});
});

describe("v_ready_nodes and gates", () => {
	it("treats `done` and `skipped` as finished, and nothing else", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const a = await addNode(req, "implement", { suffix: "a" });
		const b = await addNode(req, "implement", { suffix: "b" });
		const c = await addNode(req, "review");
		await addEdge(a, c);
		await addEdge(b, c);
		const ready = async () => (await view<{ id: string }>("v_ready_nodes", board)).map((r) => r.id);

		expect(await ready()).toEqual([a.key, b.key]); // roots are ready the moment the graph exists
		await setStatus("kumiai_graph_node", a.id, "done");
		await setStatus("kumiai_graph_node", b.id, "failed");
		expect(await ready()).toEqual([]);
		await setStatus("kumiai_graph_node", b.id, "skipped");
		expect(await view("v_ready_nodes", board)).toEqual([
			expect.objectContaining({ id: c.key, predecessors: `${a.key},${b.key}`, gate_status: null }),
		]);
		await setStatus("kumiai_graph_node", c.id, "running");
		expect(await ready()).toEqual([]); // a running node is not offered again
	});

	it("lists a gate as pending only once its predecessors are finished", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const plan = await addNode(req, "plan");
		const gate = await addNode(req, "gate-plan", { kind: "gate" });
		await addEdge(plan, gate);
		await addGate(gate, "Approve the plan?");
		expect(await view("v_gates_pending", board)).toEqual([]);
		await setStatus("kumiai_graph_node", plan.id, "done");
		expect(await view("v_gates_pending", board)).toEqual([
			expect.objectContaining({ node_id: gate.key, requirement_id: req.key, node_key: "gate-plan", kind: "approve" }),
		]);
		expect(await view("v_ready_nodes", board)).toEqual([
			expect.objectContaining({ id: gate.key, gate_status: "pending", gate_kind: "approve", gate_prompt: "Approve the plan?" }),
		]);
	});

	it("queues drafted plans for approval with their gate node", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const gate = await addNode(req, "gate-plan", { kind: "gate" });
		await pool.query(
			`INSERT INTO kumiai_plans (id, requirement_id, title, status, approval, gate_node_id, created_at, updated_at)
			 VALUES ('p1', $1, 'Drafting', 'todo', 'pending', NULL, now(), now()),
			        ('p2', $1, 'Written', 'done', 'pending', $2, now(), now())`,
			[req.id, gate.id],
		);
		expect(await view("v_plans_pending_approval", board)).toEqual([
			expect.objectContaining({ id: "PLAN-002", task_id: "", gate_node_id: gate.key, title: "Written" }),
		]);
	});
});

describe("progress views", () => {
	it("counts blocked as open and failed as not, per requirement", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		for (const status of ["todo", "in-progress", "blocked", "failed", "done", "waived"]) {
			await addTask(board, req.id, { status });
		}
		expect(await view("v_requirement_progress", board)).toEqual([
			expect.objectContaining({ id: req.key, tasks_total: 6, tasks_done: 1, tasks_open: 3, tasks_blocked: 1, tasks_failed: 1 }),
		]);
		expect((await view<{ section: string }>("v_board", board)).map((r) => r.section)).toEqual([
			"In Progress",
			"Blocked",
			"Backlog",
			"Recently Completed",
			"Failed",
			"Waived",
		]);
	});

	it("runs sequential projects in turn and concurrent/unordered ones beside them", async () => {
		const board = await seedGuildBoard();
		const first = await addProject(board, { ordinal: 1, status: "backlog" });
		const second = await addProject(board, { ordinal: 2 });
		const beside = await addProject(board, { ordinal: 3, concurrent: true });
		const loose = await addProject(board, { ordinal: null });
		const runnable = async () =>
			Object.fromEntries((await view<{ id: string; why: string }>("v_projects_runnable", board)).map((r) => [r.id, r.why]));

		expect(await runnable()).toEqual({ [first.key]: "next in sequence", [beside.key]: "concurrent", [loose.key]: "unordered" });
		const [row] = await view<{ status: string; priority: number; concurrent: number }>("v_projects_runnable", board, "id = $2", [
			first.key,
		]);
		expect(row).toMatchObject({ status: "todo", priority: 3, concurrent: 0 }); // backlog reads as todo, medium as 3

		await setStatus("kumiai_projects", first.id, "done");
		expect(Object.keys(await runnable()).sort()).toEqual([second.key, beside.key, loose.key].sort());
		expect(await view("v_goal_progress", board)).toEqual([
			expect.objectContaining({ projects_total: 4, projects_done: 1, projects_runnable: 3 }),
		]);
		expect(await view("v_project_progress", board, "id = $2", [second.key])).toEqual([
			expect.objectContaining({ runnable: 1, requirements_total: 0, tasks_open: 0 }),
		]);

		await setStatus("kumiai_goals", board.goalId, "done");
		expect(await runnable()).toEqual({}); // a done goal makes its projects unrunnable
	});

	it("reports in-flight minutes against the wall clock", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		await addTask(board, req.id, {
			status: "in-progress",
			claimedAt: new Date(Date.now() - 90 * 60_000).toISOString().replace("Z", ""),
		});
		const [row] = await view<{ minutes: number }>("v_in_flight", board);
		expect(row!.minutes).toBeGreaterThanOrEqual(89);
		expect(row!.minutes).toBeLessThanOrEqual(91);
	});
});

describe("records views", () => {
	it("reads the waiver from a work-log prefix and keeps the agent's own reason", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const failed = await addTask(board, req.id, { status: "failed" });
		const silent = await addTask(board, req.id, { status: "failed" });
		await logWork(failed.id, "Tests do not compile", { ts: "2026-10-18T09:00:00" });
		await logWork(failed.id, "Skipped by user: not needed", { agent: "orchestrator", ts: "2026-10-18T10:00:00" });
		expect((await view<{ id: string; waived: number; reason: string | null }>("v_failed_tasks", board)).map((r) => [r.id, r.waived, r.reason])).toEqual([
			[failed.key, 1, "Tests do not compile"],
			[silent.key, 0, null],
		]);
	});

	it("ranks open findings and bugs by severity", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const task = await addTask(board, req.id);
		await pool.query(
			`INSERT INTO kumiai_review_finding (task_id, reviewer, severity, summary, disposition, created_at) VALUES
			 ($1, 'r', 'nit', 'n', 'open', now()), ($1, 'r', 'critical', 'c', 'fixing', now()), ($1, 'r', 'major', 'm', 'fixed', now())`,
			[task.id],
		);
		expect((await view<{ severity: string; severity_rank: number }>("v_open_findings", board)).map((r) => [r.severity, r.severity_rank])).toEqual([
			["critical", 1],
			["nit", 4],
		]);
		await pool.query(
			`INSERT INTO kumiai_bug (id, workspace_id, title, severity, status, created_at, updated_at) VALUES
			 ('b1', $1, 'Minor', 'minor', 'open', now(), now()), ('b2', $1, 'Crit', 'critical', 'open', now(), now()),
			 ('b3', $1, 'Old', 'major', 'wontfix', now(), now())`,
			[board.workspaceId],
		);
		expect((await view<{ id: string }>("v_open_bugs", board)).map((r) => r.id)).toEqual(["BUG-002", "BUG-001"]);
	});

	it("renders the feed with resolved titles and a from -> to phrase", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board, { title: "Login" });
		await setStatus("kumiai_requirements", req.id, "in-progress");
		const [latest] = await view<{ verb: string; subject_title: string; phrase: string }>("v_recent_activity", board);
		expect(latest).toMatchObject({ verb: "moved", subject_title: "Login", phrase: "todo -> in-progress" });
	});

	it("flags coverage by its risk interval, and never-inspected areas with a NULL age", async () => {
		const board = await seedGuildBoard();
		const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().replace("Z", "");
		await pool.query(
			`INSERT INTO kumiai_coverage (id, workspace_id, key, area, risk, last_inspected_at) VALUES
			 ('c1', $1, 'checkout', 'Checkout', 'high', $2), ('c2', $1, 'search', 'Search', 'high', $3),
			 ('c3', $1, 'profile', 'Profile', 'low', $2), ('c4', $1, 'admin', 'Admin', 'medium', NULL)`,
			// half-day margins keep the assertion clear of clock skew between the host and the database
			[board.workspaceId, daysAgo(20.5), daysAgo(5.5)],
		);
		expect((await view<{ id: string; days_since: number | null; interval_days: number }>("v_coverage_due", board)).map((r) => [r.id, r.days_since, r.interval_days])).toEqual([
			["checkout", 20, 14],
			["admin", null, 30],
		]);
	});
});

describe("library views", () => {
	async function doc(board: GuildBoard, slug: string, input?: { kind?: string; status?: string; updatedAt?: string }): Promise<void> {
		await pool.query(
			`INSERT INTO kumiai_doc (id, workspace_id, slug, title, body, kind, status, created_at, updated_at)
			 VALUES ($1, $2, $1, upper($1), 'body', $3, $4, $5::timestamp, $5::timestamp)`,
			[slug, board.workspaceId, input?.kind ?? "reference", input?.status ?? "current", input?.updatedAt ?? "2026-01-01T00:00:00"],
		);
	}
	async function link(board: GuildBoard, rel: string, from: [string, string], to: [string, string]): Promise<void> {
		await pool.query(
			`INSERT INTO kumiai_knowledge_edge (workspace_id, rel, from_type, from_id, to_type, to_id, created_by, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, 'librarian', now())`,
			[board.workspaceId, rel, from[0], from[1], to[0], to[1]],
		);
	}

	it("goes stale when the subject moves, but not when it is closed", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		await doc(board, "auth-page");
		await pool.query(`DELETE FROM kumiai_event`); // only the moves below are newer than the page
		await link(board, "describes", ["doc", "auth-page"], ["requirement", req.key]);
		await pool.query(`DELETE FROM kumiai_event WHERE verb = 'linked'`);

		await pool.query(`UPDATE kumiai_requirements SET status = 'done' WHERE id = $1`, [req.id]);
		expect(await view("v_doc_stale", board)).toEqual([]); // closing the subject is the carve-out
		expect(await view("v_undocumented_work", board)).toEqual([]); // it is documented

		await pool.query(`UPDATE kumiai_requirements SET status = 'in-progress' WHERE id = $1`, [req.id]);
		expect(await view("v_doc_stale", board)).toEqual([
			expect.objectContaining({ slug: "auth-page", rel: "describes", subject_type: "requirement", subject_id: req.key }),
		]);
		const brief = Object.fromEntries((await view<{ fact: string; value: string }>("v_brief", board)).map((r) => [r.fact, r.value]));
		expect(brief["docs_stale"]).toBe("1");
	});

	it("retires superseded pages from the current library and keeps them in the decision log", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board, { status: "done" });
		await doc(board, "adr-old", { kind: "decision" });
		await doc(board, "adr-new", { kind: "decision" });
		await link(board, "supersedes", ["doc", "adr-new"], ["doc", "adr-old"]);
		await link(board, "decides", ["doc", "adr-new"], ["requirement", req.key]);

		expect((await view<{ slug: string; edges: number }>("v_doc_current", board)).map((r) => [r.slug, r.edges])).toEqual([["adr-new", 2]]);
		const log = await view<{ slug: string; supersedes: string; superseded_by: string; governs: string }>("v_decision_log", board);
		expect(log.find((r) => r.slug === "adr-new")).toMatchObject({ supersedes: "adr-old", governs: `requirement:${req.key}` });
		expect(log.find((r) => r.slug === "adr-old")).toMatchObject({ superseded_by: "adr-new" });
		expect((await view<{ direction: string; other_id: string; other_title: string }>("v_doc_neighbors", board, "slug = 'adr-new'")).map((r) => [r.direction, r.other_id, r.other_title])).toEqual([
			["out", req.key, "Requirement"],
			["out", "adr-old", "ADR-OLD"],
		]);
		expect(await view("v_undocumented_work", board)).toEqual([]);
	});

	it("reports every dangling edge end, and undocumented finished work", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board, { status: "done" });
		await doc(board, "page");
		await link(board, "describes", ["doc", "page"], ["requirement", "REQ-404"]);
		expect(await view("v_knowledge_dangling", board)).toEqual([
			expect.objectContaining({ broken_side: "to", missing_type: "requirement", missing_id: "REQ-404" }),
		]);
		expect(await view("v_undocumented_work", board)).toEqual([expect.objectContaining({ id: req.key, tasks_done: 0 })]);
		expect(await view("v_knowledge_ref", board, "ref_type = 'requirement'")).toEqual([
			expect.objectContaining({ ref_id: req.key, title: "Requirement" }),
		]);
	});
});

describe("v_brief", () => {
	it("returns the 28 standup facts for each workspace, values as text", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const t1 = await addTask(board, req.id, { agent: "developer" });
		await addTask(board, req.id, { status: "blocked" });
		const rows = await view<{ ord: number; fact: string; value: string }>("v_brief", board);
		expect(rows.map((r) => r.ord)).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
		const facts = Object.fromEntries(rows.map((r) => [r.fact, r.value]));
		expect(facts).toMatchObject({
			actor: "orchestrator",
			last_checkin: "null",
			next: t1.key,
			next_reason: "claim",
			tasks_todo: "1",
			tasks_blocked: "1",
			bounties_open: "1",
			bounties_stuck: "1",
			requirements_open: "1",
			projects_open: "0",
			gates_pending: "0",
			docs_current: "0",
		});
		expect(facts["generated_at"]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
		expect(Number(facts["events_since_checkin"])).toBeGreaterThan(0); // no check-in yet: every event counts

		await pool.query(`UPDATE kumiai_guild_state SET value = '2999-01-01T00:00:00Z' WHERE workspace_id = $1 AND key = 'last-checkin'`, [
			board.workspaceId,
		]);
		const after = await one<{ value: string }>(
			`SELECT value FROM kumiai_v_brief WHERE workspace_id = $1 AND fact = 'events_since_checkin'`,
			[board.workspaceId],
		);
		expect(after.value).toBe("0");
	});
});
