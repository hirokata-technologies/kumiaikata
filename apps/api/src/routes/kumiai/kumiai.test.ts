import { describe, it, expect, beforeEach } from "vitest";
import { mockBetterAuth, setCurrentUser } from "../../../test/helpers/mock-session.js";
import { apiRequest } from "../../../test/helpers/request.js";
import {
	seedUser,
	seedTeamWithBoard,
	seedKumiaiGoal,
	seedKumiaiProject,
	seedKumiaiRequirement,
	seedKumiaiPlan,
	seedKumiaiTask,
} from "../../../test/helpers/seed.js";

mockBetterAuth();

import app from "../../app.js";

void app;

beforeEach(() => {
	setCurrentUser(null);
});

// ── Local helpers ─────────────────────────────────────────────────────────────

async function seedTeamMember(domain: string) {
	const user = await seedUser();
	const { team } = await seedTeamWithBoard({
		domain,
		members: [{ userId: user.id, role: "member" }],
	});
	return { user, team };
}

// ── 401 without session — every /api/kumiai route ─────────────────────────────

const ALL_ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
	{ method: "GET", path: "/api/kumiai/goals" },
	{ method: "GET", path: "/api/kumiai/goals/x" },
	{ method: "POST", path: "/api/kumiai/goals", body: { title: "x" } },
	{ method: "PATCH", path: "/api/kumiai/goals/x", body: { title: "x" } },
	{ method: "DELETE", path: "/api/kumiai/goals/x" },
	{ method: "GET", path: "/api/kumiai/projects" },
	{ method: "GET", path: "/api/kumiai/projects/x" },
	{ method: "POST", path: "/api/kumiai/projects", body: { goalId: "x", title: "x" } },
	{ method: "PATCH", path: "/api/kumiai/projects/x", body: { title: "x" } },
	{ method: "DELETE", path: "/api/kumiai/projects/x" },
	{ method: "GET", path: "/api/kumiai/requirements" },
	{ method: "GET", path: "/api/kumiai/requirements/x" },
	{ method: "POST", path: "/api/kumiai/requirements", body: { title: "x" } },
	{ method: "PATCH", path: "/api/kumiai/requirements/x", body: { title: "x" } },
	{ method: "DELETE", path: "/api/kumiai/requirements/x" },
	{ method: "GET", path: "/api/kumiai/plans" },
	{ method: "GET", path: "/api/kumiai/plans/x" },
	{ method: "POST", path: "/api/kumiai/plans", body: { requirementId: "x", title: "x" } },
	{ method: "PATCH", path: "/api/kumiai/plans/x", body: { title: "x" } },
	{ method: "DELETE", path: "/api/kumiai/plans/x" },
	{ method: "GET", path: "/api/kumiai/tasks" },
	{ method: "GET", path: "/api/kumiai/tasks/x" },
	{ method: "POST", path: "/api/kumiai/tasks", body: { requirementId: "x", title: "x" } },
	{ method: "PATCH", path: "/api/kumiai/tasks/x", body: { title: "x" } },
	{ method: "DELETE", path: "/api/kumiai/tasks/x" },
	{ method: "GET", path: "/api/kumiai/stats" },
	{ method: "GET", path: "/api/kumiai/search?q=a" },
	{ method: "GET", path: "/api/kumiai/recent-projects" },
	{ method: "POST", path: "/api/kumiai/recent-projects", body: { projectId: "x" } },
];

describe("401 without session — every /api/kumiai route", () => {
	it.each(ALL_ROUTES)("returns 401 for $method $path", async ({ method, path, body }) => {
		const res = await apiRequest(method, path, body !== undefined ? { body } : undefined);
		expect(res.status).toBe(401);
		const responseBody = (await res.json()) as { error: { code: string } };
		expect(responseBody.error.code).toBe("UNAUTHENTICATED");
	});
});

// ── loadTeamAccess ─────────────────────────────────────────────────────────────

describe("loadTeamAccess", () => {
	it("returns 403 for a user in no team workspace", async () => {
		const user = await seedUser();
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", "/api/kumiai/goals");
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("FORBIDDEN");
	});
});

// ── Goals CRUD ─────────────────────────────────────────────────────────────────

describe("Goals CRUD", () => {
	it("returns an empty array when the team has no goals", async () => {
		const { user } = await seedTeamMember("goals-empty.com");
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", "/api/kumiai/goals");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([]);
	});

	it("creates, lists, fetches, updates and deletes a goal", async () => {
		const { user } = await seedTeamMember("goals-crud.com");
		setCurrentUser({ id: user.id, email: user.email });

		const createRes = await apiRequest("POST", "/api/kumiai/goals", {
			body: { title: "Ship Kumiaikata", priority: 2 },
		});
		expect(createRes.status).toBe(201);
		const created = (await createRes.json()) as { id: string; title: string; status: string; priority: number };
		expect(created.title).toBe("Ship Kumiaikata");
		expect(created.status).toBe("todo");
		expect(created.priority).toBe(2);

		const listRes = await apiRequest("GET", "/api/kumiai/goals");
		expect(((await listRes.json()) as unknown[]).length).toBe(1);

		const getRes = await apiRequest("GET", `/api/kumiai/goals/${created.id}`);
		expect(getRes.status).toBe(200);

		const updateRes = await apiRequest("PATCH", `/api/kumiai/goals/${created.id}`, {
			body: { status: "in-progress" },
		});
		expect(updateRes.status).toBe(200);
		expect(((await updateRes.json()) as { status: string }).status).toBe("in-progress");

		const deleteRes = await apiRequest("DELETE", `/api/kumiai/goals/${created.id}`);
		expect(deleteRes.status).toBe(204);

		const getAfterDeleteRes = await apiRequest("GET", `/api/kumiai/goals/${created.id}`);
		expect(getAfterDeleteRes.status).toBe(404);
	});

	it("returns 404 deleting a goal that does not exist", async () => {
		const { user } = await seedTeamMember("goals-404.com");
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("DELETE", "/api/kumiai/goals/nonexistent");
		expect(res.status).toBe(404);
	});

	it("returns 404 updating and 404 fetching a goal that does not exist", async () => {
		const { user } = await seedTeamMember("goals-404-update.com");
		setCurrentUser({ id: user.id, email: user.email });

		const updateRes = await apiRequest("PATCH", "/api/kumiai/goals/nonexistent", {
			body: { title: "x" },
		});
		expect(updateRes.status).toBe(404);

		const getRes = await apiRequest("GET", "/api/kumiai/goals/nonexistent");
		expect(getRes.status).toBe(404);
	});

	it("updates title, body and priority together", async () => {
		const { user } = await seedTeamMember("goals-update-fields.com");
		setCurrentUser({ id: user.id, email: user.email });

		const createRes = await apiRequest("POST", "/api/kumiai/goals", {
			body: { title: "Original", body: "Original body", status: "in-progress" },
		});
		const created = (await createRes.json()) as { id: string };

		const updateRes = await apiRequest("PATCH", `/api/kumiai/goals/${created.id}`, {
			body: { title: "Renamed", body: "New body", priority: 5 },
		});
		expect(updateRes.status).toBe(200);
		const updated = (await updateRes.json()) as { title: string; body: string; priority: number };
		expect(updated.title).toBe("Renamed");
		expect(updated.body).toBe("New body");
		expect(updated.priority).toBe(5);
	});

	it("returns 422 when priority is out of range", async () => {
		const { user } = await seedTeamMember("goals-422.com");
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", "/api/kumiai/goals", {
			body: { title: "Bad", priority: 99 },
		});
		expect(res.status).toBe(422);
	});
});

// ── Projects CRUD ──────────────────────────────────────────────────────────────

describe("Projects CRUD", () => {
	it("returns 422 creating a blocked project without a blockedReason", async () => {
		const { user, team } = await seedTeamMember("projects-blocked-create.com");
		const goal = await seedKumiaiGoal(team.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", "/api/kumiai/projects", {
			body: { goalId: goal.id, title: "Blocked project", status: "blocked" },
		});
		expect(res.status).toBe(422);
	});

	it("returns 422 updating a project to blocked without a blockedReason", async () => {
		const { user, team } = await seedTeamMember("projects-blocked-update.com");
		const goal = await seedKumiaiGoal(team.id);
		const project = await seedKumiaiProject(team.id, goal.id, { status: "todo", blockedReason: null });
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("PATCH", `/api/kumiai/projects/${project.id}`, {
			body: { status: "blocked" },
		});
		expect(res.status).toBe(422);
	});

	it("returns 422 clearing the reason while staying blocked", async () => {
		const { user, team } = await seedTeamMember("projects-blocked-clear.com");
		const goal = await seedKumiaiGoal(team.id);
		const project = await seedKumiaiProject(team.id, goal.id, {
			status: "blocked",
			blockedReason: "Waiting on design",
		});
		setCurrentUser({ id: user.id, email: user.email });

		// status is NOT in this request — only the resolved (still-blocked) state
		// combined with an empty reason should be rejected.
		const res = await apiRequest("PATCH", `/api/kumiai/projects/${project.id}`, {
			body: { blockedReason: "" },
		});
		expect(res.status).toBe(422);
	});

	it("creates a blocked project with a non-empty reason, and round-trips a target window", async () => {
		const { user, team } = await seedTeamMember("projects-blocked-ok.com");
		const goal = await seedKumiaiGoal(team.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", "/api/kumiai/projects", {
			body: {
				goalId: goal.id,
				title: "Blocked but explained",
				status: "blocked",
				blockedReason: "Waiting on design",
				targetWindow: { kind: "month", label: "October", year: 2026, number: 10 },
			},
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as {
			blockedReason: string | null;
			targetWindow: { kind: string; label: string; year: number; number: number } | null;
		};
		expect(body.blockedReason).toBe("Waiting on design");
		expect(body.targetWindow).toEqual({ kind: "month", label: "October", year: 2026, number: 10 });
	});

	it("returns 404 creating a project against a goal in another team", async () => {
		const { user } = await seedTeamMember("projects-cross-a.com");
		const { team: otherTeam } = await seedTeamMember("projects-cross-b.com");
		const foreignGoal = await seedKumiaiGoal(otherTeam.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", "/api/kumiai/projects", {
			body: { goalId: foreignGoal.id, title: "Should fail" },
		});
		expect(res.status).toBe(404);
	});

	it("filters the project list by goalId and status", async () => {
		const { user, team } = await seedTeamMember("projects-filters.com");
		const goalA = await seedKumiaiGoal(team.id, { title: "Goal A" });
		const goalB = await seedKumiaiGoal(team.id, { title: "Goal B" });
		await seedKumiaiProject(team.id, goalA.id, { status: "todo" });
		await seedKumiaiProject(team.id, goalA.id, { status: "done" });
		await seedKumiaiProject(team.id, goalB.id, { status: "todo" });
		setCurrentUser({ id: user.id, email: user.email });

		const byGoal = await apiRequest("GET", `/api/kumiai/projects?goalId=${goalA.id}`);
		expect(((await byGoal.json()) as unknown[]).length).toBe(2);

		const byStatus = await apiRequest("GET", "/api/kumiai/projects?status=todo");
		expect(((await byStatus.json()) as unknown[]).length).toBe(2);

		const byBoth = await apiRequest("GET", `/api/kumiai/projects?goalId=${goalA.id}&status=todo`);
		expect(((await byBoth.json()) as unknown[]).length).toBe(1);
	});

	it("returns 422 for an unknown status filter value", async () => {
		const { user } = await seedTeamMember("projects-bad-filter.com");
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", "/api/kumiai/projects?status=bogus");
		expect(res.status).toBe(422);
	});

	it("returns 404 fetching, updating or deleting a project that does not exist in the team", async () => {
		const { user } = await seedTeamMember("projects-404.com");
		setCurrentUser({ id: user.id, email: user.email });

		expect((await apiRequest("GET", "/api/kumiai/projects/nonexistent")).status).toBe(404);
		expect(
			(await apiRequest("PATCH", "/api/kumiai/projects/nonexistent", { body: { title: "x" } })).status,
		).toBe(404);
		expect((await apiRequest("DELETE", "/api/kumiai/projects/nonexistent")).status).toBe(404);
	});

	it("moves a project to a different goal within the same team", async () => {
		const { user, team } = await seedTeamMember("projects-move-goal.com");
		const goalA = await seedKumiaiGoal(team.id);
		const goalB = await seedKumiaiGoal(team.id);
		const project = await seedKumiaiProject(team.id, goalA.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("PATCH", `/api/kumiai/projects/${project.id}`, {
			body: { goalId: goalB.id },
		});
		expect(res.status).toBe(200);
		expect(((await res.json()) as { goalId: string }).goalId).toBe(goalB.id);
	});

	it("returns 404 moving a project to a goal in another team", async () => {
		const { user, team } = await seedTeamMember("projects-move-goal-cross-a.com");
		const { team: otherTeam } = await seedTeamMember("projects-move-goal-cross-b.com");
		const goal = await seedKumiaiGoal(team.id);
		const project = await seedKumiaiProject(team.id, goal.id);
		const foreignGoal = await seedKumiaiGoal(otherTeam.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("PATCH", `/api/kumiai/projects/${project.id}`, {
			body: { goalId: foreignGoal.id },
		});
		expect(res.status).toBe(404);
	});

	it("updates ordinal, body, priority, impact and effort, then clears a target window", async () => {
		const { user, team } = await seedTeamMember("projects-update-fields.com");
		const goal = await seedKumiaiGoal(team.id);
		const project = await seedKumiaiProject(team.id, goal.id, {
			targetWindowKind: "week",
			targetWindowLabel: "Week 1",
			targetWindowYear: 2026,
			targetWindowNumber: 1,
		});
		setCurrentUser({ id: user.id, email: user.email });

		const updateRes = await apiRequest("PATCH", `/api/kumiai/projects/${project.id}`, {
			body: {
				ordinal: 3,
				body: "Updated body",
				priority: "high",
				impact: 80,
				effort: 8,
				targetWindow: null,
			},
		});
		expect(updateRes.status).toBe(200);
		const body = (await updateRes.json()) as {
			ordinal: number;
			body: string;
			priority: string;
			impact: number;
			effort: number;
			targetWindow: unknown;
		};
		expect(body.ordinal).toBe(3);
		expect(body.body).toBe("Updated body");
		expect(body.priority).toBe("high");
		expect(body.impact).toBe(80);
		expect(body.effort).toBe(8);
		expect(body.targetWindow).toBeNull();
	});
});

// ── Requirements CRUD ──────────────────────────────────────────────────────────

describe("Requirements CRUD", () => {
	it("creates, updates and deletes a requirement with no project", async () => {
		const { user } = await seedTeamMember("requirements-crud.com");
		setCurrentUser({ id: user.id, email: user.email });

		const createRes = await apiRequest("POST", "/api/kumiai/requirements", {
			body: { title: "Unaffiliated requirement" },
		});
		expect(createRes.status).toBe(201);
		const created = (await createRes.json()) as { id: string; projectId: string | null };
		expect(created.projectId).toBeNull();

		const updateRes = await apiRequest("PATCH", `/api/kumiai/requirements/${created.id}`, {
			body: { status: "done" },
		});
		expect(updateRes.status).toBe(200);

		const deleteRes = await apiRequest("DELETE", `/api/kumiai/requirements/${created.id}`);
		expect(deleteRes.status).toBe(204);
	});

	it("returns 404 creating a requirement against a project in another team", async () => {
		const { user } = await seedTeamMember("requirements-cross-a.com");
		const { team: otherTeam } = await seedTeamMember("requirements-cross-b.com");
		const foreignGoal = await seedKumiaiGoal(otherTeam.id);
		const foreignProject = await seedKumiaiProject(otherTeam.id, foreignGoal.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", "/api/kumiai/requirements", {
			body: { title: "Should fail", projectId: foreignProject.id },
		});
		expect(res.status).toBe(404);
	});

	it("fetches a requirement by id and moves it under a project in the same team", async () => {
		const { user, team } = await seedTeamMember("requirements-move.com");
		const goal = await seedKumiaiGoal(team.id);
		const project = await seedKumiaiProject(team.id, goal.id);
		const requirement = await seedKumiaiRequirement(team.id);
		setCurrentUser({ id: user.id, email: user.email });

		const getRes = await apiRequest("GET", `/api/kumiai/requirements/${requirement.id}`);
		expect(getRes.status).toBe(200);

		const updateRes = await apiRequest("PATCH", `/api/kumiai/requirements/${requirement.id}`, {
			body: { projectId: project.id, title: "Renamed requirement" },
		});
		expect(updateRes.status).toBe(200);
		const updated = (await updateRes.json()) as { projectId: string | null; title: string };
		expect(updated.projectId).toBe(project.id);
		expect(updated.title).toBe("Renamed requirement");
	});

	it("returns 404 fetching, updating or deleting a requirement that does not exist", async () => {
		const { user } = await seedTeamMember("requirements-404.com");
		setCurrentUser({ id: user.id, email: user.email });

		expect((await apiRequest("GET", "/api/kumiai/requirements/nonexistent")).status).toBe(404);
		expect(
			(await apiRequest("PATCH", "/api/kumiai/requirements/nonexistent", { body: { title: "x" } })).status,
		).toBe(404);
		expect((await apiRequest("DELETE", "/api/kumiai/requirements/nonexistent")).status).toBe(404);
	});

	it("returns 404 moving a requirement under a project in another team", async () => {
		const { user, team } = await seedTeamMember("requirements-move-cross-a.com");
		const { team: otherTeam } = await seedTeamMember("requirements-move-cross-b.com");
		const requirement = await seedKumiaiRequirement(team.id);
		const foreignGoal = await seedKumiaiGoal(otherTeam.id);
		const foreignProject = await seedKumiaiProject(otherTeam.id, foreignGoal.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("PATCH", `/api/kumiai/requirements/${requirement.id}`, {
			body: { projectId: foreignProject.id },
		});
		expect(res.status).toBe(404);
	});
});

// ── Plans CRUD ──────────────────────────────────────────────────────────────────

describe("Plans CRUD", () => {
	it("creates, updates and deletes a plan", async () => {
		const { user, team } = await seedTeamMember("plans-crud.com");
		const requirement = await seedKumiaiRequirement(team.id);
		setCurrentUser({ id: user.id, email: user.email });

		const createRes = await apiRequest("POST", "/api/kumiai/plans", {
			body: { requirementId: requirement.id, title: "Implementation plan" },
		});
		expect(createRes.status).toBe(201);
		const created = (await createRes.json()) as { id: string; approval: string };
		expect(created.approval).toBe("pending");

		const updateRes = await apiRequest("PATCH", `/api/kumiai/plans/${created.id}`, {
			body: { approval: "approved", approvedBy: user.id, approvedAt: new Date().toISOString() },
		});
		expect(updateRes.status).toBe(200);
		expect(((await updateRes.json()) as { approval: string }).approval).toBe("approved");

		const deleteRes = await apiRequest("DELETE", `/api/kumiai/plans/${created.id}`);
		expect(deleteRes.status).toBe(204);
	});

	it("returns 404 creating a plan against a requirement in another team", async () => {
		const { user } = await seedTeamMember("plans-cross-a.com");
		const { team: otherTeam } = await seedTeamMember("plans-cross-b.com");
		const foreignRequirement = await seedKumiaiRequirement(otherTeam.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", "/api/kumiai/plans", {
			body: { requirementId: foreignRequirement.id, title: "Should fail" },
		});
		expect(res.status).toBe(404);
	});

	it("creates a plan linked to a task in the same team and fetches it by id", async () => {
		const { user, team } = await seedTeamMember("plans-with-task.com");
		const requirement = await seedKumiaiRequirement(team.id);
		const task = await seedKumiaiTask(team.id, requirement.id);
		setCurrentUser({ id: user.id, email: user.email });

		const createRes = await apiRequest("POST", "/api/kumiai/plans", {
			body: { requirementId: requirement.id, taskId: task.id, title: "Task-scoped plan" },
		});
		expect(createRes.status).toBe(201);
		const created = (await createRes.json()) as { id: string; taskId: string | null };
		expect(created.taskId).toBe(task.id);

		const getRes = await apiRequest("GET", `/api/kumiai/plans/${created.id}`);
		expect(getRes.status).toBe(200);
	});

	it("returns 404 creating or updating a plan with a task from another team", async () => {
		const { user, team } = await seedTeamMember("plans-task-cross-a.com");
		const { team: otherTeam } = await seedTeamMember("plans-task-cross-b.com");
		const requirement = await seedKumiaiRequirement(team.id);
		const foreignRequirement = await seedKumiaiRequirement(otherTeam.id);
		const foreignTask = await seedKumiaiTask(otherTeam.id, foreignRequirement.id);
		setCurrentUser({ id: user.id, email: user.email });

		const createRes = await apiRequest("POST", "/api/kumiai/plans", {
			body: { requirementId: requirement.id, taskId: foreignTask.id, title: "Should fail" },
		});
		expect(createRes.status).toBe(404);

		const plan = await seedKumiaiPlan(team.id, requirement.id);
		const updateRes = await apiRequest("PATCH", `/api/kumiai/plans/${plan.id}`, {
			body: { taskId: foreignTask.id },
		});
		expect(updateRes.status).toBe(404);
	});

	it("moves a plan to a different requirement in the same team", async () => {
		const { user, team } = await seedTeamMember("plans-move-requirement.com");
		const requirementA = await seedKumiaiRequirement(team.id);
		const requirementB = await seedKumiaiRequirement(team.id);
		const plan = await seedKumiaiPlan(team.id, requirementA.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("PATCH", `/api/kumiai/plans/${plan.id}`, {
			body: { requirementId: requirementB.id },
		});
		expect(res.status).toBe(200);
		expect(((await res.json()) as { requirementId: string }).requirementId).toBe(requirementB.id);
	});

	it("returns 404 fetching, updating or deleting a plan that does not exist", async () => {
		const { user } = await seedTeamMember("plans-404.com");
		setCurrentUser({ id: user.id, email: user.email });

		expect((await apiRequest("GET", "/api/kumiai/plans/nonexistent")).status).toBe(404);
		expect(
			(await apiRequest("PATCH", "/api/kumiai/plans/nonexistent", { body: { title: "x" } })).status,
		).toBe(404);
		expect((await apiRequest("DELETE", "/api/kumiai/plans/nonexistent")).status).toBe(404);
	});
});

// ── Tasks CRUD ─────────────────────────────────────────────────────────────────

describe("Tasks CRUD", () => {
	it("creates, updates and deletes a task", async () => {
		const { user, team } = await seedTeamMember("tasks-crud.com");
		const requirement = await seedKumiaiRequirement(team.id);
		setCurrentUser({ id: user.id, email: user.email });

		const createRes = await apiRequest("POST", "/api/kumiai/tasks", {
			body: { requirementId: requirement.id, title: "Do the thing" },
		});
		expect(createRes.status).toBe(201);
		const created = (await createRes.json()) as { id: string; status: string };
		expect(created.status).toBe("todo");

		const updateRes = await apiRequest("PATCH", `/api/kumiai/tasks/${created.id}`, {
			body: { status: "in-progress" },
		});
		expect(updateRes.status).toBe(200);

		const deleteRes = await apiRequest("DELETE", `/api/kumiai/tasks/${created.id}`);
		expect(deleteRes.status).toBe(204);
	});

	it("returns 422 for an invalid task status", async () => {
		const { user, team } = await seedTeamMember("tasks-bad-status.com");
		const requirement = await seedKumiaiRequirement(team.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", "/api/kumiai/tasks", {
			body: { requirementId: requirement.id, title: "Bad", status: "not-a-status" },
		});
		expect(res.status).toBe(422);
	});

	it("returns 404 creating a task against a requirement in another team", async () => {
		const { user } = await seedTeamMember("tasks-cross-a.com");
		const { team: otherTeam } = await seedTeamMember("tasks-cross-b.com");
		const foreignRequirement = await seedKumiaiRequirement(otherTeam.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", "/api/kumiai/tasks", {
			body: { requirementId: foreignRequirement.id, title: "Should fail" },
		});
		expect(res.status).toBe(404);
	});

	it("creates a task linked to a plan in the same team and fetches it by id", async () => {
		const { user, team } = await seedTeamMember("tasks-with-plan.com");
		const requirement = await seedKumiaiRequirement(team.id);
		const plan = await seedKumiaiPlan(team.id, requirement.id);
		setCurrentUser({ id: user.id, email: user.email });

		const createRes = await apiRequest("POST", "/api/kumiai/tasks", {
			body: { requirementId: requirement.id, planId: plan.id, title: "Plan-scoped task", objective: "Do it" },
		});
		expect(createRes.status).toBe(201);
		const created = (await createRes.json()) as { id: string; planId: string | null };
		expect(created.planId).toBe(plan.id);

		const getRes = await apiRequest("GET", `/api/kumiai/tasks/${created.id}`);
		expect(getRes.status).toBe(200);
	});

	it("returns 404 creating or updating a task with a plan from another team", async () => {
		const { user, team } = await seedTeamMember("tasks-plan-cross-a.com");
		const { team: otherTeam } = await seedTeamMember("tasks-plan-cross-b.com");
		const requirement = await seedKumiaiRequirement(team.id);
		const foreignRequirement = await seedKumiaiRequirement(otherTeam.id);
		const foreignPlan = await seedKumiaiPlan(otherTeam.id, foreignRequirement.id);
		setCurrentUser({ id: user.id, email: user.email });

		const createRes = await apiRequest("POST", "/api/kumiai/tasks", {
			body: { requirementId: requirement.id, planId: foreignPlan.id, title: "Should fail" },
		});
		expect(createRes.status).toBe(404);

		const task = await seedKumiaiTask(team.id, requirement.id);
		const updateRes = await apiRequest("PATCH", `/api/kumiai/tasks/${task.id}`, {
			body: { planId: foreignPlan.id },
		});
		expect(updateRes.status).toBe(404);
	});

	it("moves a task to a different requirement in the same team", async () => {
		const { user, team } = await seedTeamMember("tasks-move-requirement.com");
		const requirementA = await seedKumiaiRequirement(team.id);
		const requirementB = await seedKumiaiRequirement(team.id);
		const task = await seedKumiaiTask(team.id, requirementA.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("PATCH", `/api/kumiai/tasks/${task.id}`, {
			body: { requirementId: requirementB.id, objective: "Updated objective" },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { requirementId: string; objective: string };
		expect(body.requirementId).toBe(requirementB.id);
		expect(body.objective).toBe("Updated objective");
	});

	it("returns 404 fetching, updating or deleting a task that does not exist", async () => {
		const { user } = await seedTeamMember("tasks-404.com");
		setCurrentUser({ id: user.id, email: user.email });

		expect((await apiRequest("GET", "/api/kumiai/tasks/nonexistent")).status).toBe(404);
		expect(
			(await apiRequest("PATCH", "/api/kumiai/tasks/nonexistent", { body: { title: "x" } })).status,
		).toBe(404);
		expect((await apiRequest("DELETE", "/api/kumiai/tasks/nonexistent")).status).toBe(404);
	});
});

// ── Cross-tenant isolation (US-4 AC4) ───────────────────────────────────────────

describe("Cross-tenant isolation (US-4 AC4)", () => {
	it("lists only the caller's team's rows and 404s reading another team's row by id", async () => {
		const { user: userA, team: teamA } = await seedTeamMember("tenant-a.com");
		const { team: teamB } = await seedTeamMember("tenant-b.com");

		const goalA = await seedKumiaiGoal(teamA.id, { title: "A's goal" });
		await seedKumiaiProject(teamA.id, goalA.id, { title: "A's project" });

		const goalB = await seedKumiaiGoal(teamB.id, { title: "B's goal" });
		const projectB = await seedKumiaiProject(teamB.id, goalB.id, { title: "B's project" });

		setCurrentUser({ id: userA.id, email: userA.email });

		const listRes = await apiRequest("GET", "/api/kumiai/projects");
		expect(listRes.status).toBe(200);
		const projects = (await listRes.json()) as Array<{ title: string }>;
		expect(projects.map((p) => p.title)).toEqual(["A's project"]);

		const getRes = await apiRequest("GET", `/api/kumiai/projects/${projectB.id}`);
		expect(getRes.status).toBe(404);
	});
});

// ── Server-set timestamps (US-4 AC3) ────────────────────────────────────────────

describe("Server-set timestamps (US-4 AC3)", () => {
	it("ignores a client-supplied createdAt and stamps its own", async () => {
		const { user } = await seedTeamMember("timestamps.com");
		setCurrentUser({ id: user.id, email: user.email });

		const bogusCreatedAt = "1999-01-01T00:00:00.000Z";
		const res = await apiRequest("POST", "/api/kumiai/goals", {
			body: { title: "Timestamped goal", createdAt: bogusCreatedAt },
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as { id: string; createdAt: string };
		expect(body.createdAt).not.toBe(bogusCreatedAt);
		expect(new Date(body.createdAt).getFullYear()).toBeGreaterThan(1999);

		const bogusUpdatedAt = "1999-01-01T00:00:00.000Z";
		const updateRes = await apiRequest("PATCH", `/api/kumiai/goals/${body.id}`, {
			body: { title: "Renamed", updatedAt: bogusUpdatedAt },
		});
		expect(updateRes.status).toBe(200);
		const updated = (await updateRes.json()) as { updatedAt: string };
		expect(updated.updatedAt).not.toBe(bogusUpdatedAt);
		expect(new Date(updated.updatedAt).getFullYear()).toBeGreaterThan(1999);
	});
});

// ── GET /api/kumiai/stats ────────────────────────────────────────────────────────

describe("GET /api/kumiai/stats", () => {
	it("zero-fills every projectCounts key when the team has no projects", async () => {
		const { user } = await seedTeamMember("stats-empty.com");
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", "/api/kumiai/stats");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			tasksInProgress: number;
			projectCounts: Record<string, number>;
		};
		expect(body.tasksInProgress).toBe(0);
		expect(body.projectCounts).toEqual({
			backlog: 0,
			todo: 0,
			inProgress: 0,
			blocked: 0,
			done: 0,
		});
	});

	it("counts in-progress tasks and each project status", async () => {
		const { user, team } = await seedTeamMember("stats-counts.com");
		const goal = await seedKumiaiGoal(team.id);
		const requirement = await seedKumiaiRequirement(team.id);
		await seedKumiaiTask(team.id, requirement.id, { status: "in-progress" });
		await seedKumiaiTask(team.id, requirement.id, { status: "in-progress" });
		await seedKumiaiTask(team.id, requirement.id, { status: "done" });
		await seedKumiaiProject(team.id, goal.id, { status: "todo" });
		await seedKumiaiProject(team.id, goal.id, { status: "blocked", blockedReason: "x" });
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", "/api/kumiai/stats");
		const body = (await res.json()) as {
			tasksInProgress: number;
			projectCounts: Record<string, number>;
		};
		expect(body.tasksInProgress).toBe(2);
		expect(body.projectCounts).toEqual({
			backlog: 0,
			todo: 1,
			inProgress: 0,
			blocked: 1,
			done: 0,
		});
	});
});

// ── GET /api/kumiai/search ────────────────────────────────────────────────────────

describe("GET /api/kumiai/search", () => {
	it("returns three empty arrays for a blank query", async () => {
		const { user } = await seedTeamMember("search-blank.com");
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", "/api/kumiai/search?q=%20");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ goals: [], projects: [], requirements: [] });
	});

	it("matches title and id, case-insensitively, across goals/projects/requirements", async () => {
		const { user, team } = await seedTeamMember("search-match.com");
		const goal = await seedKumiaiGoal(team.id, { title: "Migrate Billing" });
		await seedKumiaiProject(team.id, goal.id, { title: "Unrelated project" });
		await seedKumiaiRequirement(team.id, { title: "billing cutover plan" });
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", "/api/kumiai/search?q=BILLING");
		const body = (await res.json()) as {
			goals: Array<{ title: string }>;
			requirements: Array<{ title: string }>;
		};
		expect(body.goals.map((g) => g.title)).toEqual(["Migrate Billing"]);
		expect(body.requirements.map((r) => r.title)).toEqual(["billing cutover plan"]);
	});

	it("escapes % and _ so a literal query does not match everything", async () => {
		const { user, team } = await seedTeamMember("search-escape.com");
		await seedKumiaiGoal(team.id, { title: "50% done" });
		await seedKumiaiGoal(team.id, { title: "Totally unrelated" });
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", `/api/kumiai/search?q=${encodeURIComponent("50%")}`);
		const body = (await res.json()) as { goals: Array<{ title: string }> };
		expect(body.goals.map((g) => g.title)).toEqual(["50% done"]);
	});

	it("caps each result array at 20", async () => {
		const { user, team } = await seedTeamMember("search-cap.com");
		for (let i = 0; i < 21; i++) {
			await seedKumiaiGoal(team.id, { title: `Capped goal ${i}` });
		}
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("GET", "/api/kumiai/search?q=Capped");
		const body = (await res.json()) as { goals: unknown[] };
		expect(body.goals.length).toBe(20);
	});
});

// ── recent-projects ────────────────────────────────────────────────────────────

describe("recent-projects", () => {
	it("de-duplicates by project id and orders newest-first", async () => {
		const { user, team } = await seedTeamMember("recent-dedupe.com");
		const goal = await seedKumiaiGoal(team.id);
		const projectA = await seedKumiaiProject(team.id, goal.id, { title: "A" });
		const projectB = await seedKumiaiProject(team.id, goal.id, { title: "B" });
		setCurrentUser({ id: user.id, email: user.email });

		await apiRequest("POST", "/api/kumiai/recent-projects", { body: { projectId: projectA.id } });
		await apiRequest("POST", "/api/kumiai/recent-projects", { body: { projectId: projectB.id } });
		// Re-touching A should move it back to the front, not duplicate it.
		const touchRes = await apiRequest("POST", "/api/kumiai/recent-projects", {
			body: { projectId: projectA.id },
		});
		expect(touchRes.status).toBe(204);

		const listRes = await apiRequest("GET", "/api/kumiai/recent-projects");
		const body = (await listRes.json()) as Array<{ id: string; title: string }>;
		expect(body.length).toBe(2);
		expect(body[0]?.id).toBe(projectA.id);
		expect(body[1]?.id).toBe(projectB.id);
	});

	it("keeps at most 5 recent projects per user", async () => {
		const { user, team } = await seedTeamMember("recent-cap.com");
		const goal = await seedKumiaiGoal(team.id);
		setCurrentUser({ id: user.id, email: user.email });

		for (let i = 0; i < 6; i++) {
			const project = await seedKumiaiProject(team.id, goal.id, { title: `Project ${i}` });
			await apiRequest("POST", "/api/kumiai/recent-projects", { body: { projectId: project.id } });
		}

		const listRes = await apiRequest("GET", "/api/kumiai/recent-projects");
		const body = (await listRes.json()) as unknown[];
		expect(body.length).toBe(5);
	});

	it("refuses a project outside the caller's team", async () => {
		const { user } = await seedTeamMember("recent-cross-a.com");
		const { team: otherTeam } = await seedTeamMember("recent-cross-b.com");
		const foreignGoal = await seedKumiaiGoal(otherTeam.id);
		const foreignProject = await seedKumiaiProject(otherTeam.id, foreignGoal.id);
		setCurrentUser({ id: user.id, email: user.email });

		const res = await apiRequest("POST", "/api/kumiai/recent-projects", {
			body: { projectId: foreignProject.id },
		});
		expect(res.status).toBe(404);
	});
});
