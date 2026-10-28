import { ApiError } from '$lib/api/client.js';
import { createKumiaiProject, updateKumiaiProject } from '$lib/api/kumiai/index.js';
import { createGoal } from '$lib/api/kumiai/goals.js';
import type { CreateProjectInput, UpdateProjectInput } from '$lib/api/kumiai/types.js';
import type { Goal, Project, ProjectPriority } from './types.js';

/** Turns any thrown value into a sentence for the UI. */
export function errorMessage(e: unknown): string {
	if (e instanceof ApiError) return e.message;
	return e instanceof Error ? e.message : 'Something went wrong.';
}

/** Goals use a 1-5 number where projects use words; the four words are levels 1-4. */
export const GOAL_PRIORITY: Record<ProjectPriority, 1 | 2 | 3 | 4> = {
	urgent: 1,
	high: 2,
	medium: 3,
	low: 4
};

/**
 * Saves a partial project update. Returns `null` on success or the error message — callers
 * refetch after either, so a failed save snaps the view back to what the server holds.
 */
export async function saveProject(id: string, patch: UpdateProjectInput): Promise<string | null> {
	try {
		await updateKumiaiProject(id, patch);
		return null;
	} catch (e) {
		return errorMessage(e);
	}
}

export async function addProject(input: CreateProjectInput): Promise<Project> {
	return createKumiaiProject(input);
}

/** Creates a goal in `workspaceId` (the team's default workspace when omitted). */
export async function addGoal(
	title: string,
	priority: ProjectPriority,
	workspaceId?: string | null
): Promise<Goal> {
	return createGoal({
		title,
		status: 'todo',
		priority: GOAL_PRIORITY[priority],
		...(workspaceId ? { workspaceId } : {})
	});
}
