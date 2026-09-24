import { apiFetch } from '../client.js';
import type { KumiaiSearchResults, KumiaiStats, RecentProject } from './types.js';

export const getStats = () => apiFetch<KumiaiStats>('/api/kumiai/stats');

export const searchWorkspace = (q: string) =>
	apiFetch<KumiaiSearchResults>(`/api/kumiai/search?q=${encodeURIComponent(q)}`);

export const listRecentProjects = () =>
	apiFetch<RecentProject[]>('/api/kumiai/recent-projects');

export const touchRecentProject = (projectId: string) =>
	apiFetch<null>('/api/kumiai/recent-projects', {
		method: 'POST',
		body: JSON.stringify({ projectId }),
	});
