import { z } from "zod";
import { listGoals, getGoal } from "./kumiai/goals.js";
import { listProjects } from "./kumiai/projects.js";
import { resolveWorkspaceId, listWorkspaces } from "./kumiai/workspaces.js";

/**
 * Roadmap planning conversations: the Roadmap opens an agents session with a planning
 * intent, and the Project Manager reads what the workspace already holds from session
 * state (`planning_context`, see apps/agents/src/kata_agents/roadmap.py). The context is
 * always built here from the database, never taken from the client.
 */

export const PLANNING_CONTEXT_KEY = "planning_context";

export const planningIntent = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("goal"), workspaceId: z.string().min(1).max(128).optional() }),
	z.object({ kind: z.literal("project"), goalId: z.string().min(1).max(128) }),
]);

export type PlanningIntent = z.infer<typeof planningIntent>;

/** Caps that keep the instruction small however big the roadmap grows. */
const MAX_GOALS = 40;
const MAX_PROJECTS_PER_GOAL = 25;
const MAX_BODY = 1200;

const quote = (text: string) => JSON.stringify(text);

function clip(text: string, max = MAX_BODY): string {
	const flat = text.trim();
	return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

interface GoalLine {
	id: string;
	title: string;
	priority: number;
}

interface ProjectLine {
	goalId: string;
	title: string;
	status: string;
}

function roadmapLines(goals: GoalLine[], projects: ProjectLine[], skipGoalId?: string): string[] {
	const lines: string[] = [];
	const candidates = goals.filter((g) => g.id !== skipGoalId);
	const shown = candidates.slice(0, MAX_GOALS);
	for (const goal of shown) {
		const own = projects.filter((p) => p.goalId === goal.id);
		const names = own
			.slice(0, MAX_PROJECTS_PER_GOAL)
			.map((p) => `${quote(p.title)} (${p.status})`);
		if (own.length > MAX_PROJECTS_PER_GOAL) names.push(`and ${own.length - MAX_PROJECTS_PER_GOAL} more`);
		lines.push(
			`- Goal ${quote(goal.title)}, priority ${goal.priority}: ${names.length ? names.join(", ") : "no projects yet"}`,
		);
	}
	if (candidates.length > shown.length) {
		lines.push(`- and ${candidates.length - shown.length} more goals`);
	}
	return lines;
}

/** The `planning_context` text for a new planning session. */
export async function buildPlanningContext(teamId: string, intent: PlanningIntent): Promise<string> {
	if (intent.kind === "project") {
		const goal = await getGoal(teamId, intent.goalId);
		const [goals, projects] = await Promise.all([
			listGoals(teamId, goal.workspaceId),
			listProjects(teamId),
		]);
		const own = projects.filter((p) => p.goalId === goal.id);
		const others = roadmapLines(goals, projects, goal.id);
		return [
			"The user opened this conversation from the Roadmap to add projects to an existing goal.",
			`Goal id: ${goal.id}`,
			`Goal: ${quote(goal.title)}, priority ${goal.priority}, status ${goal.status}.`,
			goal.body.trim() ? `What the goal says: ${clip(goal.body)}` : "The goal has no description yet.",
			own.length
				? `Projects it already has: ${own.map((p) => `${quote(p.title)} (${p.status})`).join(", ")}.`
				: "It has no projects yet.",
			others.length ? `Other goals in the workspace:\n${others.join("\n")}` : "",
			`When you propose, pass goal_id ${quote(goal.id)} and no new goal.`,
		]
			.filter(Boolean)
			.join("\n");
	}

	const workspaceId = await resolveWorkspaceId(teamId, intent.workspaceId);
	const [workspaces, goals, projects] = await Promise.all([
		listWorkspaces(teamId),
		listGoals(teamId, workspaceId),
		listProjects(teamId),
	]);
	const name = workspaces.find((w) => w.id === workspaceId)?.name ?? "default";
	const lines = roadmapLines(goals, projects);
	return [
		`The user opened this conversation from the Roadmap to plan a new goal in the workspace ${quote(name)}.`,
		lines.length ? `Goals the workspace already has:\n${lines.join("\n")}` : "The workspace has no goals yet.",
		"When you propose, pass a new goal and no goal_id.",
	].join("\n");
}
