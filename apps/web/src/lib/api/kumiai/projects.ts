import { apiFetch } from '../client.js';
import type { Project, ProjectStatus } from '$lib/kumiai/types.js';
import type { CreateProjectInput, UpdateProjectInput } from './types.js';
import { qs } from './types.js';

export interface ListProjectsParams {
	goalId?: string;
	status?: ProjectStatus;
}

export const listProjects = (params?: ListProjectsParams) =>
	apiFetch<Project[]>(`/api/kumiai/projects${qs(params)}`);

export const getProject = (id: string) => apiFetch<Project>(`/api/kumiai/projects/${id}`);

export const createProject = (input: CreateProjectInput) =>
	apiFetch<Project>('/api/kumiai/projects', { method: 'POST', body: JSON.stringify(input) });

export const updateProject = (id: string, input: UpdateProjectInput) =>
	apiFetch<Project>(`/api/kumiai/projects/${id}`, {
		method: 'PATCH',
		body: JSON.stringify(input),
	});

export const deleteProject = (id: string) =>
	apiFetch<null>(`/api/kumiai/projects/${id}`, { method: 'DELETE' });
