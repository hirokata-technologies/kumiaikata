import { apiFetch } from '../client.js';
import type { Goal } from '$lib/kumiai/types.js';
import type { CreateGoalInput, UpdateGoalInput } from './types.js';

export const listGoals = () => apiFetch<Goal[]>('/api/kumiai/goals');

export const getGoal = (id: string) => apiFetch<Goal>(`/api/kumiai/goals/${id}`);

export const createGoal = (input: CreateGoalInput) =>
	apiFetch<Goal>('/api/kumiai/goals', { method: 'POST', body: JSON.stringify(input) });

export const updateGoal = (id: string, input: UpdateGoalInput) =>
	apiFetch<Goal>(`/api/kumiai/goals/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export const deleteGoal = (id: string) =>
	apiFetch<null>(`/api/kumiai/goals/${id}`, { method: 'DELETE' });
