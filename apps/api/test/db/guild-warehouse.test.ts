import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { db, allocateKey, withGuildTx } from "@kata/db";
import { truncateAll, pool, seedUser } from "../helpers/index.js";
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

beforeEach(() => truncateAll());

interface EventRow {
	actor: string;
	user_id: string | null;
	verb: string;
	subject_type: string;
	subject_id: string;
	payload: Record<string, unknown>;
}

async function events(board: GuildBoard, where = "true", params: unknown[] = []): Promise<EventRow[]> {
	return all<EventRow>(
		`SELECT actor, user_id, verb, subject_type, subject_id, payload FROM kumiai_event
		  WHERE workspace_id = $1 AND (${where}) ORDER BY id`,
		[board.workspaceId, ...params],
	);
}

// ── CHECK vocabularies ────────────────────────────────────────────────────────

describe("guild CHECK vocabularies", () => {
	it("rejects a task status outside the guild set", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		await expect(addTask(board, req.id, { status: "in-review" })).rejects.toThrow(/kumiai_tasks_status_check/);
		const task = await addTask(board, req.id);
		await expect(pool.query(`UPDATE kumiai_tasks SET status = 'in-review' WHERE id = $1`, [task.id])).rejects.toThrow();
	});

	it("rejects bad goal/requirement/plan statuses and plan approvals", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		await expect(pool.query(`UPDATE kumiai_goals SET status = 'blocked' WHERE id = $1`, [board.goalId])).rejects.toThrow();
		await expect(pool.query(`UPDATE kumiai_requirements SET status = 'waived' WHERE id = $1`, [req.id])).rejects.toThrow();
		await expect(
			pool.query(
				`INSERT INTO kumiai_plans (id, requirement_id, title, status, approval, created_at, updated_at)
				 VALUES ('pl', $1, 'P', 'todo', 'maybe', now(), now())`,
				[req.id],
			),
		).rejects.toThrow(/kumiai_plans_approval_check/);
	});

	it("keeps a shared project from carrying a worktree path", async () => {
		const board = await seedGuildBoard();
		const project = await addProject(board);
		await expect(
			pool.query(`UPDATE kumiai_projects SET worktree_path = '/tmp/wt' WHERE id = $1`, [project.id]),
		).rejects.toThrow(/kumiai_projects_worktree_path_check/);
		await pool.query(`UPDATE kumiai_projects SET isolation = 'worktree', worktree_path = '/tmp/wt' WHERE id = $1`, [
			project.id,
		]);
		await expect(pool.query(`UPDATE kumiai_projects SET isolation = 'sandbox' WHERE id = $1`, [project.id])).rejects.toThrow();
	});

	it("enforces the capability alphabet", async () => {
		const board = await seedGuildBoard();
		const task = await addTask(board, (await addRequirement(board)).id);
		await addCapability(task.id, "e2e");
		await addCapability(task.id, "frontend-svelte");
		for (const bad of ["E2E", "2fa", "has space", "under_score", "", "x".repeat(65)]) {
			await expect(addCapability(task.id, bad)).rejects.toThrow();
		}
	});

	it("rejects bad graph, gate, finding, bug, coverage, doc and edge vocabularies", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const task = await addTask(board, req.id);
		await expect(addNode(req, "implement", { kind: "job" as "work" })).rejects.toThrow(/kind_check/);
		await expect(addNode(req, "implement", { status: "blocked" })).rejects.toThrow(/status_check/);
		const node = await addNode(req, "gate-plan", { kind: "gate" });
		await addGate(node);
		await expect(pool.query(`UPDATE kumiai_gate SET status = 'maybe' WHERE node_id = $1`, [node.id])).rejects.toThrow();
		await expect(
			pool.query(
				`INSERT INTO kumiai_graph_deviation (requirement_id, kind, node_key, reason, created_at) VALUES ($1, 'drop-node', 'review', '   ', now())`,
				[req.id],
			),
		).rejects.toThrow(/reason_check/);
		await expect(
			pool.query(
				`INSERT INTO kumiai_review_finding (task_id, reviewer, severity, summary, created_at) VALUES ($1, 'r', 'trivial', 's', now())`,
				[task.id],
			),
		).rejects.toThrow(/severity_check/);
		// `nit` exists on findings and NOT on bugs
		await expect(
			pool.query(
				`INSERT INTO kumiai_bug (id, workspace_id, title, severity, created_at, updated_at) VALUES ('b', $1, 'B', 'nit', now(), now())`,
				[board.workspaceId],
			),
		).rejects.toThrow(/kumiai_bug_severity_check/);
		await expect(
			pool.query(
				`INSERT INTO kumiai_coverage (id, workspace_id, key, area, risk) VALUES ('c', $1, 'checkout', 'Checkout', 'extreme')`,
				[board.workspaceId],
			),
		).rejects.toThrow(/risk_check/);
		await expect(
			pool.query(
				`INSERT INTO kumiai_doc (id, workspace_id, slug, title, body, kind, created_at, updated_at) VALUES ('d', $1, 's', 'T', 'B', 'memo', now(), now())`,
				[board.workspaceId],
			),
		).rejects.toThrow(/kind_check/);
		// `supersedes` between two non-docs is refused; a self-edge is a typo; evidence points AT a doc
		const edge = (rel: string, ft: string, fi: string, tt: string, ti: string) =>
			pool.query(
				`INSERT INTO kumiai_knowledge_edge (workspace_id, rel, from_type, from_id, to_type, to_id, created_by, created_at)
				 VALUES ($1, $2, $3, $4, $5, $6, 'librarian', now())`,
				[board.workspaceId, rel, ft, fi, tt, ti],
			);
		await expect(edge("supersedes", "task", "TASK-001", "bug", "BUG-001")).rejects.toThrow(/doc_doc_check/);
		await expect(edge("describes", "task", "TASK-001", "doc", "a")).rejects.toThrow(/from_doc_check/);
		await expect(edge("evidence-for", "bug", "BUG-001", "task", "TASK-001")).rejects.toThrow(/evidence_check/);
		await expect(edge("refines", "doc", "a", "doc", "a")).rejects.toThrow(/self_check/);
		await expect(edge("mentions", "doc", "a", "doc", "b")).rejects.toThrow(/rel_check/);
		await edge("describes", "doc", "a", "requirement", req.key);
	});

	it("rejects self-dependencies and self-edges", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const task = await addTask(board, req.id);
		await expect(addDependency(task.id, task.id)).rejects.toThrow(/self_check/);
		const node = await addNode(req, "implement");
		await expect(addEdge(node, node)).rejects.toThrow(/self_check/);
	});
});

// ── Keys ──────────────────────────────────────────────────────────────────────

describe("guild keys", () => {
	it("allocates sequential, zero-padded keys per workspace and per prefix", async () => {
		const a = await seedGuildBoard();
		const b = await seedGuildBoard({ teamId: a.teamId, workspaceName: "second" });
		const ra1 = await addRequirement(a);
		const ra2 = await addRequirement(a);
		const rb1 = await addRequirement(b);
		const ta1 = await addTask(a, ra1.id);
		expect([ra1.key, ra2.key, rb1.key, ta1.key]).toEqual(["REQ-001", "REQ-002", "REQ-001", "TASK-001"]);

		const goal = await one<{ key: string }>(`SELECT key FROM kumiai_goals WHERE id = $1`, [a.goalId]);
		expect(goal.key).toBe("GOAL-001");
	});

	it("allocateKey hands out the next number and is atomic under concurrency", async () => {
		const board = await seedGuildBoard();
		expect(await allocateKey(db, board.workspaceId, "BUG")).toBe("BUG-001");
		const keys = await Promise.all(
			Array.from({ length: 12 }, () =>
				db.transaction((tx) => allocateKey(tx, board.workspaceId, "BUG")),
			),
		);
		expect([...keys].sort()).toEqual(Array.from({ length: 12 }, (_, i) => `BUG-${String(i + 2).padStart(3, "0")}`));
	});

	it("gives a rolled-back allocation's number back", async () => {
		const board = await seedGuildBoard();
		await expect(
			db.transaction(async (tx) => {
				await allocateKey(tx, board.workspaceId, "INSP");
				throw new Error("rollback");
			}),
		).rejects.toThrow("rollback");
		expect(await allocateKey(db, board.workspaceId, "INSP")).toBe("INSP-001");
	});

	it("moves the counter past a writer-supplied key, and never lets a key change", async () => {
		const board = await seedGuildBoard();
		await one(
			`INSERT INTO kumiai_requirements (id, team_id, workspace_id, key, title, status, priority, created_at, updated_at)
			 VALUES ('r-imported', $1, $2, 'REQ-041', 'Imported', 'todo', 3, now(), now()) RETURNING id`,
			[board.teamId, board.workspaceId],
		);
		expect((await addRequirement(board)).key).toBe("REQ-042");
		await expect(pool.query(`UPDATE kumiai_requirements SET key = 'REQ-500' WHERE id = 'r-imported'`)).rejects.toThrow(
			/cannot change/,
		);
		await expect(
			pool.query(
				`INSERT INTO kumiai_requirements (id, team_id, workspace_id, key, title, status, priority, created_at, updated_at)
				 VALUES ('r-bad', $1, $2, 'REQ-7', 'Bad', 'todo', 3, now(), now())`,
				[board.teamId, board.workspaceId],
			),
		).rejects.toThrow(/key_check/);
	});

	it("keeps graph node ids unique per workspace, separate from node_key", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const task = await addTask(board, req.id);
		const node = await addNode(req, "implement", { suffix: task.key, taskId: task.id });
		expect(node.key).toBe("REQ-001/implement.TASK-001");
		expect((await one<{ node_key: string }>(`SELECT node_key FROM kumiai_graph_node WHERE id = $1`, [node.id])).node_key).toBe(
			"implement",
		);
		await expect(addNode(req, "implement", { suffix: task.key })).rejects.toThrow(/workspace_key_idx/);
	});
});

// ── Workspace scope ───────────────────────────────────────────────────────────

describe("guild workspace scope", () => {
	it("derives workspace_id and team_id from the parent row", async () => {
		const board = await seedGuildBoard();
		const project = await addProject(board);
		const req = await addRequirement(board, { projectId: project.id });
		const task = await addTask(board, req.id);
		const node = await addNode(req, "implement");
		const gateNode = await addNode(req, "gate-plan", { kind: "gate" });
		await addEdge(gateNode, node);
		await addGate(gateNode);
		const rows = await all<{ ws: string; team: string }>(
			`SELECT workspace_id AS ws, team_id AS team FROM kumiai_projects WHERE id = $1
			 UNION ALL SELECT workspace_id, team_id FROM kumiai_requirements WHERE id = $2
			 UNION ALL SELECT workspace_id, team_id FROM kumiai_tasks WHERE id = $3
			 UNION ALL SELECT workspace_id, team_id FROM kumiai_graph_edge WHERE to_node = $4
			 UNION ALL SELECT workspace_id, team_id FROM kumiai_gate WHERE node_id = $5`,
			[project.id, req.id, task.id, node.id, gateNode.id],
		);
		expect(rows).toHaveLength(5);
		for (const r of rows) expect(r).toEqual({ ws: board.workspaceId, team: board.teamId });

		// graph_edge and gate carry the requirement, filled from the node
		const reqIds = await all<{ requirement_id: string }>(
			`SELECT requirement_id FROM kumiai_graph_edge WHERE to_node = $1 UNION ALL SELECT requirement_id FROM kumiai_gate WHERE node_id = $2`,
			[node.id, gateNode.id],
		);
		expect(reqIds.map((r) => r.requirement_id)).toEqual([req.id, req.id]);
	});

	it("puts an unaffiliated requirement in the team's default workspace", async () => {
		const board = await seedGuildBoard();
		const row = await one<{ workspace_id: string }>(
			`INSERT INTO kumiai_requirements (id, team_id, title, status, priority, created_at, updated_at)
			 VALUES ('loose', $1, 'Loose', 'todo', 3, now(), now()) RETURNING workspace_id`,
			[board.teamId],
		);
		expect(row.workspace_id).toBe(board.workspaceId);
	});

	it("refuses a row that points into another workspace", async () => {
		const a = await seedGuildBoard();
		const b = await seedGuildBoard({ teamId: a.teamId, workspaceName: "second" });
		const ta = await addTask(a, (await addRequirement(a)).id);
		const tb = await addTask(b, (await addRequirement(b)).id);
		await expect(addDependency(ta.id, tb.id)).rejects.toThrow(/workspace/);
		const rb = await addRequirement(b);
		await expect(pool.query(`UPDATE kumiai_tasks SET requirement_id = $1 WHERE id = $2`, [rb.id, ta.id])).rejects.toThrow(
			/workspace/,
		);
	});

	it("refuses, inside withGuildTx, a write outside the transaction's workspace", async () => {
		const a = await seedGuildBoard();
		const b = await seedGuildBoard({ teamId: a.teamId, workspaceName: "second" });
		const rb = await addRequirement(b);
		await expect(
			withGuildTx(db, { actor: "developer", teamId: a.teamId, workspaceId: a.workspaceId }, (tx) =>
				tx.execute(
					sql`INSERT INTO kumiai_tasks (id, requirement_id, title, status, priority, created_at, updated_at)
					    VALUES ('x', ${rb.id}, 'T', 'todo', 3, now(), now())`,
				),
			),
		).rejects.toMatchObject({ cause: { message: expect.stringMatching(/outside this transaction/) } });
	});
});

// ── Events ────────────────────────────────────────────────────────────────────

describe("guild event triggers", () => {
	it("attributes every event to the transaction's actor and user", async () => {
		const board = await seedGuildBoard();
		const user = await seedUser();
		const req = await addRequirement(board);
		await withGuildTx(db, { actor: "strategist", userId: user.id, teamId: board.teamId, workspaceId: board.workspaceId }, (tx) =>
			tx.execute(
				sql`INSERT INTO kumiai_tasks (id, requirement_id, title, status, priority, agent, parallel_group, created_at, updated_at)
				    VALUES ('t1', ${req.id}, 'Build', 'todo', 2, 'developer', 'g1', now(), now())`,
			),
		);
		const [created] = await events(board, "subject_type = 'task'");
		expect(created).toEqual({
			actor: "strategist",
			user_id: user.id,
			verb: "created",
			subject_type: "task",
			subject_id: "TASK-001",
			payload: { requirement_id: "REQ-001", agent: "developer", priority: 2, parallel_group: "g1" },
		});
	});

	it("defaults the actor to 'orchestrator' and clears the setting after the transaction", async () => {
		const board = await seedGuildBoard();
		await withGuildTx(db, { actor: "developer", teamId: board.teamId, workspaceId: board.workspaceId }, async () => undefined);
		await addRequirement(board);
		const [created] = await events(board, "subject_type = 'requirement'");
		expect(created!.actor).toBe("orchestrator");
		expect(created!.user_id).toBeNull();
		expect(created!.payload).toEqual({ project_id: null, priority: 3 });
	});

	it("writes moved and claimed events with the guild's payloads", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const task = await addTask(board, req.id, { agent: "developer" });
		await withGuildTx(db, { actor: "orchestrator", teamId: board.teamId, workspaceId: board.workspaceId }, (tx) =>
			tx.execute(
				sql`UPDATE kumiai_tasks SET status = 'in-progress', claimed_by = 'developer-svelte', claimed_at = now() WHERE id = ${task.id}`,
			),
		);
		await pool.query(`UPDATE kumiai_requirements SET status = 'in-progress' WHERE id = $1`, [req.id]);
		const rows = await events(board, "verb IN ('moved', 'claimed')");
		expect(rows.map((r) => [r.verb, r.subject_id, r.payload])).toEqual(
			expect.arrayContaining([
				["moved", "TASK-001", { from: "todo", to: "in-progress", agent: "developer-svelte", requirement_id: "REQ-001" }],
				["claimed", "TASK-001", { agent: "developer-svelte", requirement_id: "REQ-001" }],
				["moved", "REQ-001", { from: "todo", to: "in-progress", tasks_open: 1 }],
			]),
		);
		// a write that does not change the status records nothing
		const before = (await events(board)).length;
		await pool.query(`UPDATE kumiai_tasks SET title = 'Renamed' WHERE id = $1`, [task.id]);
		expect((await events(board)).length).toBe(before);
	});

	it("reads Kumiai project statuses the guild way in project events", async () => {
		const board = await seedGuildBoard();
		const project = await addProject(board, { status: "backlog" });
		const [created] = await events(board, "subject_type = 'project'");
		expect(created!.payload).toEqual({ goal_id: "GOAL-001", ordinal: null, concurrent: 0, isolation: "shared" });
		await pool.query(`UPDATE kumiai_projects SET status = 'todo' WHERE id = $1`, [project.id]);
		expect(await events(board, "verb = 'moved'")).toHaveLength(0); // backlog -> todo is no guild move
		await pool.query(`UPDATE kumiai_projects SET status = 'done', isolation = 'worktree', worktree_path = '/wt' WHERE id = $1`, [
			project.id,
		]);
		const rows = await events(board, "verb IN ('moved', 'isolated')");
		expect(rows.map((r) => [r.verb, r.payload])).toEqual(
			expect.arrayContaining([
				["moved", { from: "todo", to: "done", goal_id: "GOAL-001" }],
				["isolated", { from: "shared", to: "worktree", worktree_path: "/wt" }],
			]),
		);
	});

	it("uses the row's own author for findings, work log, bugs, approvals, docs and edges", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const task = await addTask(board, req.id);
		const finding = await one<{ id: number }>(
			`INSERT INTO kumiai_review_finding (task_id, reviewer, severity, summary, file, line, created_at)
			 VALUES ($1, 'reviewer-security', 'major', 'SQL injection', 'a.ts', 7, now()) RETURNING id::int AS id`,
			[task.id],
		);
		await logWork(task.id, "Implemented the parser", { agent: "developer", ts: "2026-10-18T09:00:00" });
		await pool.query(
			`INSERT INTO kumiai_bug (id, workspace_id, title, found_by, requirement_id, created_at, updated_at)
			 VALUES ('b1', $1, 'Crash', 'qa-tester', $2, now(), now())`,
			[board.workspaceId, req.id],
		);
		const plan = await one<{ id: string }>(
			`INSERT INTO kumiai_plans (id, requirement_id, title, status, approval, created_at, updated_at)
			 VALUES ('p1', $1, 'Plan', 'done', 'pending', now(), now()) RETURNING id`,
			[req.id],
		);
		await pool.query(`UPDATE kumiai_plans SET approval = 'approved', approved_by = 'user', approved_at = now() WHERE id = $1`, [
			plan.id,
		]);
		await pool.query(
			`INSERT INTO kumiai_doc (id, workspace_id, slug, title, body, source, created_at, updated_at)
			 VALUES ('d1', $1, 'adr-x', 'ADR', 'v1', 'librarian', now(), now())`,
			[board.workspaceId],
		);
		await pool.query(
			`INSERT INTO kumiai_knowledge_edge (workspace_id, rel, from_type, from_id, to_type, to_id, created_by, created_at)
			 VALUES ($1, 'describes', 'doc', 'adr-x', 'requirement', $2, 'librarian', now())`,
			[board.workspaceId, req.key],
		);

		const rows = await events(board, "verb IN ('found', 'logged', 'decided', 'documented', 'linked') OR subject_type = 'bug'");
		const byVerb = Object.fromEntries(rows.map((r) => [r.verb === "created" ? "bug" : r.verb, r]));
		expect(byVerb["found"]).toMatchObject({
			actor: "reviewer-security",
			subject_type: "task",
			subject_id: "TASK-001",
			payload: { finding_id: finding.id, severity: "major", summary: "SQL injection", file: "a.ts", line: 7 },
		});
		expect(byVerb["logged"]).toMatchObject({ actor: "developer", subject_id: "TASK-001", payload: { entry: "Implemented the parser" } });
		expect(byVerb["bug"]).toMatchObject({ actor: "qa-tester", subject_id: "BUG-001", payload: { severity: "major", requirement_id: "REQ-001" } });
		expect(byVerb["decided"]).toMatchObject({
			actor: "user",
			subject_id: "PLAN-001",
			payload: { from: "pending", to: "approved", requirement_id: "REQ-001", gate_node_id: null },
		});
		expect(byVerb["documented"]).toMatchObject({ actor: "librarian", subject_id: "adr-x" });
		expect(byVerb["linked"]).toMatchObject({
			actor: "librarian",
			subject_type: "doc",
			subject_id: "adr-x",
			payload: { rel: "describes", to_type: "requirement", to_id: "REQ-001", note: "" },
		});

		const loggedAt = await one<{ ts: string }>(
			`SELECT to_char(ts, 'YYYY-MM-DD"T"HH24:MI:SS') AS ts FROM kumiai_event WHERE verb = 'logged'`,
		);
		expect(loggedAt.ts).toBe("2026-10-18T09:00:00");
	});

	it("snapshots the OLD doc body into doc_revision on a real body change only", async () => {
		const board = await seedGuildBoard();
		await pool.query(
			`INSERT INTO kumiai_doc (id, workspace_id, slug, title, body, created_at, updated_at) VALUES ('d1', $1, 'page', 'Page', 'v1', now(), now())`,
			[board.workspaceId],
		);
		await pool.query(`UPDATE kumiai_doc SET body = 'v1' WHERE id = 'd1'`);
		await pool.query(`UPDATE kumiai_doc SET body = 'v2' WHERE id = 'd1'`);
		await pool.query(`UPDATE kumiai_doc SET status = 'superseded' WHERE id = 'd1'`);
		const revisions = await all<{ body: string; status: string }>(`SELECT body, status FROM kumiai_doc_revision`);
		expect(revisions).toEqual([{ body: "v1", status: "current" }]);
		const verbs = (await events(board, "subject_type = 'doc'")).map((r) => [r.verb, r.payload]);
		expect(verbs).toEqual([
			["documented", { title: "Page" }],
			["documented", { title: "Page" }],
			["moved", { from: "current", to: "superseded", kind: "reference" }],
		]);
	});

	it("records node moves, deviations, gate decisions, coverage inspections and unlinks", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const gateNode = await addNode(req, "gate-plan", { kind: "gate" });
		await addGate(gateNode, "Approve the plan?");
		await pool.query(
			`INSERT INTO kumiai_graph_deviation (requirement_id, kind, node_key, reason, created_at) VALUES ($1, 'drop-node', 'review', 'docs only', now())`,
			[req.id],
		);
		await pool.query(`UPDATE kumiai_gate SET status = 'approved', decision = 'yes', decided_at = now() WHERE node_id = $1`, [
			gateNode.id,
		]);
		await pool.query(`UPDATE kumiai_graph_node SET status = 'done' WHERE id = $1`, [gateNode.id]);
		await pool.query(`INSERT INTO kumiai_coverage (id, workspace_id, key, area, risk) VALUES ('c1', $1, 'checkout', 'Checkout', 'high')`, [
			board.workspaceId,
		]);
		await pool.query(`UPDATE kumiai_coverage SET notes = 'n' WHERE id = 'c1'`); // not an inspection
		await pool.query(`UPDATE kumiai_coverage SET last_inspected_at = '2026-10-01T00:00:00' WHERE id = 'c1'`);
		await pool.query(
			`INSERT INTO kumiai_knowledge_edge (workspace_id, rel, from_type, from_id, to_type, to_id, created_by, created_at)
			 VALUES ($1, 'evidence-for', 'coverage', 'checkout', 'doc', 'gone', 'qa', now())`,
			[board.workspaceId],
		);
		await pool.query(`DELETE FROM kumiai_knowledge_edge`);

		const rows = (await events(board, "verb <> 'created' OR subject_type = 'coverage'")).map((r) => [
			r.verb,
			r.subject_type,
			r.subject_id,
			r.payload,
		]);
		expect(rows).toEqual([
			["deviated", "requirement", "REQ-001", { kind: "drop-node", node_key: "review", reason: "docs only" }],
			["decided", "gate", "REQ-001/gate-plan", { from: "pending", to: "approved", kind: "approve", decision: "yes" }],
			[
				"node-moved",
				"graph_node",
				"REQ-001/gate-plan",
				{ from: "pending", to: "done", requirement_id: "REQ-001", node_key: "gate-plan", task_id: null },
			],
			["created", "coverage", "checkout", { risk: "high", spec_path: null }],
			["inspected", "coverage", "checkout", { from: null, to: "2026-10-01T00:00:00Z", risk: "high" }],
			["linked", "coverage", "checkout", { rel: "evidence-for", to_type: "doc", to_id: "gone", note: "" }],
			["unlinked", "coverage", "checkout", { rel: "evidence-for", to_type: "doc", to_id: "gone" }],
		]);
	});

	it("records deletes, and stamps updated_at when the writer did not", async () => {
		const board = await seedGuildBoard();
		const req = await addRequirement(board);
		const task = await addTask(board, req.id);
		await pool.query(`UPDATE kumiai_tasks SET updated_at = '2020-01-01' WHERE id = $1`, [task.id]);
		await pool.query(`UPDATE kumiai_tasks SET title = 'T2' WHERE id = $1`, [task.id]);
		const touched = await one<{ year: number }>(`SELECT extract(year FROM updated_at)::int AS year FROM kumiai_tasks WHERE id = $1`, [
			task.id,
		]);
		expect(touched.year).toBeGreaterThan(2020);
		await pool.query(`DELETE FROM kumiai_tasks WHERE id = $1`, [task.id]);
		const [deleted] = await events(board, "verb = 'deleted'");
		expect(deleted).toMatchObject({ subject_type: "task", subject_id: "TASK-001", payload: { title: "T2", status: "todo" } });
	});

	it("seeds guild_state for every new workspace", async () => {
		const board = await seedGuildBoard();
		const rows = await all<{ key: string; value: string }>(
			`SELECT key, value FROM kumiai_guild_state WHERE workspace_id = $1 ORDER BY key`,
			[board.workspaceId],
		);
		expect(rows).toEqual([
			{ key: "actor", value: "orchestrator" },
			{ key: "last-checkin", value: "null" },
		]);
	});
});
