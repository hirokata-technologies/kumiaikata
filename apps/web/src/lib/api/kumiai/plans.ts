import { apiFetch } from '../client.js';
import type { Plan } from '$lib/kumiai/types.js';
import type { CreatePlanInput, UpdatePlanInput } from './types.js';

export const listPlans = () => apiFetch<Plan[]>('/api/kumiai/plans');

export const getPlan = (id: string) => apiFetch<Plan>(`/api/kumiai/plans/${id}`);

export const createPlan = (input: CreatePlanInput) =>
	apiFetch<Plan>('/api/kumiai/plans', { method: 'POST', body: JSON.stringify(input) });

export const updatePlan = (id: string, input: UpdatePlanInput) =>
	apiFetch<Plan>(`/api/kumiai/plans/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export const deletePlan = (id: string) =>
	apiFetch<null>(`/api/kumiai/plans/${id}`, { method: 'DELETE' });
