import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
	GuildImportError,
	importGuildSource,
	loadSource,
} from "../../src/guild/tursodb-import.js";
import { pool } from "../helpers/db.js";
import { T, buildSource } from "../helpers/guild-source.js";
import { all, one } from "../helpers/guild.js";
import { seedKumiaiWorkspace, seedTeamWithBoard } from "../helpers/seed.js";

async function emptyWorkspace(): Promise<{ teamId: string; workspaceId: string }> {
	const { team } = await seedTeamWithBoard({ domain: `import-${Math.random().toString(36).slice(2)}.test.com`, members: [] });
	const workspace = await seedKumiaiWorkspace(team.id);
	return { teamId: team.id, workspaceId: workspace.id };
}

async function imported(source = buildSource()): Promise<{ workspaceId: string; teamId: string }> {
	const target = await emptyWorkspace();
	await importGuildSource(pool, source, { workspace: target.workspaceId });
	return target;
}

const iso = (column: string): string => `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

describe("guild tursodb import", () => {
	it("writes every table with the guild's keys, and counts them", async () => {
		const target = await emptyWorkspace();
		const report = await importGuildSource(pool, buildSource(), { workspace: target.workspaceId });

		expect(report).toMatchObject({ workspaceId: target.workspaceId, workspaceCreated: false, dryRun: false });
		expect(report.counts).toMatchObject({
			goal: 1,
			project: 1,
			requirement: 2,
			plan: 1,
			task: 3,
			task_dependency: 1,
			task_capability: 2,
			graph_node: 2,
			graph_edge: 1,
			graph_deviation: 1,
			gate: 1,
			work_log: 2,
			review_finding: 1,
			bug: 1,
			coverage: 1,
			inspection: 1,
			inspection_coverage: 1,
			doc: 1,
			doc_revision: 1,
			knowledge_edge: 2,
			event: 3,
		});

		const tasks = await all<{ key: string; files: string[]; status: string }>(
			"SELECT key, files, status FROM kumiai_tasks WHERE workspace_id = $1 ORDER BY key",
			[target.workspaceId],
		);
		expect(tasks.map((t) => t.key)).toEqual(["TASK-001", "TASK-002", "TASK-003"]);
		expect(tasks[1]?.files).toEqual(["src/a.ts", "src/b.ts"]);

		// The unaffiliated requirement belongs to the target workspace, not the team default.
		const loose = await one<{ workspace_id: string; project_id: string | null }>(
			"SELECT workspace_id, project_id FROM kumiai_requirements WHERE key = 'REQ-002' AND workspace_id = $1",
			[target.workspaceId],
		);
		expect(loose.project_id).toBeNull();
	});

	it("maps the guild's columns onto Kumiai's", async () => {
		const { workspaceId } = await imported();

		const project = await one<{ priority: string; concurrent: boolean; isolation: string; worktree_path: string; impact: number; effort: number }>(
			"SELECT priority, concurrent, isolation, worktree_path, impact, effort FROM kumiai_projects WHERE workspace_id = $1",
			[workspaceId],
		);
		expect(project).toEqual({ priority: "low", concurrent: true, isolation: "worktree", worktree_path: "/tmp/wt", impact: 50, effort: 5 });

		const caps = await all<{ capability: string; required: boolean }>(
			"SELECT capability, required FROM kumiai_task_capability WHERE workspace_id = $1 ORDER BY capability",
			[workspaceId],
		);
		expect(caps).toEqual([
			{ capability: "svelte", required: true },
			{ capability: "tests", required: false },
		]);

		const dep = await one<{ task: string; depends_on: string }>(
			`SELECT t.key AS task, d.key AS depends_on FROM kumiai_task_dependency td
			   JOIN kumiai_tasks t ON t.id = td.task_id JOIN kumiai_tasks d ON d.id = td.depends_on
			  WHERE td.workspace_id = $1`,
			[workspaceId],
		);
		expect(dep).toEqual({ task: "TASK-002", depends_on: "TASK-001" });

		const node = await one<{ key: string; node_key: string; task: string }>(
			`SELECT n.key, n.node_key, t.key AS task FROM kumiai_graph_node n JOIN kumiai_tasks t ON t.id = n.task_id
			  WHERE n.workspace_id = $1`,
			[workspaceId],
		);
		expect(node).toEqual({ key: "REQ-001/implement.TASK-002", node_key: "implement", task: "TASK-002" });
	});

	it("links a plan to its task and gate node and keeps its timestamps", async () => {
		const { workspaceId } = await imported();
		const plan = await one<{ task: string; gate: string; updated: string; created: string; approved: string }>(
			`SELECT t.key AS task, n.key AS gate, ${iso("p.updated_at")} AS updated, ${iso("p.created_at")} AS created,
			        ${iso("p.approved_at")} AS approved
			   FROM kumiai_plans p JOIN kumiai_tasks t ON t.id = p.task_id JOIN kumiai_graph_node n ON n.id = p.gate_node_id
			  WHERE p.workspace_id = $1`,
			[workspaceId],
		);
		expect(plan).toEqual({
			task: "TASK-001",
			gate: "REQ-001/gate-plan",
			updated: "2026-10-03T10:00:00Z",
			created: "2026-10-02T09:00:00Z",
			approved: "2026-10-03T10:00:00Z",
		});
		// And the task that follows the plan points back at it.
		const task = await one<{ plan: string }>(
			`SELECT p.key AS plan FROM kumiai_tasks t JOIN kumiai_plans p ON p.id = t.plan_id
			  WHERE t.workspace_id = $1 AND t.key = 'TASK-002'`,
			[workspaceId],
		);
		expect(task.plan).toBe("PLAN-001");
	});

	it("replaces the trigger-written events with the source's own feed", async () => {
		const { workspaceId } = await imported();
		const events = await all<{ ts: string; actor: string; verb: string; subject_id: string }>(
			`SELECT ${iso("ts")} AS ts, actor, verb, subject_id FROM kumiai_event WHERE workspace_id = $1 ORDER BY id`,
			[workspaceId],
		);
		expect(events).toEqual([
			{ ts: "2026-10-01T09:00:00Z", actor: "orchestrator", verb: "created", subject_id: "GOAL-001" },
			{ ts: "2026-10-02T09:30:00Z", actor: "reviewer-security", verb: "found", subject_id: "TASK-002" },
			// its own time was never filled in, so it takes the one before
			{ ts: "2026-10-02T09:30:00Z", actor: "strategist", verb: "logged", subject_id: "TASK-001" },
		]);
	});

	it("renumbers review findings everywhere they are named", async () => {
		const { workspaceId } = await imported();
		const finding = await one<{ id: string }>("SELECT id::text FROM kumiai_review_finding WHERE workspace_id = $1", [workspaceId]);
		const edge = await one<{ from_id: string }>(
			"SELECT from_id FROM kumiai_knowledge_edge WHERE workspace_id = $1 AND rel = 'evidence-for'",
			[workspaceId],
		);
		const event = await one<{ finding_id: number }>(
			"SELECT (payload->>'finding_id')::int AS finding_id FROM kumiai_event WHERE workspace_id = $1 AND verb = 'found'",
			[workspaceId],
		);
		expect(edge.from_id).toBe(finding.id);
		expect(String(event.finding_id)).toBe(finding.id);
	});

	it("keeps the repaired time of rows whose own time was unusable, and says so", async () => {
		const target = await emptyWorkspace();
		const report = await importGuildSource(pool, buildSource(), { workspace: target.workspaceId });
		expect(report.warnings).toEqual(
			expect.arrayContaining([
				expect.stringContaining("work_log.ts"),
				expect.stringContaining("event.ts"),
				expect.stringContaining("priority 5"),
			]),
		);
		const log = await all<{ ts: string }>(
			`SELECT ${iso("ts")} AS ts FROM kumiai_work_log WHERE workspace_id = $1 ORDER BY id`,
			[target.workspaceId],
		);
		expect(log.map((r) => r.ts)).toEqual(["2026-10-02T09:00:00Z", "2026-10-02T09:00:00Z"]);
	});

	it("moves the key counters past the imported keys and carries guild_state over", async () => {
		const { workspaceId } = await imported();
		expect((await one<{ key: string }>("SELECT kumiai_allocate_key($1, 'TASK') AS key", [workspaceId])).key).toBe("TASK-004");
		expect((await one<{ key: string }>("SELECT kumiai_allocate_key($1, 'REQ') AS key", [workspaceId])).key).toBe("REQ-003");

		const state = await all<{ key: string; value: string }>(
			"SELECT key, value FROM kumiai_guild_state WHERE workspace_id = $1 ORDER BY key",
			[workspaceId],
		);
		expect(state).toEqual([
			{ key: "actor", value: "orchestrator" },
			{ key: "graph-template:REQ-001", value: "standard" },
			{ key: "last-checkin", value: T("03") },
		]);
	});

	it("reads the same through the warehouse views", async () => {
		const { workspaceId } = await imported();
		const brief = await all<{ fact: string; value: string }>(
			"SELECT fact, value FROM kumiai_v_brief WHERE workspace_id = $1",
			[workspaceId],
		);
		const fact = (name: string): string | undefined => brief.find((row) => row.fact === name)?.value;
		expect(fact("tasks_in_progress")).toBe("1");
		expect(fact("tasks_todo")).toBe("1");
		expect(fact("tasks_done")).toBe("1");
		expect(fact("findings_open")).toBe("1");
		expect(fact("bugs_open")).toBe("1");
	});

	it("writes nothing on a dry run, not even the workspace it would have created", async () => {
		const { team } = await seedTeamWithBoard({ domain: `dry-${Math.random().toString(36).slice(2)}.test.com`, members: [] });
		const report = await importGuildSource(pool, buildSource(), {
			workspace: "dry-run-workspace",
			teamId: team.id,
			createWorkspace: true,
			dryRun: true,
		});
		expect(report).toMatchObject({ dryRun: true, workspaceCreated: true });
		expect(report.counts["task"]).toBe(3);
		expect(await all("SELECT 1 FROM kumiai_workspaces WHERE team_id = $1 AND name = 'dry-run-workspace'", [team.id])).toHaveLength(0);
	});

	it("creates the workspace on request, in the given team", async () => {
		const { team } = await seedTeamWithBoard({ domain: `new-${Math.random().toString(36).slice(2)}.test.com`, members: [] });
		const report = await importGuildSource(pool, buildSource(), {
			workspace: "tenor",
			teamId: team.id,
			createWorkspace: true,
		});
		expect(report.workspaceCreated).toBe(true);
		const workspace = await one<{ id: string; is_default: boolean }>(
			"SELECT id, is_default FROM kumiai_workspaces WHERE team_id = $1 AND name = 'tenor'",
			[team.id],
		);
		expect(workspace).toEqual({ id: report.workspaceId, is_default: false });
		expect(await all("SELECT 1 FROM kumiai_goals WHERE workspace_id = $1", [workspace.id])).toHaveLength(1);
	});

	it("finds the workspace by name, within a team", async () => {
		const { team } = await seedTeamWithBoard({ domain: `name-${Math.random().toString(36).slice(2)}.test.com`, members: [] });
		const workspace = await seedKumiaiWorkspace(team.id, { name: "by-name", isDefault: false });
		const report = await importGuildSource(pool, buildSource(), { workspace: "by-name", teamId: team.id });
		expect(report.workspaceId).toBe(workspace.id);
	});

	describe("refuses", () => {
		it("a workspace that already holds guild data, and leaves it as it was", async () => {
			const target = await imported();
			await expect(
				importGuildSource(pool, buildSource(), { workspace: target.workspaceId }),
			).rejects.toThrow(/already holds guild data/);
			expect(await all("SELECT 1 FROM kumiai_goals WHERE workspace_id = $1", [target.workspaceId])).toHaveLength(1);
		});

		it("an unknown workspace unless asked to create it, and creating without a team", async () => {
			await expect(importGuildSource(pool, buildSource(), { workspace: "nope" })).rejects.toThrow(
				/no workspace with id or name "nope"/,
			);
			await expect(
				importGuildSource(pool, buildSource(), { workspace: "nope", createWorkspace: true }),
			).rejects.toThrow(/needs the team/);
		});

		it("a workspace name that two teams share, and a workspace of another team", async () => {
			const a = await seedTeamWithBoard({ domain: `a-${Math.random().toString(36).slice(2)}.test.com`, members: [] });
			const b = await seedTeamWithBoard({ domain: `b-${Math.random().toString(36).slice(2)}.test.com`, members: [] });
			const name = `shared-${Math.random().toString(36).slice(2)}`;
			const first = await seedKumiaiWorkspace(a.team.id, { name, isDefault: false });
			await seedKumiaiWorkspace(b.team.id, { name, isDefault: false });
			await expect(importGuildSource(pool, buildSource(), { workspace: name })).rejects.toThrow(
				/2 workspaces are named/,
			);
			await expect(
				importGuildSource(pool, buildSource(), { workspace: first.id, teamId: b.team.id }),
			).rejects.toThrow(/belongs to team/);
		});

		it("a file of another schema version", () => {
			expect(() => buildSource({ version: 8 })).toThrow(GuildImportError);
			expect(() => buildSource({ version: 8 })).toThrow(/unsupported guild schema version 8/);
		});

		it("a file that is not a guild database", () => {
			expect(() => loadSource(new DatabaseSync(":memory:"))).toThrow(/not a guild database/);
		});
	});

	it("rolls everything back when a row points at nothing", async () => {
		const source = buildSource();
		source.task.push({ ...(source.task[0] as Record<string, unknown>), id: "TASK-099", requirement_id: "REQ-404" });
		const { team } = await seedTeamWithBoard({ domain: `bad-${Math.random().toString(36).slice(2)}.test.com`, members: [] });
		await expect(
			importGuildSource(pool, source, { workspace: "half-way", teamId: team.id, createWorkspace: true }),
		).rejects.toThrow(/task: task TASK-099 points at REQ-404, which is not in the file/);
		expect(await all("SELECT 1 FROM kumiai_workspaces WHERE team_id = $1 AND name = 'half-way'", [team.id])).toHaveLength(0);
	});

	it("rolls everything back when Kumiai rejects a row", async () => {
		const source = buildSource();
		(source.task[0] as Record<string, unknown>)["status"] = "finished";
		const target = await emptyWorkspace();
		await expect(importGuildSource(pool, source, { workspace: target.workspaceId })).rejects.toThrow(
			/^task: /,
		);
		expect(await all("SELECT 1 FROM kumiai_goals WHERE workspace_id = $1", [target.workspaceId])).toHaveLength(0);
		expect(await all("SELECT 1 FROM kumiai_event WHERE workspace_id = $1", [target.workspaceId])).toHaveLength(0);
	});
});
