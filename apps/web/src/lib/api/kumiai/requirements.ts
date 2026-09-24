import { apiFetch } from '../client.js';
import type { Requirement } from '$lib/kumiai/types.js';
import type { CreateRequirementInput, UpdateRequirementInput } from './types.js';

export const listRequirements = () => apiFetch<Requirement[]>('/api/kumiai/requirements');

export const getRequirement = (id: string) =>
	apiFetch<Requirement>(`/api/kumiai/requirements/${id}`);

export const createRequirement = (input: CreateRequirementInput) =>
	apiFetch<Requirement>('/api/kumiai/requirements', {
		method: 'POST',
		body: JSON.stringify(input),
	});

export const updateRequirement = (id: string, input: UpdateRequirementInput) =>
	apiFetch<Requirement>(`/api/kumiai/requirements/${id}`, {
		method: 'PATCH',
		body: JSON.stringify(input),
	});

export const deleteRequirement = (id: string) =>
	apiFetch<null>(`/api/kumiai/requirements/${id}`, { method: 'DELETE' });
