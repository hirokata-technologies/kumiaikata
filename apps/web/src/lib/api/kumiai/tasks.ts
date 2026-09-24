import { apiFetch } from '../client.js';
import type { Task } from '$lib/kumiai/types.js';
import type { CreateTaskInput, UpdateTaskInput } from './types.js';

export const listTasks = () => apiFetch<Task[]>('/api/kumiai/tasks');

export const getTask = (id: string) => apiFetch<Task>(`/api/kumiai/tasks/${id}`);

export const createTask = (input: CreateTaskInput) =>
	apiFetch<Task>('/api/kumiai/tasks', { method: 'POST', body: JSON.stringify(input) });

export const updateTask = (id: string, input: UpdateTaskInput) =>
	apiFetch<Task>(`/api/kumiai/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(input) });

export const deleteTask = (id: string) =>
	apiFetch<null>(`/api/kumiai/tasks/${id}`, { method: 'DELETE' });
