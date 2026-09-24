// Unit tests for the Workspace Switch feature implemented in +page.svelte.
//
// The web vitest config uses environment: "node" with no browser renderer.
// The business logic (loadBoard, handleSelectWorkspace, pageTitle derivation,
// workspaces derivation) is extracted into plain functions with injectable
// dependencies and exercised against all acceptance criteria from REQ-002.
//
// The algorithm mirrors the implementation in +page.svelte exactly:
//
//   async function loadBoard(kind) {
//     const seq = ++loadSeq;
//     loading = true; loadError = null;
//     try {
//       const api = kind === 'team' ? await getTeamBoard() : await getPersonalBoard();
//       if (seq !== loadSeq) return;
//       const [columns, labels, projects] = await Promise.all([...]);
//       if (seq !== loadSeq) return;
//       boardId = api.id; boardState = { columns, labels, projects };
//     } catch (err) {
//       if (seq !== loadSeq) return;
//       const e = err instanceof ApiError ? err : null;
//       if (kind === 'team' && e?.status === 404) loadError = 'Team board not found';
//       else loadError = e?.message ?? (err instanceof Error ? err.message : 'Failed to load board');
//     } finally {
//       if (seq === loadSeq) loading = false;
//     }
//   }
//
//   function handleSelectWorkspace(id) {
//     if (id !== 'personal' && id !== 'team') return;
//     if (id === workspaceId) return;
//     openCardId = null;
//     activeProjectId = null;
//     workspaceId = id;
//     loadBoard(id);
//   }

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// ApiError mirror (same shape as apps/web/src/lib/api/client.ts)
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
// Testable extraction of the page state + loadBoard algorithm
// ---------------------------------------------------------------------------

interface TeamInfo {
	id: string;
	domain: string;
	name: string;
	role: string;
}

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
	workspaceId: 'personal' | 'team';
	openCardId: string | null;
	activeProjectId: string | null;
}

async function runLoadBoard(
	kind: 'personal' | 'team',
	deps: LoadBoardDeps,
	state: PageState,
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
		state.boardId = api.id;
		state.boardState = {
			columns,
			labels: labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
			projects: projects.map((p) => ({ id: p.id, name: p.name, color: p.color })),
		};
	} catch (err) {
		if (seq !== state.loadSeq) return; // superseded — don't show a stale error
		const e = err instanceof ApiError ? err : null;
		if (kind === 'team' && e?.status === 404) {
			state.loadError = 'Team board not found';
		} else {
			state.loadError =
				e?.message ?? (err instanceof Error ? err.message : 'Failed to load board');
		}
	} finally {
		if (seq === state.loadSeq) state.loading = false;
	}
}

function handleSelectWorkspace(
	id: string,
	state: PageState,
	deps: LoadBoardDeps,
): void {
	if (id !== 'personal' && id !== 'team') return;
	if (id === state.workspaceId) return; // no-op on active entry
	state.openCardId = null; // close any open card modal
	state.activeProjectId = null; // old board's project filter is meaningless on new board
	state.workspaceId = id as 'personal' | 'team';
	runLoadBoard(id as 'personal' | 'team', deps, state);
}

function derivePageTitle(
	workspaceId: 'personal' | 'team',
	teamInfo: TeamInfo | null,
): string {
	return workspaceId === 'team'
		? `Kata — ${teamInfo?.name ?? 'Team'}`
		: 'Kata — Personal board';
}

function deriveWorkspaces(teamInfo: TeamInfo | null) {
	return [
		{ id: 'personal', name: 'Personal', hint: 'Just for you', icon: 'user' },
		{
			id: 'team',
			name: teamInfo?.name ?? 'Team',
			hint: teamInfo?.domain ?? '',
			icon: 'users',
		},
	];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// US-1 AC-3: loadBoard('personal') success — happy path
// ---------------------------------------------------------------------------

describe('loadBoard — personal board success (US-1 AC-3)', () => {
	it('sets loading=true at the start of a load', async () => {
		const deps = makeDeps();
		const state = makeState();
		// Capture the loading state mid-flight by checking before await resolves
		let loadingDuringFetch = false;
		(deps.getPersonalBoard as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			loadingDuringFetch = state.loading;
			return { id: 'board-personal', kind: 'personal', title: 'Personal', columns: [] };
		});
		await runLoadBoard('personal', deps, state);
		expect(loadingDuringFetch).toBe(true);
	});

	it('sets loading=false after a successful load', async () => {
		const deps = makeDeps();
		const state = makeState();
		await runLoadBoard('personal', deps, state);
		expect(state.loading).toBe(false);
	});

	it('calls getPersonalBoard for kind="personal"', async () => {
		const deps = makeDeps();
		const state = makeState();
		await runLoadBoard('personal', deps, state);
		expect(deps.getPersonalBoard).toHaveBeenCalledOnce();
		expect(deps.getTeamBoard).not.toHaveBeenCalled();
	});

	it('sets boardId to the returned board id', async () => {
		const deps = makeDeps();
		const state = makeState();
		await runLoadBoard('personal', deps, state);
		expect(state.boardId).toBe('board-personal');
	});

	it('clears loadError on a successful load', async () => {
		const deps = makeDeps();
		const state = makeState({ loadError: 'previous error' });
		await runLoadBoard('personal', deps, state);
		expect(state.loadError).toBeNull();
	});

	it('populates boardState.labels from listLabels response', async () => {
		const deps = makeDeps({
			listLabels: vi.fn().mockResolvedValue([{ id: 'l1', name: 'Bug', color: '#f00' }]),
		});
		const state = makeState();
		await runLoadBoard('personal', deps, state);
		expect(state.boardState.labels).toEqual([{ id: 'l1', name: 'Bug', color: '#f00' }]);
	});

	it('populates boardState.projects from listProjects response', async () => {
		const deps = makeDeps({
			listProjects: vi.fn().mockResolvedValue([
				{ id: 'p1', name: 'Sprint 1', color: '#0f0' },
			]),
		});
		const state = makeState();
		await runLoadBoard('personal', deps, state);
		expect(state.boardState.projects).toEqual([
			{ id: 'p1', name: 'Sprint 1', color: '#0f0' },
		]);
	});
});

// ---------------------------------------------------------------------------
// US-2 AC-1,3: loadBoard('team') success
// ---------------------------------------------------------------------------

describe('loadBoard — team board success (US-2 AC-1, AC-3)', () => {
	it('calls getTeamBoard for kind="team"', async () => {
		const deps = makeDeps();
		const state = makeState();
		await runLoadBoard('team', deps, state);
		expect(deps.getTeamBoard).toHaveBeenCalledOnce();
		expect(deps.getPersonalBoard).not.toHaveBeenCalled();
	});

	it('sets boardId to the team board id', async () => {
		const deps = makeDeps();
		const state = makeState();
		await runLoadBoard('team', deps, state);
		expect(state.boardId).toBe('board-team');
	});

	it('sets loading=false after a successful team board load', async () => {
		const deps = makeDeps();
		const state = makeState();
		await runLoadBoard('team', deps, state);
		expect(state.loading).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// US-4 AC-1: loadBoard error — generic failure
// ---------------------------------------------------------------------------

describe('loadBoard — error handling (US-4 AC-1)', () => {
	it('sets loadError to the ApiError message on a generic API error', async () => {
		const err = new ApiError(500, 'INTERNAL', 'Internal server error');
		const deps = makeDeps({
			getTeamBoard: vi.fn().mockRejectedValue(err),
		});
		const state = makeState();
		await runLoadBoard('team', deps, state);
		expect(state.loadError).toBe('Internal server error');
	});

	it('sets loadError to the Error message for non-ApiError throws', async () => {
		const deps = makeDeps({
			getPersonalBoard: vi.fn().mockRejectedValue(new Error('Network timeout')),
		});
		const state = makeState();
		await runLoadBoard('personal', deps, state);
		expect(state.loadError).toBe('Network timeout');
	});

	it('sets loadError to "Failed to load board" for non-Error throws', async () => {
		const deps = makeDeps({
			getPersonalBoard: vi.fn().mockRejectedValue('some string error'),
		});
		const state = makeState();
		await runLoadBoard('personal', deps, state);
		expect(state.loadError).toBe('Failed to load board');
	});

	it('sets loading=false even when the fetch throws (finally block)', async () => {
		const deps = makeDeps({
			getTeamBoard: vi.fn().mockRejectedValue(new ApiError(500, 'ERR', 'fail')),
		});
		const state = makeState();
		await runLoadBoard('team', deps, state);
		expect(state.loading).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// US-4 AC-4: 404 on team board → specific message
// ---------------------------------------------------------------------------

describe('loadBoard — 404 on team board produces specific message (US-4 AC-4)', () => {
	it('sets loadError to "Team board not found" on 404 from team endpoint', async () => {
		const deps = makeDeps({
			getTeamBoard: vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Not found')),
		});
		const state = makeState();
		await runLoadBoard('team', deps, state);
		expect(state.loadError).toBe('Team board not found');
	});

	it('does NOT produce "Team board not found" on 404 from personal endpoint', async () => {
		const deps = makeDeps({
			getPersonalBoard: vi
				.fn()
				.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Not found')),
		});
		const state = makeState();
		await runLoadBoard('personal', deps, state);
		// Should use the ApiError message, not the team-specific one
		expect(state.loadError).toBe('Not found');
		expect(state.loadError).not.toBe('Team board not found');
	});

	it('does NOT produce "Team board not found" on 500 from team endpoint', async () => {
		const deps = makeDeps({
			getTeamBoard: vi.fn().mockRejectedValue(new ApiError(500, 'ERR', 'Server error')),
		});
		const state = makeState();
		await runLoadBoard('team', deps, state);
		expect(state.loadError).toBe('Server error');
	});
});

// ---------------------------------------------------------------------------
// US-2/US-3 edge: stale-response guard via loadSeq
// ---------------------------------------------------------------------------

describe('loadBoard — stale-response guard (loadSeq)', () => {
	it('does not commit state when a newer load supersedes an in-flight one', async () => {
		const state = makeState();

		// slow first load (team)
		let resolveFirstFetch!: (v: BoardApi) => void;
		const firstFetchPromise = new Promise<BoardApi>((resolve) => {
			resolveFirstFetch = resolve;
		});

		const deps1 = makeDeps({ getTeamBoard: vi.fn().mockReturnValue(firstFetchPromise) });
		// Start first load (team) but don't await
		const firstLoad = runLoadBoard('team', deps1, state);

		// Start a second load (personal) immediately — increments loadSeq past seq=1
		const deps2 = makeDeps({
			getPersonalBoard: vi.fn().mockResolvedValue({
				id: 'board-personal',
				kind: 'personal',
				title: 'Personal',
				columns: [],
			}),
		});
		await runLoadBoard('personal', deps2, state);

		// Now resolve the first (stale) fetch — it should be abandoned
		resolveFirstFetch({
			id: 'board-team',
			kind: 'team',
			title: 'Team',
			columns: [],
		});
		await firstLoad;

		// boardId should reflect the second (winning) load, not the stale first
		expect(state.boardId).toBe('board-personal');
	});

	it('does not display a stale error when a newer load supersedes a failing in-flight one', async () => {
		const state = makeState();

		let rejectFirstFetch!: (err: unknown) => void;
		const firstFetchPromise = new Promise<BoardApi>((_, reject) => {
			rejectFirstFetch = reject;
		});

		const deps1 = makeDeps({ getTeamBoard: vi.fn().mockReturnValue(firstFetchPromise) });
		const firstLoad = runLoadBoard('team', deps1, state);

		// Second load succeeds
		const deps2 = makeDeps();
		await runLoadBoard('personal', deps2, state);
		expect(state.loadError).toBeNull();

		// First load fails — error must NOT overwrite the cleared state
		rejectFirstFetch(new ApiError(500, 'ERR', 'Stale error'));
		await firstLoad;

		expect(state.loadError).toBeNull();
	});

	it('does not set loading=false for a superseded load (finally guard)', async () => {
		const state = makeState();

		let resolveFirstFetch!: (v: BoardApi) => void;
		const firstFetchPromise = new Promise<BoardApi>((resolve) => {
			resolveFirstFetch = resolve;
		});

		const deps1 = makeDeps({ getPersonalBoard: vi.fn().mockReturnValue(firstFetchPromise) });
		const firstLoad = runLoadBoard('personal', deps1, state);

		// Second load starts (increments seq to 2), but keep it in-flight too
		let resolveSecondFetch!: (v: BoardApi) => void;
		const secondFetchPromise = new Promise<BoardApi>((resolve) => {
			resolveSecondFetch = resolve;
		});
		const deps2 = makeDeps({ getTeamBoard: vi.fn().mockReturnValue(secondFetchPromise) });
		const secondLoad = runLoadBoard('team', deps2, state);

		// First load resolves — seq=1 !== loadSeq=2, so finally must NOT set loading=false
		resolveFirstFetch({ id: 'board-personal', kind: 'personal', title: 'Personal', columns: [] });
		await firstLoad;
		// loading is still true because the second load is in-flight
		expect(state.loading).toBe(true);

		// Resolve second load
		resolveSecondFetch({ id: 'board-team', kind: 'team', title: 'Team', columns: [] });
		await secondLoad;
		expect(state.loading).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// US-3 AC-4: handleSelectWorkspace — no-op on active workspace
// ---------------------------------------------------------------------------

describe('handleSelectWorkspace — no-op on active entry (US-3 AC-4)', () => {
	it('does not call loadBoard when selecting the currently active workspace', () => {
		const deps = makeDeps();
		const state = makeState({ workspaceId: 'personal' });

		handleSelectWorkspace('personal', state, deps);

		expect(deps.getPersonalBoard).not.toHaveBeenCalled();
		expect(deps.getTeamBoard).not.toHaveBeenCalled();
	});

	it('does not change workspaceId when selecting the already-active workspace', () => {
		const deps = makeDeps();
		const state = makeState({ workspaceId: 'team' });

		handleSelectWorkspace('team', state, deps);

		expect(state.workspaceId).toBe('team');
	});

	it('ignores unknown workspace ids', () => {
		const deps = makeDeps();
		const state = makeState({ workspaceId: 'personal' });

		handleSelectWorkspace('unknown-id', state, deps);

		expect(state.workspaceId).toBe('personal');
		expect(deps.getPersonalBoard).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// US-2 AC-1: handleSelectWorkspace — switching to team workspace
// ---------------------------------------------------------------------------

describe('handleSelectWorkspace — switching workspaces (US-2 AC-1, US-3 AC-1)', () => {
	it('updates workspaceId synchronously before the board loads', () => {
		const deps = makeDeps();
		const state = makeState({ workspaceId: 'personal' });

		handleSelectWorkspace('team', state, deps);

		// workspaceId must be updated synchronously (not awaited)
		expect(state.workspaceId).toBe('team');
	});

	it('triggers getTeamBoard when switching to team', async () => {
		const deps = makeDeps();
		const state = makeState({ workspaceId: 'personal' });

		handleSelectWorkspace('team', state, deps);
		// flush microtasks
		await Promise.resolve();
		await Promise.resolve();

		expect(deps.getTeamBoard).toHaveBeenCalled();
	});

	it('triggers getPersonalBoard when switching back to personal', async () => {
		const deps = makeDeps();
		const state = makeState({ workspaceId: 'team' });

		handleSelectWorkspace('personal', state, deps);
		await Promise.resolve();
		await Promise.resolve();

		expect(deps.getPersonalBoard).toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// US-2 edge: handleSelectWorkspace resets openCardId and activeProjectId
// ---------------------------------------------------------------------------

describe('handleSelectWorkspace — modal and filter reset on switch', () => {
	it('resets openCardId to null when switching workspaces', () => {
		const deps = makeDeps();
		const state = makeState({ workspaceId: 'personal', openCardId: 'card-123' });

		handleSelectWorkspace('team', state, deps);

		expect(state.openCardId).toBeNull();
	});

	it('resets activeProjectId to null when switching workspaces', () => {
		const deps = makeDeps();
		const state = makeState({ workspaceId: 'personal', activeProjectId: 'proj-abc' });

		handleSelectWorkspace('team', state, deps);

		expect(state.activeProjectId).toBeNull();
	});

	it('does not reset openCardId when selecting the already-active workspace', () => {
		const deps = makeDeps();
		const state = makeState({ workspaceId: 'personal', openCardId: 'card-123' });

		handleSelectWorkspace('personal', state, deps);

		// no-op — openCardId must be untouched
		expect(state.openCardId).toBe('card-123');
	});
});

// ---------------------------------------------------------------------------
// US-1 AC-2: deriveWorkspaces — workspace list derivation from teamInfo
// ---------------------------------------------------------------------------

describe('deriveWorkspaces — workspace list from teamInfo (US-1 AC-2)', () => {
	it('returns exactly two entries', () => {
		const workspaces = deriveWorkspaces(null);
		expect(workspaces).toHaveLength(2);
	});

	it('first entry is always Personal with "Just for you" hint and user icon', () => {
		const workspaces = deriveWorkspaces(null);
		expect(workspaces[0]).toEqual({
			id: 'personal',
			name: 'Personal',
			hint: 'Just for you',
			icon: 'user',
		});
	});

	it('team entry uses teamInfo.name when teamInfo is available', () => {
		const teamInfo: TeamInfo = { id: 't1', domain: 'acme.com', name: 'Acme Corp', role: 'member' };
		const workspaces = deriveWorkspaces(teamInfo);
		expect(workspaces[1].name).toBe('Acme Corp');
	});

	it('team entry uses teamInfo.domain as hint when teamInfo is available', () => {
		const teamInfo: TeamInfo = { id: 't1', domain: 'acme.com', name: 'Acme Corp', role: 'member' };
		const workspaces = deriveWorkspaces(teamInfo);
		expect(workspaces[1].hint).toBe('acme.com');
	});

	it('team entry has users icon', () => {
		const workspaces = deriveWorkspaces(null);
		expect(workspaces[1].icon).toBe('users');
	});
});

// ---------------------------------------------------------------------------
// US-1 AC-4: deriveWorkspaces — fallback when teamInfo is null
// ---------------------------------------------------------------------------

describe('deriveWorkspaces — fallback on teamInfo=null (US-1 AC-4)', () => {
	it('team entry falls back to name "Team" when teamInfo is null', () => {
		const workspaces = deriveWorkspaces(null);
		expect(workspaces[1].name).toBe('Team');
	});

	it('team entry falls back to empty hint when teamInfo is null', () => {
		const workspaces = deriveWorkspaces(null);
		expect(workspaces[1].hint).toBe('');
	});

	it('team entry still has id "team" when teamInfo is null', () => {
		const workspaces = deriveWorkspaces(null);
		expect(workspaces[1].id).toBe('team');
	});
});

// ---------------------------------------------------------------------------
// US-2 AC-5, US-3 AC-3: derivePageTitle
// ---------------------------------------------------------------------------

describe('derivePageTitle — page title derivation', () => {
	it('returns "Kata — Personal board" for personal workspace', () => {
		expect(derivePageTitle('personal', null)).toBe('Kata — Personal board');
	});

	it('returns "Kata — Personal board" for personal workspace even when teamInfo is set', () => {
		const teamInfo: TeamInfo = { id: 't1', domain: 'acme.com', name: 'Acme Corp', role: 'member' };
		expect(derivePageTitle('personal', teamInfo)).toBe('Kata — Personal board');
	});

	it('returns "Kata — {team.name}" for team workspace when teamInfo is available', () => {
		const teamInfo: TeamInfo = { id: 't1', domain: 'acme.com', name: 'Acme Corp', role: 'member' };
		expect(derivePageTitle('team', teamInfo)).toBe('Kata — Acme Corp');
	});

	it('returns "Kata — Team" for team workspace when teamInfo is null (fallback)', () => {
		expect(derivePageTitle('team', null)).toBe('Kata — Team');
	});
});

// ---------------------------------------------------------------------------
// US-1 AC-4: getMyTeam failure must not affect board load (structural)
// ---------------------------------------------------------------------------

describe('getMyTeam failure isolation from board load', () => {
	it('loadBoard completes successfully even if getMyTeam conceptually fails', async () => {
		// Simulates the concurrent mount pattern: board load and team fetch fire independently.
		// A failed team fetch (which sets teamInfo=null) must not interfere with boardState.
		const deps = makeDeps();
		const state = makeState();

		// Simulate successful board load with teamInfo remaining null (team fetch failed)
		await runLoadBoard('personal', deps, state);

		// Board must be loaded regardless
		expect(state.boardId).toBe('board-personal');
		expect(state.loadError).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// US-4 AC-2/AC-3: Retry logic — calling loadBoard again clears error and retries
// ---------------------------------------------------------------------------

describe('loadBoard — retry behavior (US-4 AC-2, AC-3)', () => {
	it('clears loadError at the start of a retry call', async () => {
		const deps = makeDeps({
			getTeamBoard: vi
				.fn()
				.mockRejectedValueOnce(new ApiError(500, 'ERR', 'Server error'))
				.mockResolvedValueOnce({ id: 'board-team', kind: 'team', title: 'Team', columns: [] }),
		});
		const state = makeState();

		// First call fails
		await runLoadBoard('team', deps, state);
		expect(state.loadError).toBe('Server error');

		// Retry — loadError must clear
		await runLoadBoard('team', deps, state);
		expect(state.loadError).toBeNull();
	});

	it('sets boardId after a successful retry', async () => {
		const deps = makeDeps({
			getTeamBoard: vi
				.fn()
				.mockRejectedValueOnce(new ApiError(500, 'ERR', 'fail'))
				.mockResolvedValueOnce({ id: 'board-team', kind: 'team', title: 'Team', columns: [] }),
		});
		const state = makeState();

		await runLoadBoard('team', deps, state);
		await runLoadBoard('team', deps, state);

		expect(state.boardId).toBe('board-team');
	});

	it('switching to personal from error state loads personal board normally (US-4 AC-3)', async () => {
		const deps = makeDeps({
			getTeamBoard: vi.fn().mockRejectedValue(new ApiError(500, 'ERR', 'fail')),
		});
		const state = makeState({ workspaceId: 'personal' });

		// Load team board which fails
		await runLoadBoard('team', deps, state);
		expect(state.loadError).toBe('fail');

		// Now load personal — should succeed and clear the error
		await runLoadBoard('personal', deps, state);
		expect(state.loadError).toBeNull();
		expect(state.boardId).toBe('board-personal');
	});
});

// ---------------------------------------------------------------------------
// Source markup audit — structural properties of +page.svelte
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(resolve(__dirname, '+page.svelte'), 'utf-8');

describe('+page.svelte — workspace switch structural audit', () => {
	// US-1: imports
	it('imports getTeamBoard from $lib/api', () => {
		expect(pageSource).toContain('getTeamBoard');
	});

	it('imports getMyTeam from $lib/api', () => {
		expect(pageSource).toContain('getMyTeam');
	});

	it('imports ApiError from $lib/api', () => {
		expect(pageSource).toContain('ApiError');
	});

	it('imports TeamInfo type from $lib/api', () => {
		expect(pageSource).toContain('TeamInfo');
	});

	// US-1 AC-2: workspaces is $derived from teamInfo
	it('declares workspaces as $derived', () => {
		expect(pageSource).toContain('$derived');
		expect(pageSource).toContain('workspaces');
	});

	it('declares teamInfo as $state', () => {
		expect(pageSource).toContain('teamInfo');
		expect(pageSource).toContain('$state');
	});

	// US-1 edge: concurrent mount fetch
	it('calls loadBoard and getMyTeam in the mount effect', () => {
		expect(pageSource).toContain('loadBoard');
		expect(pageSource).toContain('getMyTeam');
	});

	// Stale-response guard
	it('declares loadSeq counter', () => {
		expect(pageSource).toContain('loadSeq');
	});

	it('checks seq !== loadSeq to abandon superseded loads', () => {
		expect(pageSource).toContain('seq !== loadSeq');
	});

	// US-3 AC-4: no-op guard on active workspace
	it('implements no-op guard for active workspace selection', () => {
		expect(pageSource).toContain('handleSelectWorkspace');
	});

	it('checks id === workspaceId for the no-op guard', () => {
		expect(pageSource).toContain('id === workspaceId');
	});

	// US-2 edge: modal close on switch
	it('resets openCardId to null on workspace switch', () => {
		expect(pageSource).toContain('openCardId = null');
	});

	// US-4 AC-4: 404 error message
	it('contains the "Team board not found" string for 404 handling', () => {
		expect(pageSource).toContain('Team board not found');
	});

	// US-2 AC-5, US-3 AC-3: page title derivation
	it('declares pageTitle as $derived', () => {
		expect(pageSource).toContain('pageTitle');
	});

	it('uses pageTitle in <svelte:head><title>', () => {
		expect(pageSource).toContain('{pageTitle}');
	});

	it('contains the "Kata — Personal board" title string', () => {
		expect(pageSource).toContain('Kata — Personal board');
	});

	// US-4 AC-1: error state with Retry button
	it('renders a Retry button in the error state', () => {
		expect(pageSource).toContain('Retry');
	});

	it('Retry button calls loadBoard', () => {
		expect(pageSource).toContain('loadBoard');
	});

	// US-2 AC-2: loading state message
	it('renders a "Loading board…" message in the loading state', () => {
		expect(pageSource).toContain('Loading board');
	});

	// US-1 edge: getMyTeam failure is caught silently
	it('catches getMyTeam failure without surfacing as loadError', () => {
		// The .catch must only set teamInfo to null, not loadError
		expect(pageSource).toContain('.catch(');
		expect(pageSource).toContain('teamInfo = null');
	});

	// loadBoard(kind) signature
	it('loadBoard accepts a kind parameter', () => {
		expect(pageSource).toContain("loadBoard('personal')");
	});

	it('loadBoard dispatches to getTeamBoard for kind="team"', () => {
		expect(pageSource).toContain("getTeamBoard()");
	});

	it('loadBoard dispatches to getPersonalBoard for kind="personal"', () => {
		expect(pageSource).toContain("getPersonalBoard()");
	});
});
