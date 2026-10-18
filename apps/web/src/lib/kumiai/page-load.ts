import type { ServerLoadEvent } from '@sveltejs/kit';
import { loadWorkspace } from './load.js';

/**
 * The `load` shared by every planning view: the active workspace's goals and everything
 * beneath them, joined client-side. The active workspace comes from the (app) layout load.
 */
export const workspaceLoad = async ({
	fetch,
	parent
}: Pick<ServerLoadEvent, 'fetch' | 'parent'>) => {
	const { activeWorkspaceId } = (await parent()) as { activeWorkspaceId?: string | null };
	return loadWorkspace(fetch, activeWorkspaceId);
};
