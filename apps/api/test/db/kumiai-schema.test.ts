import { describe, it, expect } from "vitest";
import {
	pool,
	seedUser,
	seedTeamWithBoard,
	seedKumiaiGoal,
	seedKumiaiProject,
	seedKumiaiRequirement,
	seedKumiaiPlan,
	seedKumiaiTask,
} from "../helpers/index.js";

let domainCounter = 0;

async function seedTeam(): Promise<string> {
	domainCounter += 1;
	const { team } = await seedTeamWithBoard({
		domain: `kumiai-schema-${domainCounter}.test.com`,
		members: [],
	});
	return team.id;
}

describe("kumiai_projects.goal_id", () => {
	it("rejects deleting a goal that still has projects (onDelete: restrict)", async () => {
		const teamId = await seedTeam();
		const goal = await seedKumiaiGoal(teamId);
		await seedKumiaiProject(teamId, goal.id);

		await expect(pool.query(`DELETE FROM kumiai_goals WHERE id = $1`, [goal.id])).rejects.toThrow();
	});

	it("allows deleting a goal with no projects", async () => {
		const teamId = await seedTeam();
		const goal = await seedKumiaiGoal(teamId);

		await expect(pool.query(`DELETE FROM kumiai_goals WHERE id = $1`, [goal.id])).resolves.toBeDefined();
	});
});

describe("nullable relations", () => {
	it("inserts a requirement with a null projectId", async () => {
		const teamId = await seedTeam();

		const requirement = await seedKumiaiRequirement(teamId, { projectId: null });

		expect(requirement.projectId).toBeNull();
	});

	it("inserts a plan with a null taskId", async () => {
		const teamId = await seedTeam();
		const requirement = await seedKumiaiRequirement(teamId);

		const plan = await seedKumiaiPlan(teamId, requirement.id, { taskId: null });

		expect(plan.taskId).toBeNull();
	});
});

describe("kumiai_projects constraints", () => {
	it("rejects impact outside 1-100", async () => {
		const teamId = await seedTeam();
		const goal = await seedKumiaiGoal(teamId);

		await expect(seedKumiaiProject(teamId, goal.id, { impact: 0 })).rejects.toThrow();
		await expect(seedKumiaiProject(teamId, goal.id, { impact: 101 })).rejects.toThrow();
	});

	it("rejects effort outside 1-10", async () => {
		const teamId = await seedTeam();
		const goal = await seedKumiaiGoal(teamId);

		await expect(seedKumiaiProject(teamId, goal.id, { effort: 0 })).rejects.toThrow();
		await expect(seedKumiaiProject(teamId, goal.id, { effort: 11 })).rejects.toThrow();
	});

	it("rejects a blocked status without a blocked reason", async () => {
		const teamId = await seedTeam();
		const goal = await seedKumiaiGoal(teamId);

		await expect(
			seedKumiaiProject(teamId, goal.id, { status: "blocked", blockedReason: null }),
		).rejects.toThrow();
		await expect(
			seedKumiaiProject(teamId, goal.id, { status: "blocked", blockedReason: "   " }),
		).rejects.toThrow();
	});

	it("allows a blocked status with a non-empty blocked reason", async () => {
		const teamId = await seedTeam();
		const goal = await seedKumiaiGoal(teamId);

		const project = await seedKumiaiProject(teamId, goal.id, {
			status: "blocked",
			blockedReason: "Waiting on design",
		});

		expect(project.status).toBe("blocked");
		expect(project.blockedReason).toBe("Waiting on design");
	});

	it("rejects a partially-filled target window", async () => {
		const teamId = await seedTeam();
		const goal = await seedKumiaiGoal(teamId);

		await expect(
			seedKumiaiProject(teamId, goal.id, { targetWindowKind: "week", targetWindowLabel: null }),
		).rejects.toThrow();
	});

	it("allows an all-null target window", async () => {
		const teamId = await seedTeam();
		const goal = await seedKumiaiGoal(teamId);

		const project = await seedKumiaiProject(teamId, goal.id);

		expect(project.targetWindowKind).toBeNull();
	});

	it("allows an all-filled target window", async () => {
		const teamId = await seedTeam();
		const goal = await seedKumiaiGoal(teamId);

		const project = await seedKumiaiProject(teamId, goal.id, {
			targetWindowKind: "quarter",
			targetWindowLabel: "Q1",
			targetWindowYear: 2026,
			targetWindowNumber: 1,
		});

		expect(project.targetWindowKind).toBe("quarter");
	});
});

describe("kumiai_recent_projects", () => {
	it("upserts on the composite primary key (userId, projectId)", async () => {
		const teamId = await seedTeam();
		const goal = await seedKumiaiGoal(teamId);
		const project = await seedKumiaiProject(teamId, goal.id);
		const user = await seedUser();
		const userId = user.id;

		const firstOpenedAt = new Date("2026-01-01T00:00:00Z");
		const secondOpenedAt = new Date("2026-01-02T00:00:00Z");

		await pool.query(
			`INSERT INTO kumiai_recent_projects (user_id, project_id, opened_at) VALUES ($1, $2, $3)`,
			[userId, project.id, firstOpenedAt],
		);
		await pool.query(
			`INSERT INTO kumiai_recent_projects (user_id, project_id, opened_at) VALUES ($1, $2, $3)
			 ON CONFLICT (user_id, project_id) DO UPDATE SET opened_at = excluded.opened_at`,
			[userId, project.id, secondOpenedAt],
		);

		const { rows } = await pool.query<{ opened_at: Date }>(
			`SELECT opened_at FROM kumiai_recent_projects WHERE user_id = $1 AND project_id = $2`,
			[userId, project.id],
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]!.opened_at.toISOString()).toBe(secondOpenedAt.toISOString());
	});
});

describe("seedKumiaiTask", () => {
	it("seeds a task with a null planId", async () => {
		const teamId = await seedTeam();
		const requirement = await seedKumiaiRequirement(teamId);

		const task = await seedKumiaiTask(teamId, requirement.id, { planId: null });

		expect(task.planId).toBeNull();
	});
});
