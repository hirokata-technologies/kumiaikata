import type { GroupBy } from './types.js';

export type WorkspaceId = 'personal' | 'team';

export interface WorkspaceContext {
	activeProjectId: string | null;
	groupBy: GroupBy;
}

// --- storage keys ---
const WORKSPACE_KEY = 'kata_workspace';
const projectKey = (id: WorkspaceId) => `kata_ws_${id}_project`;
const groupByKey  = (id: WorkspaceId) => `kata_ws_${id}_groupby`;

// --- safe storage helpers (mirrors settings.svelte.ts) ---
function readRaw(key: string): string | null {
	try {
		if (typeof localStorage === 'undefined') return null;
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeRaw(key: string, value: string): void {
	try {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(key, value);
	} catch {
		// QuotaExceeded / blocked — in-memory value still applies for the session
	}
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], def: T): T {
	return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : def;
}

// --- active workspace ---

export function readWorkspace(): WorkspaceId {
	return oneOf<WorkspaceId>(readRaw(WORKSPACE_KEY), ['personal', 'team'], 'personal');
}

export function writeWorkspace(id: WorkspaceId): void {
	writeRaw(WORKSPACE_KEY, id);
}

// --- per-workspace context ---

export function readContext(id: WorkspaceId): WorkspaceContext {
	const rawProject = readRaw(projectKey(id));
	return {
		activeProjectId: rawProject && rawProject.length > 0 ? rawProject : null,
		groupBy: oneOf<GroupBy>(readRaw(groupByKey(id)), ['status', 'project'], 'status'),
	};
}

export function writeProjectFilter(id: WorkspaceId, projectId: string | null): void {
	// store '' for null so the round-trip yields null again
	writeRaw(projectKey(id), projectId ?? '');
}

export function writeGroupBy(id: WorkspaceId, groupBy: GroupBy): void {
	writeRaw(groupByKey(id), groupBy);
}
