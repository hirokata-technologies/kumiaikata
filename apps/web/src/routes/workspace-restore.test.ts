// Unit tests for the workspace restore + team-404 fallback logic in +page.svelte.
//
// +page.svelte uses Svelte 5 $state runes which cannot be resolved in the
// node test environment. The business logic (seedState, loadBoard, handleSelectWorkspace
// with persistence, and the 404 fallback) is extracted into plain functions with
// injectable dependencies and exercised against all acceptance criteria from REQ-001.
//
// The extracted functions mirror the implementation in +page.svelte exactly:
//
//   function seedState(storage) — seeds workspaceId/groupBy/activeProjectId from persistence
//
//   async function runLoadBoard(kind, deps, state) — same algorithm as workspace-switch.test.ts
//     extended with:
//       - applies incoming workspace context after board loads (readContext on switch)
//       - validates activeProjectId against loaded projects (resets to null if not found)
//       - 404 fallback: if state.restoringTeam is true and kind='team' gets 404:
//           sets workspaceId='personal', writes 'personal', sets fallbackMessage,
//           re-runs loadBoard for personal, does NOT set loadError
//       - non-404/non-restore: sets loadError (existing behaviour)
//
//   function handleSelectWorkspace(id, state, storage, deps) — extended with:
//       - no-op guard still fires; no write on no-op
//       - writeWorkspace(id) before fetch begins
//       - applies incoming context (groupBy + activeProjectId) from readContext
//
// The structural source audit asserts that +page.svelte:
//   - imports from $lib/workspace.svelte
//   - calls readWorkspace / writeWorkspace / readContext
//   - contains the restoringTeam flag
//   - contains the fallback message string "Team workspace not available"
//   - contains activeProjectId = null in the load/validate path

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// ApiError mirror (same shape as workspace-switch.test.ts / api/client.ts)
// ---------------------------------------------------------------------------

class ApiError extends Error {
	status: number;
	code: string;
	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
	}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WorkspaceId = 'personal' | 'team';
type GroupBy = 'status' | 'project';

interface BoardApi {
	id: string;
	kind: string;
	title: string;
	columns: unknown[];
}

interface BoardState {
	columns: unknown[];
	labels: { id: string; name: string; color: string }[];
	projects: { id: string; name: string; color: string }[];
}

interface LoadBoardDeps {
	getPersonalBoard: () => Promise<BoardApi>;
	getTeamBoard: () => Promise<BoardApi>;
	listLabels: (boardId: string) => Promise<{ id: string; name: string; color: string }[]>;
	listProjects: (boardId: string) => Promise<{ id: string; name: string; color: string }[]>;
	toLocalColumns: (api: BoardApi) => unknown[];
}

interface PageState {
	boardState: BoardState;
	boardId: string | null;
	loading: boolean;
	loadError: string | null;
	loadSeq: number;
	workspaceId: WorkspaceId;
	openCardId: string | null;
	activeProjectId: string | null;
	groupBy: GroupBy;
	restoringTeam: boolean;
	fallbackMessage: string | null;
}

// ---------------------------------------------------------------------------
// Injectable storage adapter (mirrors workspace.test.ts / settings.test.ts)
// ---------------------------------------------------------------------------

interface StorageAdapter {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

// ---------------------------------------------------------------------------
// Extracted pure functions (mirrors workspace.svelte.ts helpers)
// ---------------------------------------------------------------------------

function readRawStore(key: string, storage: StorageAdapter | null): string | null {
	try {
		if (!storage) return null;
		return storage.getItem(key);
	} catch {
		return null;
	}
}

function writeRawStore(key: string, value: string, storage: StorageAdapter | null): void {
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
	return oneOf<WorkspaceId>(readRawStore(WORKSPACE_KEY, storage), ['personal', 'team'], 'personal');
}

function writeWorkspace(id: WorkspaceId, storage: StorageAdapter | null): void {
	writeRawStore(WORKSPACE_KEY, id, storage);
}

function readContext(
	id: WorkspaceId,
	storage: StorageAdapter | null,
): { activeProjectId: string | null; groupBy: GroupBy } {
	const rawProject = readRawStore(projectKey(id), storage);
	return {
		activeProjectId: rawProject && rawProject.length > 0 ? rawProject : null,
		groupBy: oneOf<GroupBy>(readRawStore(groupByKey(id), storage), ['status', 'project'], 'status'),
	};
}

function writeProjectFilter(
	id: WorkspaceId,
	projectId: string | null,
	storage: StorageAdapter | null,
): void {
	writeRawStore(projectKey(id), projectId ?? '', storage);
}

function writeGroupBy(id: WorkspaceId, groupBy: GroupBy, storage: StorageAdapter | null): void {
	writeRawStore(groupByKey(id), groupBy, storage);
}

// ---------------------------------------------------------------------------
// seedState — seeds page state from persistence (mirrors +page.svelte init)
// ---------------------------------------------------------------------------

function seedState(storage: StorageAdapter | null, state: PageState): void {
	const ws = readWorkspace(storage);
	const ctx = readContext(ws, storage);
	state.workspaceId = ws;
	state.groupBy = ctx.groupBy;
	state.activeProjectId = ctx.activeProjectId;
}

// ---------------------------------------------------------------------------
// runLoadBoard — extracted load algorithm with persistence hooks
// (extends the version in workspace-switch.test.ts)
// ---------------------------------------------------------------------------

async function runLoadBoard(
	kind: WorkspaceId,
	deps: LoadBoardDeps,
	state: PageState,
	storage: StorageAdapter | null,
): Promise<void> {
	const seq = ++state.loadSeq;
	state.loading = true;
	state.loadError = null;
	try {
		const api = kind === 'team' ? await deps.getTeamBoard() : await deps.getPersonalBoard();
		if (seq !== state.loadSeq) return; // superseded — abandon
		const [columns, labels, projects] = await Promise.all([
			Promise.resolve(deps.toLocalColumns(api)),
			deps.listLabels(api.id),
			deps.listProjects(api.id),
		]);
		if (seq !== state.loadSeq) return; // superseded after the second await

		// Clear restoringTeam on successful team load (so later 404 won't silently fall back)
		if (kind === 'team') {
			state.restoringTeam = false;
		}

		state.boardId = api.id;
		state.boardState = {
			columns,
			labels: labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
			projects: projects.map((p) => ({ id: p.id, name: p.name, color: p.color })),
		};

		// Validate restored activeProjectId against loaded projects (US-3 AC-5)
		if (state.activeProjectId && state.activeProjectId !== '__none') {
			const exists = state.boardState.projects.some((p) => p.id === state.activeProjectId);
			if (!exists) {
				state.activeProjectId = null; // stale filter cleared
			}
		}
	} catch (err) {
		if (seq !== state.loadSeq) return; // superseded — don't show a stale error
		const e = err instanceof ApiError ? err : null;
		if (kind === 'team' && e?.status === 404) {
			if (state.restoringTeam) {
				// US-4 AC-1/2: fallback to personal on restored-team 404
				state.restoringTeam = false;
				state.workspaceId = 'personal';
				writeWorkspace('personal', storage); // US-4 AC-2 — persist so next load skips fallback
				const ctx = readContext('personal', storage);
				state.groupBy = ctx.groupBy;
				state.activeProjectId = ctx.activeProjectId;
				state.fallbackMessage =
					'Team workspace not available — opened Personal instead';
				// Start personal board load (bumps loadSeq; this load is now superseded)
				runLoadBoard('personal', deps, state, storage);
				return; // do NOT set loadError for the fallback path
			}
			// US-4 AC-3: user-initiated team switch that 404s → standard error
			state.loadError = 'Team board not found';
		} else {
			state.loadError =
				e?.message ?? (err instanceof Error ? err.message : 'Failed to load board');
		}
	} finally {
		if (seq === state.loadSeq) state.loading = false;
	}
}

// ---------------------------------------------------------------------------
// handleSelectWorkspace — extended with persistence (US-2 AC-1/2/3/4, US-3 AC-4)
// ---------------------------------------------------------------------------

function handleSelectWorkspace(
	id: string,
	state: PageState,
	storage: StorageAdapter | null,
	deps: LoadBoardDeps,
): void {
	if (id !== 'personal' && id !== 'team') return;
	if (id === state.workspaceId) return; // no-op: no write (US-2 AC-3)
	state.openCardId = null;
	writeWorkspace(id as WorkspaceId, storage); // US-2 AC-1/2 — write before fetch begins
	const ctx = readContext(id as WorkspaceId, storage); // US-3 AC-4 — incoming context
	state.groupBy = ctx.groupBy;
	state.activeProjectId = ctx.activeProjectId;
	state.workspaceId = id as WorkspaceId;
	runLoadBoard(id as WorkspaceId, deps, state, storage);
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

function makeDeps(overrides: Partial<LoadBoardDeps> = {}): LoadBoardDeps {
	return {
		getPersonalBoard: vi.fn().mockResolvedValue({
			id: 'board-personal',
			kind: 'personal',
			title: 'Personal',
			columns: [],
		}),
		getTeamBoard: vi.fn().mockResolvedValue({
			id: 'board-team',
			kind: 'team',
			title: 'Team',
			columns: [],
		}),
		listLabels: vi.fn().mockResolvedValue([]),
		listProjects: vi.fn().mockResolvedValue([]),
		toLocalColumns: vi.fn().mockReturnValue([]),
		...overrides,
	};
}

function makeState(overrides: Partial<PageState> = {}): PageState {
	return {
		boardState: { columns: [], labels: [], projects: [] },
		boardId: null,
		loading: false,
		loadError: null,
		loadSeq: 0,
		workspaceId: 'personal',
		openCardId: null,
		activeProjectId: null,
		groupBy: 'status',
		restoringTeam: false,
		fallbackMessage: null,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// seedState — US-1 AC-1..4
// ---------------------------------------------------------------------------

describe('seedState — seeds workspaceId/groupBy/activeProjectId from persistence (US-1)', () => {
	it('defaults to personal when no value is stored (US-1 AC-3)', () => {
		const state = makeState();
		seedState(makeStorage(), state);
		expect(state.workspaceId).toBe('personal');
	});

	it('restores personal when storage contains "personal" (US-1 AC-1)', () => {
		const state = makeState();
		seedState(makeStorage({ kata_workspace: 'personal' }), state);
		expect(state.workspaceId).toBe('personal');
	});

	it('restores team when storage contains "team" (US-1 AC-2)', () => {
		const state = makeState();
		seedState(makeStorage({ kata_workspace: 'team' }), state);
		expect(state.workspaceId).toBe('team');
	});

	it('defaults to personal for a corrupted/unrecognised value (US-1 AC-4)', () => {
		const state = makeState();
		seedState(makeStorage({ kata_workspace: 'corrupted' }), state);
		expect(state.workspaceId).toBe('personal');
	});

	it('defaults to personal when storage is null (US-1 AC-5)', () => {
		const state = makeState();
		seedState(null, state);
		expect(state.workspaceId).toBe('personal');
	});

	it('seeds groupBy from the restored workspace context', () => {
		const state = makeState();
		seedState(
			makeStorage({ kata_workspace: 'personal', kata_ws_personal_groupby: 'project' }),
			state,
		);
		expect(state.groupBy).toBe('project');
	});

	it('seeds activeProjectId from the restored workspace context', () => {
		const state = makeState();
		seedState(
			makeStorage({ kata_workspace: 'personal', kata_ws_personal_project: 'proj-abc' }),
			state,
		);
		expect(state.activeProjectId).toBe('proj-abc');
	});

	it('seeds from the team workspace context when team is restored', () => {
		const state = makeState();
		seedState(
			makeStorage({
				kata_workspace: 'team',
				kata_ws_team_groupby: 'project',
				kata_ws_team_project: 'proj-team',
			}),
			state,
		);
		expect(state.workspaceId).toBe('team');
		expect(state.groupBy).toBe('project');
		expect(state.activeProjectId).toBe('proj-team');
	});
});

// ---------------------------------------------------------------------------
// handleSelectWorkspace — switch persistence (US-2 AC-1/2/3)
// ---------------------------------------------------------------------------

describe('handleSelectWorkspace — writes workspace on switch (US-2 AC-1/2/3)', () => {
	let storage: ReturnType<typeof makeStorage>;
	let state: PageState;
	let deps: LoadBoardDeps;

	beforeEach(() => {
		storage = makeStorage({ kata_workspace: 'personal' });
		state = makeState({ workspaceId: 'personal' });
		deps = makeDeps();
	});

	it('writes "team" to kata_workspace when switching to team (US-2 AC-1)', () => {
		handleSelectWorkspace('team', state, storage, deps);
		expect(storage.store[WORKSPACE_KEY]).toBe('team');
	});

	it('writes "personal" to kata_workspace when switching to personal (US-2 AC-2)', () => {
		state.workspaceId = 'team';
		storage = makeStorage({ kata_workspace: 'team' });
		handleSelectWorkspace('personal', state, storage, deps);
		expect(storage.store[WORKSPACE_KEY]).toBe('personal');
	});

	it('does NOT write to storage on a no-op switch (US-2 AC-3)', () => {
		state.workspaceId = 'personal';
		handleSelectWorkspace('personal', state, storage, deps);
		expect(storage.setItemMock).not.toHaveBeenCalled();
	});

	it('updates workspaceId state on a valid switch', () => {
		handleSelectWorkspace('team', state, storage, deps);
		expect(state.workspaceId).toBe('team');
	});

	it('does not change workspaceId on a no-op', () => {
		handleSelectWorkspace('personal', state, storage, deps);
		expect(state.workspaceId).toBe('personal');
	});
});

// ---------------------------------------------------------------------------
// handleSelectWorkspace — applies incoming context (US-3 AC-4)
// ---------------------------------------------------------------------------

describe('handleSelectWorkspace — applies incoming workspace context, not outgoing (US-3 AC-4)', () => {
	it('applies the incoming workspace groupBy on switch', () => {
		const storage = makeStorage({
			kata_workspace: 'personal',
			kata_ws_team_groupby: 'project',
		});
		const state = makeState({ workspaceId: 'personal', groupBy: 'status' });
		handleSelectWorkspace('team', state, storage, makeDeps());
		expect(state.groupBy).toBe('project');
	});

	it('applies the incoming workspace activeProjectId on switch', () => {
		const storage = makeStorage({
			kata_workspace: 'personal',
			kata_ws_team_project: 'proj-team-1',
		});
		const state = makeState({ workspaceId: 'personal', activeProjectId: 'proj-personal-1' });
		handleSelectWorkspace('team', state, storage, makeDeps());
		// Should reflect team's context, not carry over personal's
		expect(state.activeProjectId).toBe('proj-team-1');
	});

	it('clears activeProjectId when incoming workspace has no stored project', () => {
		const storage = makeStorage({
			kata_workspace: 'personal',
			kata_ws_personal_project: 'proj-abc',
			// no kata_ws_team_project entry
		});
		const state = makeState({ workspaceId: 'personal', activeProjectId: 'proj-abc' });
		handleSelectWorkspace('team', state, storage, makeDeps());
		expect(state.activeProjectId).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Stale project-id validation after board load (US-3 AC-1/5, edge)
// ---------------------------------------------------------------------------

describe('runLoadBoard — stale activeProjectId reset after board load (US-3 AC-5)', () => {
	it('resets activeProjectId to null when the seeded project is not in the loaded board', async () => {
		const deps = makeDeps({
			listProjects: vi.fn().mockResolvedValue([{ id: 'proj-present', name: 'Present', color: '#0f0' }]),
		});
		const state = makeState({ activeProjectId: 'proj-stale' });
		await runLoadBoard('personal', deps, state, makeStorage());
		expect(state.activeProjectId).toBeNull();
	});

	it('keeps activeProjectId when the project exists in the loaded board (US-3 AC-1)', async () => {
		const deps = makeDeps({
			listProjects: vi.fn().mockResolvedValue([{ id: 'proj-abc', name: 'Acme', color: '#00f' }]),
		});
		const state = makeState({ activeProjectId: 'proj-abc' });
		await runLoadBoard('personal', deps, state, makeStorage());
		expect(state.activeProjectId).toBe('proj-abc');
	});

	it('keeps "__none" regardless of project list (special sentinel — US-3 AC-5 edge)', async () => {
		const deps = makeDeps({
			listProjects: vi.fn().mockResolvedValue([]),
		});
		const state = makeState({ activeProjectId: '__none' });
		await runLoadBoard('personal', deps, state, makeStorage());
		expect(state.activeProjectId).toBe('__none');
	});

	it('keeps null activeProjectId unchanged (no projects loaded)', async () => {
		const deps = makeDeps({
			listProjects: vi.fn().mockResolvedValue([]),
		});
		const state = makeState({ activeProjectId: null });
		await runLoadBoard('personal', deps, state, makeStorage());
		expect(state.activeProjectId).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// US-4 AC-1/2: 404 fallback on restored team workspace
// ---------------------------------------------------------------------------

describe('runLoadBoard — 404 fallback when restoringTeam=true (US-4 AC-1/2)', () => {
	it('sets workspaceId to "personal" when restored team board 404s', async () => {
		const deps = makeDeps({
			getTeamBoard: vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Not found')),
		});
		const state = makeState({ workspaceId: 'team', restoringTeam: true });
		const storage = makeStorage({ kata_workspace: 'team' });
		await runLoadBoard('team', deps, state, storage);
		// Let the triggered personal load resolve
		await Promise.resolve();
		await Promise.resolve();
		expect(state.workspaceId).toBe('personal');
	});

	it('writes "personal" to kata_workspace when fallback occurs (US-4 AC-2)', async () => {
		const deps = makeDeps({
			getTeamBoard: vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Not found')),
		});
		const state = makeState({ workspaceId: 'team', restoringTeam: true });
		const storage = makeStorage({ kata_workspace: 'team' });
		await runLoadBoard('team', deps, state, storage);
		expect(storage.store[WORKSPACE_KEY]).toBe('personal');
	});

	it('sets fallbackMessage when restored team board 404s (US-4 AC-1)', async () => {
		const deps = makeDeps({
			getTeamBoard: vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Not found')),
		});
		const state = makeState({ workspaceId: 'team', restoringTeam: true });
		await runLoadBoard('team', deps, state, makeStorage({ kata_workspace: 'team' }));
		expect(state.fallbackMessage).toContain('Team workspace not available');
	});

	it('does NOT set loadError during fallback (US-4 AC-1)', async () => {
		const deps = makeDeps({
			getTeamBoard: vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Not found')),
		});
		const state = makeState({ workspaceId: 'team', restoringTeam: true });
		await runLoadBoard('team', deps, state, makeStorage({ kata_workspace: 'team' }));
		expect(state.loadError).toBeNull();
	});

	it('loads the personal board after the fallback', async () => {
		const deps = makeDeps({
			getTeamBoard: vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Not found')),
		});
		const state = makeState({ workspaceId: 'team', restoringTeam: true });
		await runLoadBoard('team', deps, state, makeStorage({ kata_workspace: 'team' }));
		// Flush all microtasks from the chained personal load
		await new Promise((r) => setTimeout(r, 0));
		expect(deps.getPersonalBoard).toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// US-4 AC-3: No fallback when user explicitly switched to team (restoringTeam=false)
// ---------------------------------------------------------------------------

describe('runLoadBoard — no fallback on user-initiated team switch that 404s (US-4 AC-3)', () => {
	it('sets loadError to "Team board not found" when restoringTeam=false and team 404s', async () => {
		const deps = makeDeps({
			getTeamBoard: vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Not found')),
		});
		const state = makeState({ workspaceId: 'team', restoringTeam: false });
		await runLoadBoard('team', deps, state, makeStorage());
		expect(state.loadError).toBe('Team board not found');
	});

	it('does not change workspaceId on user-initiated team 404', async () => {
		const deps = makeDeps({
			getTeamBoard: vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Not found')),
		});
		const state = makeState({ workspaceId: 'team', restoringTeam: false });
		await runLoadBoard('team', deps, state, makeStorage());
		expect(state.workspaceId).toBe('team');
	});

	it('does not set fallbackMessage on user-initiated team 404', async () => {
		const deps = makeDeps({
			getTeamBoard: vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Not found')),
		});
		const state = makeState({ workspaceId: 'team', restoringTeam: false });
		await runLoadBoard('team', deps, state, makeStorage());
		expect(state.fallbackMessage).toBeNull();
	});

	it('does not write to kata_workspace on user-initiated team 404', async () => {
		const deps = makeDeps({
			getTeamBoard: vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Not found')),
		});
		const state = makeState({ workspaceId: 'team', restoringTeam: false });
		const storage = makeStorage({ kata_workspace: 'team' });
		await runLoadBoard('team', deps, state, storage);
		// The storage should not have been written to 'personal'
		expect(storage.store[WORKSPACE_KEY]).toBe('team');
	});
});

// ---------------------------------------------------------------------------
// US-4 AC-3: No fallback on non-404 error (even when restoringTeam=true)
// ---------------------------------------------------------------------------

describe('runLoadBoard — no fallback on non-404 error with restoringTeam=true (US-4 AC-3)', () => {
	it('sets standard loadError on team 500 even when restoringTeam=true', async () => {
		const deps = makeDeps({
			getTeamBoard: vi
				.fn()
				.mockRejectedValue(new ApiError(500, 'INTERNAL', 'Internal server error')),
		});
		const state = makeState({ workspaceId: 'team', restoringTeam: true });
		await runLoadBoard('team', deps, state, makeStorage());
		expect(state.loadError).toBe('Internal server error');
	});

	it('does not change workspaceId on team 500 even when restoringTeam=true', async () => {
		const deps = makeDeps({
			getTeamBoard: vi
				.fn()
				.mockRejectedValue(new ApiError(500, 'INTERNAL', 'Internal server error')),
		});
		const state = makeState({ workspaceId: 'team', restoringTeam: true });
		await runLoadBoard('team', deps, state, makeStorage());
		expect(state.workspaceId).toBe('team');
	});

	it('sets standard loadError on network error even when restoringTeam=true', async () => {
		const deps = makeDeps({
			getTeamBoard: vi.fn().mockRejectedValue(new Error('Network timeout')),
		});
		const state = makeState({ workspaceId: 'team', restoringTeam: true });
		await runLoadBoard('team', deps, state, makeStorage());
		expect(state.loadError).toBe('Network timeout');
	});

	it('does not set fallbackMessage on non-404 error', async () => {
		const deps = makeDeps({
			getTeamBoard: vi.fn().mockRejectedValue(new ApiError(503, 'UNAVAIL', 'Service unavailable')),
		});
		const state = makeState({ workspaceId: 'team', restoringTeam: true });
		await runLoadBoard('team', deps, state, makeStorage());
		expect(state.fallbackMessage).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Context persistence on view change (US-3 AC-1/2)
// ---------------------------------------------------------------------------

describe('writeGroupBy / writeProjectFilter — context persistence on view change (US-3 AC-1/2)', () => {
	it('persists groupBy under the current workspace key (US-3 AC-2)', () => {
		const storage = makeStorage();
		const state = makeState({ workspaceId: 'personal' });

		// Simulate ongroupby handler
		state.groupBy = 'project';
		writeGroupBy(state.workspaceId, 'project', storage);

		expect(storage.store['kata_ws_personal_groupby']).toBe('project');
	});

	it('persists activeProjectId under the current workspace key (US-3 AC-1)', () => {
		const storage = makeStorage();
		const state = makeState({ workspaceId: 'personal' });

		// Simulate onprojectfilter handler
		state.activeProjectId = 'proj-abc';
		writeProjectFilter(state.workspaceId, 'proj-abc', storage);

		expect(storage.store['kata_ws_personal_project']).toBe('proj-abc');
	});

	it('persists null project filter when filter is cleared (US-3 AC-1)', () => {
		const storage = makeStorage({ kata_ws_personal_project: 'proj-abc' });
		const state = makeState({ workspaceId: 'personal', activeProjectId: 'proj-abc' });

		// Simulate clearfilter handler
		state.activeProjectId = null;
		writeProjectFilter(state.workspaceId, null, storage);

		expect(storage.store['kata_ws_personal_project']).toBe('');
	});

	it('persists under team workspace key when current workspace is team (US-3 AC-1/2)', () => {
		const storage = makeStorage();
		const state = makeState({ workspaceId: 'team' });

		state.groupBy = 'project';
		writeGroupBy(state.workspaceId, 'project', storage);
		state.activeProjectId = 'proj-xyz';
		writeProjectFilter(state.workspaceId, 'proj-xyz', storage);

		expect(storage.store['kata_ws_team_groupby']).toBe('project');
		expect(storage.store['kata_ws_team_project']).toBe('proj-xyz');
	});
});

// ---------------------------------------------------------------------------
// Source markup audit — structural properties of +page.svelte
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(resolve(__dirname, '+page.svelte'), 'utf-8');

describe('+page.svelte — workspace restore structural audit', () => {
	it('imports from $lib/workspace.svelte', () => {
		expect(pageSource).toContain('workspace.svelte');
	});

	it('calls readWorkspace', () => {
		expect(pageSource).toContain('readWorkspace');
	});

	it('calls writeWorkspace', () => {
		expect(pageSource).toContain('writeWorkspace');
	});

	it('calls readContext', () => {
		expect(pageSource).toContain('readContext');
	});

	it('calls writeProjectFilter', () => {
		expect(pageSource).toContain('writeProjectFilter');
	});

	it('calls writeGroupBy', () => {
		expect(pageSource).toContain('writeGroupBy');
	});

	it('contains the restoringTeam flag', () => {
		expect(pageSource).toContain('restoringTeam');
	});

	it('contains the "Team workspace not available" fallback message string (US-4 AC-1)', () => {
		expect(pageSource).toContain('Team workspace not available');
	});

	it('contains activeProjectId = null in the board-load/validate path (US-3 AC-5)', () => {
		expect(pageSource).toContain('activeProjectId = null');
	});

	it('declares fallbackMessage state variable', () => {
		expect(pageSource).toContain('fallbackMessage');
	});
});
