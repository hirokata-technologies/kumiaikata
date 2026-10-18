import { describe, it, expect, beforeEach } from "vitest";
import { mockBetterAuth, setCurrentUser } from "../../../test/helpers/mock-session.js";
import { apiRequest } from "../../../test/helpers/request.js";
import {
	seedUser,
	seedTeamWithBoard,
	seedKumiaiWorkspace,
	seedKumiaiGoal,
	seedKumiaiProject,
} from "../../../test/helpers/seed.js";

mockBetterAuth();

import app from "../../app.js";

void app;

beforeEach(() => {
	setCurrentUser(null);
});

async function seedTeamMember(domain: string) {
	const user = await seedUser();
	const { team } = await seedTeamWithBoard({
		domain,
		members: [{ userId: user.id, role: "member" }],
	});
	setCurrentUser({ id: user.id, email: user.email });
	return { user, team };
}

interface WorkspaceBody {
	id: string;
	name: string;
	isDefault: boolean;
	goalCount: number;
	projectCount: number;
}

const listWorkspaces = async () => {
	const res = await apiRequest("GET", "/api/kumiai/workspaces");
	if (res.status !== 200) throw new Error(`${res.status} ${await res.text()}`);
	return (await res.json()) as WorkspaceBody[];
};

describe("Workspaces", () => {
	it("requires a session", async () => {
		expect((await apiRequest("GET", "/api/kumiai/workspaces")).status).toBe(401);
		expect((await apiRequest("POST", "/api/kumiai/workspaces", { body: { name: "x" } })).status).toBe(401);
	});

	it("gives a team a 'default' workspace without anyone creating it", async () => {
		await seedTeamMember("ws-default.com");

		const workspaces = await listWorkspaces();
		expect(workspaces).toHaveLength(1);
		expect(workspaces[0]).toMatchObject({ name: "default", isDefault: true, goalCount: 0, projectCount: 0 });

		// Reading again must not mint a second default.
		expect(await listWorkspaces()).toHaveLength(1);
	});

	it("creates a workspace after the default and rejects a duplicate name", async () => {
		await seedTeamMember("ws-create.com");

		const res = await apiRequest("POST", "/api/kumiai/workspaces", { body: { name: "  Research  " } });
		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({ name: "Research", isDefault: false });

		expect((await listWorkspaces()).map((w) => w.name)).toEqual(["default", "Research"]);

		const dup = await apiRequest("POST", "/api/kumiai/workspaces", { body: { name: "Research" } });
		expect(dup.status).toBe(409);

		const blank = await apiRequest("POST", "/api/kumiai/workspaces", { body: { name: "   " } });
		expect(blank.status).toBe(422);
	});

	it("counts the goals and projects of each workspace", async () => {
		const { team } = await seedTeamMember("ws-counts.com");
		const other = await seedKumiaiWorkspace(team.id, { name: "Other", isDefault: false });
		const goal = await seedKumiaiGoal(team.id);
		await seedKumiaiProject(team.id, goal.id);
		await seedKumiaiProject(team.id, goal.id);
		await seedKumiaiGoal(team.id, { workspaceId: other.id });

		const byName = Object.fromEntries((await listWorkspaces()).map((w) => [w.name, w]));
		expect(byName["default"]).toMatchObject({ goalCount: 1, projectCount: 2 });
		expect(byName["Other"]).toMatchObject({ goalCount: 1, projectCount: 0 });
	});

	it("does not show another team's workspaces", async () => {
		const { team } = await seedTeamMember("ws-mine.com");
		const { team: theirs } = await seedTeamWithBoard({ domain: "ws-theirs.com", members: [] });
		await seedKumiaiWorkspace(theirs.id, { name: "Secret", isDefault: false });

		const names = (await listWorkspaces()).map((w) => w.name);
		expect(names).toEqual(["default"]);
		expect(team.id).not.toBe(theirs.id);
	});
});

describe("Goals belong to one workspace", () => {
	it("puts a new goal in the default workspace when none is given", async () => {
		await seedTeamMember("ws-goal-default.com");
		const [def] = await listWorkspaces();

		const res = await apiRequest("POST", "/api/kumiai/goals", { body: { title: "G" } });
		expect(res.status).toBe(201);
		expect(((await res.json()) as { workspaceId: string }).workspaceId).toBe(def!.id);
	});

	it("puts a new goal in the requested workspace and lists goals per workspace", async () => {
		await seedTeamMember("ws-goal-scope.com");
		const ws = (await (
			await apiRequest("POST", "/api/kumiai/workspaces", { body: { name: "Other" } })
		).json()) as WorkspaceBody;

		await apiRequest("POST", "/api/kumiai/goals", { body: { title: "In default" } });
		const inOther = await apiRequest("POST", "/api/kumiai/goals", {
			body: { title: "In other", workspaceId: ws.id },
		});
		expect(((await inOther.json()) as { workspaceId: string }).workspaceId).toBe(ws.id);

		const titles = async (query: string) =>
			(
				(await (await apiRequest("GET", `/api/kumiai/goals${query}`)).json()) as Array<{ title: string }>
			).map((g) => g.title);

		expect(await titles("")).toHaveLength(2);
		expect(await titles(`?workspaceId=${ws.id}`)).toEqual(["In other"]);
	});

	it("rejects a workspace from another team", async () => {
		await seedTeamMember("ws-goal-foreign.com");
		const { team: theirs } = await seedTeamWithBoard({ domain: "ws-goal-foreign-2.com", members: [] });
		const foreign = await seedKumiaiWorkspace(theirs.id);

		const create = await apiRequest("POST", "/api/kumiai/goals", {
			body: { title: "G", workspaceId: foreign.id },
		});
		expect(create.status).toBe(404);

		const list = await apiRequest("GET", `/api/kumiai/goals?workspaceId=${foreign.id}`);
		expect(list.status).toBe(404);
	});

	it("cannot move a goal to another workspace", async () => {
		await seedTeamMember("ws-goal-move.com");
		const other = (await (
			await apiRequest("POST", "/api/kumiai/workspaces", { body: { name: "Other" } })
		).json()) as WorkspaceBody;
		const goal = (await (
			await apiRequest("POST", "/api/kumiai/goals", { body: { title: "G" } })
		).json()) as { id: string; workspaceId: string };

		const res = await apiRequest("PATCH", `/api/kumiai/goals/${goal.id}`, {
			body: { workspaceId: other.id, title: "Renamed" },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ title: "Renamed", workspaceId: goal.workspaceId });
	});
});

describe("Shell scoped to a workspace", () => {
	it("counts projects and lists recents of the chosen workspace only", async () => {
		const { user, team } = await seedTeamMember("ws-shell.com");
		const other = await seedKumiaiWorkspace(team.id, { name: "Other", isDefault: false });
		const mainGoal = await seedKumiaiGoal(team.id);
		const otherGoal = await seedKumiaiGoal(team.id, { workspaceId: other.id });
		const mainProject = await seedKumiaiProject(team.id, mainGoal.id);
		const otherProject = await seedKumiaiProject(team.id, otherGoal.id);
		void user;

		for (const id of [mainProject.id, otherProject.id]) {
			await apiRequest("POST", "/api/kumiai/recent-projects", { body: { projectId: id } });
		}

		const stats = async (query: string) =>
			(await (await apiRequest("GET", `/api/kumiai/stats${query}`)).json()) as {
				projectCounts: { backlog: number; todo: number; inProgress: number; blocked: number; done: number };
			};
		const total = (s: Awaited<ReturnType<typeof stats>>) =>
			Object.values(s.projectCounts).reduce((a, b) => a + b, 0);

		expect(total(await stats(""))).toBe(2);
		expect(total(await stats(`?workspaceId=${other.id}`))).toBe(1);

		const recents = async (query: string) =>
			(
				(await (await apiRequest("GET", `/api/kumiai/recent-projects${query}`)).json()) as Array<{ id: string }>
			).map((p) => p.id);
		expect(await recents("")).toHaveLength(2);
		expect(await recents(`?workspaceId=${other.id}`)).toEqual([otherProject.id]);
	});
});
