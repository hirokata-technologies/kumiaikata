import { describe, it, expect } from "vitest";
import { pool } from "../../../test/helpers/db.js";
import {
	seedUser,
	seedTeamWithBoard,
	seedKumiaiGoal,
	seedKumiaiProject,
	seedKumiaiRequirement,
} from "../../../test/helpers/seed.js";
import { guildTools } from "./index.js";
import { GuildError } from "../registry.js";

async function setup(domain = "direction.test") {
	const user = await seedUser();
	const { team } = await seedTeamWithBoard({ domain, members: [{ userId: user.id, role: "owner" }] });
	const goal = await seedKumiaiGoal(team.id);
	return { caller: { userId: user.id, teamId: team.id }, teamId: team.id, ws: goal.workspaceId, goal };
}

type Caller = Awaited<ReturnType<typeof setup>>["caller"];

async function call(caller: Caller, name: string, input: Record<string, unknown>) {
	const tool = guildTools.find((t) => t.name === name);
	if (!tool) throw new Error(`no tool ${name}`);
	return tool.handler({ caller }, tool.input.parse(input));
}

async function keysOf(table: "kumiai_goals" | "kumiai_projects" | "kumiai_requirements") {
	const { rows } = await pool.query<{ key: string }>(`SELECT key FROM ${table} ORDER BY key`);
	return rows.map((r) => r.key);
}

async function danglingEdges(): Promise<number> {
	const { rows } = await pool.query<{ n: string }>("SELECT count(*) AS n FROM kumiai_v_knowledge_dangling");
	return Number(rows[0]!.n);
}

async function rejects(p: Promise<unknown>): Promise<GuildError> {
	const err = await p.then(
		() => null,
		(e: unknown) => e,
	);
	expect(err).toBeInstanceOf(GuildError);
	return err as GuildError;
}

describe("delete_project / delete_projects", () => {
	it("deletes a project and detaches its requirements instead of deleting them", async () => {
		const { caller, teamId, ws, goal } = await setup();
		const project = await seedKumiaiProject(teamId, goal.id);
		const req = await seedKumiaiRequirement(teamId, { projectId: project.id });

		const result = await call(caller, "delete_project", { workspace: ws, actor: "orchestrator", key: project.key });

		expect(result).toEqual({ deleted: [project.key], requirements_detached: [req.key] });
		expect(await keysOf("kumiai_projects")).toEqual([]);
		const { rows } = await pool.query<{ project_id: string | null }>(
			"SELECT project_id FROM kumiai_requirements WHERE key = $1",
			[req.key],
		);
		expect(rows[0]!.project_id).toBeNull();
	});

	it("removes the knowledge edges that name the project", async () => {
		const { caller, teamId, ws, goal } = await setup();
		const project = await seedKumiaiProject(teamId, goal.id);
		await call(caller, "upsert_doc", { workspace: ws, actor: "librarian", slug: "project-notes", title: "Notes", body: "x" });
		await call(caller, "link", {
			workspace: ws,
			actor: "librarian",
			rel: "describes",
			from: { type: "doc", id: "project-notes" },
			to: { type: "project", id: project.key },
		});

		await call(caller, "delete_project", { workspace: ws, actor: "orchestrator", key: project.key });

		expect(await danglingEdges()).toBe(0);
	});

	it("deletes several projects at once", async () => {
		const { caller, teamId, ws, goal } = await setup();
		const a = await seedKumiaiProject(teamId, goal.id);
		const b = await seedKumiaiProject(teamId, goal.id);
		const c = await seedKumiaiProject(teamId, goal.id);

		const result = await call(caller, "delete_projects", {
			workspace: ws,
			actor: "orchestrator",
			keys: [a.key, b.key, a.key],
		});

		expect(result).toEqual({ deleted: [a.key, b.key], requirements_detached: [] });
		expect(await keysOf("kumiai_projects")).toEqual([c.key]);
	});

	it("deletes nothing when any key is missing, and names every missing key", async () => {
		const { caller, teamId, ws, goal } = await setup();
		const a = await seedKumiaiProject(teamId, goal.id);

		const err = await rejects(
			call(caller, "delete_projects", { workspace: ws, actor: "orchestrator", keys: [a.key, "PROJ-998", "PROJ-999"] }),
		);

		expect(err.code).toBe("NOT_FOUND");
		expect(err.message).toContain("PROJ-998, PROJ-999");
		expect(await keysOf("kumiai_projects")).toEqual([a.key]);
	});

	it("honours expect_status", async () => {
		const { caller, teamId, ws, goal } = await setup();
		const p = await seedKumiaiProject(teamId, goal.id, { status: "in-progress" });

		const err = await rejects(
			call(caller, "delete_project", { workspace: ws, actor: "orchestrator", key: p.key, expect_status: "done" }),
		);

		expect(err.code).toBe("CONFLICT");
		expect(await keysOf("kumiai_projects")).toEqual([p.key]);
	});

	it("refuses an empty or oversized key list", async () => {
		const { caller, ws } = await setup();
		const tool = guildTools.find((t) => t.name === "delete_projects")!;
		expect(tool.input.safeParse({ workspace: ws, actor: "x", keys: [] }).success).toBe(false);
		expect(
			tool.input.safeParse({ workspace: ws, actor: "x", keys: Array.from({ length: 101 }, (_, i) => `PROJ-${i}`) }).success,
		).toBe(false);
		void caller;
	});

	it("is FORBIDDEN in another team's workspace", async () => {
		const mine = await setup("mine.test");
		const theirs = await setup("theirs.test");
		const project = await seedKumiaiProject(theirs.teamId, theirs.goal.id);

		const err = await rejects(
			call(mine.caller, "delete_project", { workspace: theirs.ws, actor: "orchestrator", key: project.key }),
		);

		expect(err.code).toBe("FORBIDDEN");
		expect(await keysOf("kumiai_projects")).toEqual([project.key]);
	});
});

describe("delete_goal / delete_goals", () => {
	it("deletes a goal with no projects", async () => {
		const { caller, ws, goal } = await setup();

		const result = await call(caller, "delete_goal", { workspace: ws, actor: "orchestrator", key: goal.key });

		expect(result).toEqual({ deleted: [goal.key], projects_deleted: [], requirements_detached: [] });
		expect(await keysOf("kumiai_goals")).toEqual([]);
	});

	it("is CONFLICT while the goal has projects, and deletes nothing", async () => {
		const { caller, teamId, ws, goal } = await setup();
		const project = await seedKumiaiProject(teamId, goal.id);

		const err = await rejects(call(caller, "delete_goal", { workspace: ws, actor: "orchestrator", key: goal.key }));

		expect(err.code).toBe("CONFLICT");
		expect(err.message).toContain(project.key);
		expect(await keysOf("kumiai_goals")).toEqual([goal.key]);
		expect(await keysOf("kumiai_projects")).toEqual([project.key]);
	});

	it("cascades to projects on request and detaches their requirements", async () => {
		const { caller, teamId, ws, goal } = await setup();
		const p1 = await seedKumiaiProject(teamId, goal.id);
		const p2 = await seedKumiaiProject(teamId, goal.id);
		const req = await seedKumiaiRequirement(teamId, { projectId: p1.id });

		const result = await call(caller, "delete_goal", {
			workspace: ws,
			actor: "orchestrator",
			key: goal.key,
			cascade_projects: true,
		});

		expect(result).toEqual({
			deleted: [goal.key],
			projects_deleted: [p1.key, p2.key],
			requirements_detached: [req.key],
		});
		expect(await keysOf("kumiai_goals")).toEqual([]);
		expect(await keysOf("kumiai_projects")).toEqual([]);
		expect(await keysOf("kumiai_requirements")).toEqual([req.key]);
	});

	it("removes the knowledge edges that name the goal", async () => {
		const { caller, ws, goal } = await setup();
		await call(caller, "upsert_doc", { workspace: ws, actor: "librarian", slug: "goal-notes", title: "Notes", body: "x" });
		await call(caller, "link", {
			workspace: ws,
			actor: "librarian",
			rel: "describes",
			from: { type: "doc", id: "goal-notes" },
			to: { type: "goal", id: goal.key },
		});

		await call(caller, "delete_goal", { workspace: ws, actor: "orchestrator", key: goal.key });

		expect(await danglingEdges()).toBe(0);
	});

	it("deletes several goals in one transaction, or none", async () => {
		const { caller, teamId, ws, goal } = await setup();
		const second = await seedKumiaiGoal(teamId);
		const third = await seedKumiaiGoal(teamId);

		const err = await rejects(
			call(caller, "delete_goals", { workspace: ws, actor: "orchestrator", keys: [goal.key, "GOAL-999"] }),
		);
		expect(err.code).toBe("NOT_FOUND");
		expect(await keysOf("kumiai_goals")).toEqual([goal.key, second.key, third.key]);

		const result = await call(caller, "delete_goals", {
			workspace: ws,
			actor: "orchestrator",
			keys: [goal.key, second.key],
		});
		expect(result).toEqual({ deleted: [goal.key, second.key], projects_deleted: [], requirements_detached: [] });
		expect(await keysOf("kumiai_goals")).toEqual([third.key]);
	});

	it("does not delete any goal when one of several still has projects", async () => {
		const { caller, teamId, ws, goal } = await setup();
		const busy = await seedKumiaiGoal(teamId);
		await seedKumiaiProject(teamId, busy.id);

		const err = await rejects(
			call(caller, "delete_goals", { workspace: ws, actor: "orchestrator", keys: [goal.key, busy.key] }),
		);

		expect(err.code).toBe("CONFLICT");
		expect(await keysOf("kumiai_goals")).toEqual([goal.key, busy.key]);
	});

	it("writes a deleted event for the goal and each project", async () => {
		const { caller, teamId, ws, goal } = await setup();
		const project = await seedKumiaiProject(teamId, goal.id);

		await call(caller, "delete_goals", { workspace: ws, actor: "orchestrator", keys: [goal.key], cascade_projects: true });

		const { rows } = await pool.query<{ subject_type: string; subject_id: string }>(
			"SELECT subject_type, subject_id FROM kumiai_event WHERE verb = 'deleted' ORDER BY subject_type",
		);
		expect(rows).toEqual([
			{ subject_type: "goal", subject_id: goal.key },
			{ subject_type: "project", subject_id: project.key },
		]);
	});
});
