import { apiFetch } from '../client.js';
import type { KumiaiWorkspace } from '$lib/kumiai/types.js';

export const listWorkspaces = () => apiFetch<KumiaiWorkspace[]>('/api/kumiai/workspaces');

export const createWorkspace = (name: string) =>
	apiFetch<KumiaiWorkspace>('/api/kumiai/workspaces', {
		method: 'POST',
		body: JSON.stringify({ name })
	});
