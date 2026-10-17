import type { ServerLoadEvent } from '@sveltejs/kit';
import { loadWorkspace } from './load.js';

/** The `load` shared by every planning view: the whole workspace, joined client-side. */
export const workspaceLoad = ({ fetch }: Pick<ServerLoadEvent, 'fetch'>) => loadWorkspace(fetch);
