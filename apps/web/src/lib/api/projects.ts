import { apiFetch } from './client.js';
import type { ProjectDetail } from './types.js';

export function listProjects(boardId: string): Promise<ProjectDetail[]> {
	return apiFetch<ProjectDetail[]>(`/api/boards/${boardId}/projects`);
}

export function createProject(boardId: string, name: string, color: string): Promise<ProjectDetail> {
	return apiFetch<ProjectDetail>(`/api/boards/${boardId}/projects`, {
		method: 'POST',
		body: JSON.stringify({ name, color }),
	});
}

export interface UpdateProjectPatch {
	name?: string;
	color?: string;
}

export function updateProject(boardId: string, projectId: string, patch: UpdateProjectPatch): Promise<ProjectDetail> {
	return apiFetch<ProjectDetail>(`/api/boards/${boardId}/projects/${projectId}`, {
		method: 'PATCH',
		body: JSON.stringify(patch),
	});
}

export function deleteProject(boardId: string, projectId: string): Promise<null> {
	return apiFetch<null>(`/api/boards/${boardId}/projects/${projectId}`, { method: 'DELETE' });
}
