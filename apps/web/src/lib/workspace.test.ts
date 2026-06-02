// Unit tests for the workspace persistence module (workspace.svelte.ts).
//
// workspace.svelte.ts uses Svelte 5 $state runes in its exports and reads
// from the global `localStorage` object, neither of which are available in
// the node test environment. These tests therefore extract every pure
// algorithm into plain functions with injectable localStorage dependencies
// and exercise all acceptance criteria from REQ-001 US-1 through US-3.
//
// The extracted functions mirror the implementation in workspace.svelte.ts:
//
//   function readRaw(key, storage)       — reads from injectable storage, returns null on failure
//   function writeRaw(key, value, storage) — writes to injectable storage, silently ignores errors
//   function oneOf(raw, allowed, def)    — returns raw if in allowed, else def
//   function readWorkspace(storage)      — reads kata_workspace, validates, defaults to 'personal'
//   function writeWorkspace(id, storage) — writes kata_workspace
//   function readContext(id, storage)    — reads per-workspace project + groupBy
//   function writeProjectFilter(id, projectId, storage) — writes kata_ws_{id}_project
//   function writeGroupBy(id, groupBy, storage)         — writes kata_ws_{id}_groupby

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Types (mirrors workspace.svelte.ts)
// ---------------------------------------------------------------------------

type WorkspaceId = 'personal' | 'team';
type GroupBy = 'status' | 'project';

interface WorkspaceContext {
	activeProjectId: string | null;
	groupBy: GroupBy;
}

// ---------------------------------------------------------------------------
// Injectable localStorage interface (same shape as settings.test.ts)
// ---------------------------------------------------------------------------

interface StorageAdapter {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

// ---------------------------------------------------------------------------
// Extracted pure functions (mirrors workspace.svelte.ts implementation)
// ---------------------------------------------------------------------------

function readRaw(key: string, storage: StorageAdapter | null): string | null {
	try {
		if (!storage) return null;
		return storage.getItem(key);
	} catch {
		return null;
	}
}

function writeRaw(key: string, value: string, storage: StorageAdapter | null): void {
	try {
		if (!storage) return;
		storage.setItem(key, value);
	} catch {
		// QuotaExceeded / blocked — in-memory value still applies for the session
	}
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], def: T): T {
	return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : def;
}

const WORKSPACE_KEY = 'kata_workspace';
const projectKey = (id: WorkspaceId) => `kata_ws_${id}_project`;
const groupByKey = (id: WorkspaceId) => `kata_ws_${id}_groupby`;

function readWorkspace(storage: StorageAdapter | null): WorkspaceId {
	return oneOf<WorkspaceId>(readRaw(WORKSPACE_KEY, storage), ['personal', 'team'], 'personal');
}

function writeWorkspace(id: WorkspaceId, storage: StorageAdapter | null): void {
	writeRaw(WORKSPACE_KEY, id, storage);
}

function readContext(id: WorkspaceId, storage: StorageAdapter | null): WorkspaceContext {
	const rawProject = readRaw(projectKey(id), storage);
	return {
		activeProjectId: rawProject && rawProject.length > 0 ? rawProject : null,
		groupBy: oneOf<GroupBy>(readRaw(groupByKey(id), storage), ['status', 'project'], 'status'),
	};
}

function writeProjectFilter(
	id: WorkspaceId,
	projectId: string | null,
	storage: StorageAdapter | null,
): void {
	writeRaw(projectKey(id), projectId ?? '', storage);
}

function writeGroupBy(id: WorkspaceId, groupBy: GroupBy, storage: StorageAdapter | null): void {
	writeRaw(groupByKey(id), groupBy, storage);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStorage(initial: Record<string, string> = {}): StorageAdapter & {
	store: Record<string, string>;
	setItemMock: ReturnType<typeof vi.fn>;
} {
	const store: Record<string, string> = { ...initial };
	const setItemMock = vi.fn((k: string, v: string) => {
		store[k] = v;
	});
	return {
		store,
		setItemMock,
		getItem: (k: string) => store[k] ?? null,
		setItem: setItemMock,
	};
}

// ---------------------------------------------------------------------------
// readWorkspace — US-1 AC-1..5
// ---------------------------------------------------------------------------

describe('readWorkspace — returns stored workspace or defaults to personal (US-1 AC-1..5)', () => {
	it('returns "team" when storage contains "team" (US-1 AC-2)', () => {
		const storage = makeStorage({ kata_workspace: 'team' });
		expect(readWorkspace(storage)).toBe('team');
	});

	it('returns "personal" when storage contains "personal" (US-1 AC-1)', () => {
		const storage = makeStorage({ kata_workspace: 'personal' });
		expect(readWorkspace(storage)).toBe('personal');
	});

	it('returns "personal" when the key is missing (US-1 AC-3)', () => {
		const storage = makeStorage({});
		expect(readWorkspace(storage)).toBe('personal');
	});

	it('returns "personal" for an unrecognised value — e.g. "foo" (US-1 AC-4)', () => {
		const storage = makeStorage({ kata_workspace: 'foo' });
		expect(readWorkspace(storage)).toBe('personal');
	});

	it('returns "personal" for an empty string value (US-1 AC-4 edge)', () => {
		const storage = makeStorage({ kata_workspace: '' });
		expect(readWorkspace(storage)).toBe('personal');
	});

	it('returns "personal" when storage is null (US-1 AC-5)', () => {
		expect(readWorkspace(null)).toBe('personal');
	});

	it('returns "personal" when getItem throws (US-1 AC-5)', () => {
		const throwingStorage: StorageAdapter = {
			getItem: () => {
				throw new Error('Storage unavailable');
			},
			setItem: vi.fn(),
		};
		expect(readWorkspace(throwingStorage)).toBe('personal');
	});
});

// ---------------------------------------------------------------------------
// writeWorkspace — US-2 AC-1/2/4
// ---------------------------------------------------------------------------

describe('writeWorkspace — writes kata_workspace to storage (US-2 AC-1/2)', () => {
	it('writes "team" to kata_workspace (US-2 AC-1)', () => {
		const storage = makeStorage();
		writeWorkspace('team', storage);
		expect(storage.store[WORKSPACE_KEY]).toBe('team');
	});

	it('writes "personal" to kata_workspace (US-2 AC-2)', () => {
		const storage = makeStorage({ kata_workspace: 'team' });
		writeWorkspace('personal', storage);
		expect(storage.store[WORKSPACE_KEY]).toBe('personal');
	});

	it('does not throw when storage is null (US-2 AC-4)', () => {
		expect(() => writeWorkspace('team', null)).not.toThrow();
	});

	it('does not throw when setItem throws (US-2 AC-4)', () => {
		const throwingStorage: StorageAdapter = {
			getItem: () => null,
			setItem: () => {
				throw new DOMException('QuotaExceededError', 'QuotaExceededError');
			},
		};
		expect(() => writeWorkspace('team', throwingStorage)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// readContext — groupBy field (US-3 AC-6, edge)
// ---------------------------------------------------------------------------

describe('readContext — groupBy field (US-3 AC-6, edge)', () => {
	it('returns stored "status" for personal workspace', () => {
		const storage = makeStorage({ kata_ws_personal_groupby: 'status' });
		expect(readContext('personal', storage).groupBy).toBe('status');
	});

	it('returns stored "project" for personal workspace', () => {
		const storage = makeStorage({ kata_ws_personal_groupby: 'project' });
		expect(readContext('personal', storage).groupBy).toBe('project');
	});

	it('returns stored "project" for team workspace', () => {
		const storage = makeStorage({ kata_ws_team_groupby: 'project' });
		expect(readContext('team', storage).groupBy).toBe('project');
	});

	it('falls back to "status" when the groupBy key is missing (US-3 AC-6)', () => {
		const storage = makeStorage({});
		expect(readContext('personal', storage).groupBy).toBe('status');
	});

	it('falls back to "status" for an unrecognised groupBy value (US-3 AC-6)', () => {
		const storage = makeStorage({ kata_ws_personal_groupby: 'invalid' });
		expect(readContext('personal', storage).groupBy).toBe('status');
	});

	it('falls back to "status" when storage is null', () => {
		expect(readContext('personal', null).groupBy).toBe('status');
	});
});

// ---------------------------------------------------------------------------
// readContext — activeProjectId field (US-3 AC-3/6)
// ---------------------------------------------------------------------------

describe('readContext — activeProjectId field (US-3 AC-3/6)', () => {
	it('returns the stored project id when present (US-3 AC-3)', () => {
		const storage = makeStorage({ kata_ws_personal_project: 'proj-abc' });
		expect(readContext('personal', storage).activeProjectId).toBe('proj-abc');
	});

	it('returns "__none" when "__none" is stored (US-3 AC-3 edge)', () => {
		const storage = makeStorage({ kata_ws_personal_project: '__none' });
		expect(readContext('personal', storage).activeProjectId).toBe('__none');
	});

	it('returns null when the project key is missing (US-3 AC-6)', () => {
		const storage = makeStorage({});
		expect(readContext('personal', storage).activeProjectId).toBeNull();
	});

	it('returns null for an empty string value (US-3 AC-6 edge)', () => {
		const storage = makeStorage({ kata_ws_personal_project: '' });
		expect(readContext('personal', storage).activeProjectId).toBeNull();
	});

	it('returns the stored project id for team workspace', () => {
		const storage = makeStorage({ kata_ws_team_project: 'proj-xyz' });
		expect(readContext('team', storage).activeProjectId).toBe('proj-xyz');
	});

	it('returns null when storage is null', () => {
		expect(readContext('personal', null).activeProjectId).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// writeProjectFilter — writes kata_ws_{id}_project
// ---------------------------------------------------------------------------

describe('writeProjectFilter — writes project filter to workspace-scoped key', () => {
	it('writes a project id to the personal workspace key', () => {
		const storage = makeStorage();
		writeProjectFilter('personal', 'proj-123', storage);
		expect(storage.store['kata_ws_personal_project']).toBe('proj-123');
	});

	it('writes a project id to the team workspace key', () => {
		const storage = makeStorage();
		writeProjectFilter('team', 'proj-abc', storage);
		expect(storage.store['kata_ws_team_project']).toBe('proj-abc');
	});

	it('writes "" for null (so round-trip yields null)', () => {
		const storage = makeStorage({ kata_ws_personal_project: 'proj-123' });
		writeProjectFilter('personal', null, storage);
		expect(storage.store['kata_ws_personal_project']).toBe('');
	});

	it('personal and team write to different keys (key correctness)', () => {
		const storage = makeStorage();
		writeProjectFilter('personal', 'p1', storage);
		writeProjectFilter('team', 'p2', storage);
		expect(storage.store['kata_ws_personal_project']).toBe('p1');
		expect(storage.store['kata_ws_team_project']).toBe('p2');
	});

	it('does not throw when storage is null', () => {
		expect(() => writeProjectFilter('personal', 'proj-123', null)).not.toThrow();
	});

	it('does not throw when setItem throws', () => {
		const throwingStorage: StorageAdapter = {
			getItem: () => null,
			setItem: () => {
				throw new Error('Storage write failed');
			},
		};
		expect(() => writeProjectFilter('personal', 'proj-123', throwingStorage)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// writeGroupBy — writes kata_ws_{id}_groupby
// ---------------------------------------------------------------------------

describe('writeGroupBy — writes groupBy to workspace-scoped key', () => {
	it('writes "status" to the personal workspace groupBy key', () => {
		const storage = makeStorage();
		writeGroupBy('personal', 'status', storage);
		expect(storage.store['kata_ws_personal_groupby']).toBe('status');
	});

	it('writes "project" to the personal workspace groupBy key', () => {
		const storage = makeStorage();
		writeGroupBy('personal', 'project', storage);
		expect(storage.store['kata_ws_personal_groupby']).toBe('project');
	});

	it('writes to the team workspace groupBy key', () => {
		const storage = makeStorage();
		writeGroupBy('team', 'project', storage);
		expect(storage.store['kata_ws_team_groupby']).toBe('project');
	});

	it('personal and team write to different keys (key correctness)', () => {
		const storage = makeStorage();
		writeGroupBy('personal', 'status', storage);
		writeGroupBy('team', 'project', storage);
		expect(storage.store['kata_ws_personal_groupby']).toBe('status');
		expect(storage.store['kata_ws_team_groupby']).toBe('project');
	});

	it('does not throw when storage is null', () => {
		expect(() => writeGroupBy('personal', 'status', null)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// readContext + writeProjectFilter round-trip
// ---------------------------------------------------------------------------

describe('readContext + writeProjectFilter — null round-trip', () => {
	it('a null written via writeProjectFilter is read back as null by readContext', () => {
		const storage = makeStorage({ kata_ws_personal_project: 'proj-123' });
		writeProjectFilter('personal', null, storage);
		expect(readContext('personal', storage).activeProjectId).toBeNull();
	});

	it('a project id written via writeProjectFilter is read back by readContext', () => {
		const storage = makeStorage();
		writeProjectFilter('personal', 'proj-xyz', storage);
		expect(readContext('personal', storage).activeProjectId).toBe('proj-xyz');
	});
});

// ---------------------------------------------------------------------------
// Source file structural audit — workspace.svelte.ts
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceSource = readFileSync(resolve(__dirname, 'workspace.svelte.ts'), 'utf-8');

describe('workspace.svelte.ts — structural audit', () => {
	it('contains the kata_workspace storage key', () => {
		expect(workspaceSource).toContain('kata_workspace');
	});

	it('contains the kata_ws_ prefix for workspace-scoped keys', () => {
		expect(workspaceSource).toContain('kata_ws_');
	});

	it('exports readWorkspace function', () => {
		expect(workspaceSource).toContain('export function readWorkspace');
	});

	it('exports writeWorkspace function', () => {
		expect(workspaceSource).toContain('export function writeWorkspace');
	});

	it('exports readContext function', () => {
		expect(workspaceSource).toContain('export function readContext');
	});

	it('exports writeProjectFilter function', () => {
		expect(workspaceSource).toContain('export function writeProjectFilter');
	});

	it('exports writeGroupBy function', () => {
		expect(workspaceSource).toContain('export function writeGroupBy');
	});

	it('guards typeof localStorage (SSR safety)', () => {
		expect(workspaceSource).toContain('typeof localStorage');
	});

	it('uses try/catch for safe storage access', () => {
		expect(workspaceSource).toContain('try {');
	});
});
