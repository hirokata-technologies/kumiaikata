import type { KumiaiWorkspace } from './types.js';

/** Remembers which workspace the user is in. Readable by the server load and writable by the client. */
export const ACTIVE_WORKSPACE_COOKIE = 'kumiai_workspace';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * The workspace to show: the remembered one if it still exists, otherwise the team's default
 * (or the first workspace if, oddly, none is flagged). `null` only when there are no workspaces.
 */
export function resolveActiveWorkspace(
	workspaces: KumiaiWorkspace[],
	remembered: string | null | undefined
): KumiaiWorkspace | null {
	return (
		workspaces.find((w) => w.id === remembered) ??
		workspaces.find((w) => w.isDefault) ??
		workspaces[0] ??
		null
	);
}

/** Browser-side: remember a workspace. The caller re-runs the loads afterwards. */
export function rememberWorkspace(id: string): void {
	document.cookie = `${ACTIVE_WORKSPACE_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

export const WORKSPACE_COOKIE_MAX_AGE = ONE_YEAR_SECONDS;
