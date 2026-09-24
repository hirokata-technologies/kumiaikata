// Unit tests for workspace.svelte.ts — per-workspace ('personal'/'team')
// active-project and group-by persistence, backed by localStorage.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	readWorkspace,
	writeWorkspace,
	readContext,
	writeProjectFilter,
	writeGroupBy,
	type WorkspaceId,
} from './workspace.svelte.js';

function makeStorage(initial: Record<string, string> = {}) {
	const store: Record<string, string> = { ...initial };
	return {
		store,
		getItem: vi.fn((k: string) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k]! : null)),
		setItem: vi.fn((k: string, v: string) => {
			store[k] = v;
		}),
		removeItem: vi.fn((k: string) => {
			delete store[k];
		}),
		clear: vi.fn(() => {
			for (const k of Object.keys(store)) delete store[k];
		}),
		key: vi.fn(() => null),
		length: 0,
	};
}

describe('workspace.svelte.ts', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe('readWorkspace', () => {
		it('defaults to "personal" when localStorage is undefined', () => {
			vi.unstubAllGlobals();
			expect(readWorkspace()).toBe('personal');
		});

		it('defaults to "personal" when nothing is stored', () => {
			vi.stubGlobal('localStorage', makeStorage());
			expect(readWorkspace()).toBe('personal');
		});

		it('reads a valid stored value', () => {
			vi.stubGlobal('localStorage', makeStorage({ kata_workspace: 'team' }));
			expect(readWorkspace()).toBe('team');
		});

		it('falls back to "personal" for an unrecognized stored value', () => {
			vi.stubGlobal('localStorage', makeStorage({ kata_workspace: 'bogus' }));
			expect(readWorkspace()).toBe('personal');
		});

		it('falls back to "personal" when getItem throws', () => {
			const storage = makeStorage();
			storage.getItem.mockImplementation(() => {
				throw new Error('blocked');
			});
			vi.stubGlobal('localStorage', storage);
			expect(readWorkspace()).toBe('personal');
		});
	});

	describe('writeWorkspace', () => {
		it('persists the workspace id', () => {
			const storage = makeStorage();
			vi.stubGlobal('localStorage', storage);
			writeWorkspace('team');
			expect(storage.store['kata_workspace']).toBe('team');
		});

		it('is a no-op when localStorage is undefined', () => {
			vi.unstubAllGlobals();
			expect(() => writeWorkspace('team')).not.toThrow();
		});

		it('swallows a setItem failure', () => {
			const storage = makeStorage();
			storage.setItem.mockImplementation(() => {
				throw new Error('QuotaExceededError');
			});
			vi.stubGlobal('localStorage', storage);
			expect(() => writeWorkspace('team')).not.toThrow();
		});
	});

	describe('readContext', () => {
		it.each<WorkspaceId>(['personal', 'team'])(
			'returns activeProjectId=null and groupBy="status" defaults for %s when nothing stored',
			(id) => {
				vi.stubGlobal('localStorage', makeStorage());
				expect(readContext(id)).toEqual({ activeProjectId: null, groupBy: 'status' });
			},
		);

		it('returns the stored activeProjectId when present', () => {
			vi.stubGlobal('localStorage', makeStorage({ kata_ws_personal_project: 'PROJ-001' }));
			expect(readContext('personal').activeProjectId).toBe('PROJ-001');
		});

		it('treats an empty-string stored project as null', () => {
			vi.stubGlobal('localStorage', makeStorage({ kata_ws_personal_project: '' }));
			expect(readContext('personal').activeProjectId).toBeNull();
		});

		it('returns the stored groupBy when valid', () => {
			vi.stubGlobal('localStorage', makeStorage({ kata_ws_team_groupby: 'project' }));
			expect(readContext('team').groupBy).toBe('project');
		});

		it('falls back to "status" for an unrecognized groupBy', () => {
			vi.stubGlobal('localStorage', makeStorage({ kata_ws_team_groupby: 'garbage' }));
			expect(readContext('team').groupBy).toBe('status');
		});

		it('keeps personal and team contexts independent', () => {
			vi.stubGlobal(
				'localStorage',
				makeStorage({
					kata_ws_personal_project: 'PROJ-001',
					kata_ws_personal_groupby: 'project',
					kata_ws_team_project: 'PROJ-002',
					kata_ws_team_groupby: 'status',
				}),
			);
			expect(readContext('personal')).toEqual({ activeProjectId: 'PROJ-001', groupBy: 'project' });
			expect(readContext('team')).toEqual({ activeProjectId: 'PROJ-002', groupBy: 'status' });
		});
	});

	describe('writeProjectFilter', () => {
		it('stores the project id for the given workspace', () => {
			const storage = makeStorage();
			vi.stubGlobal('localStorage', storage);
			writeProjectFilter('personal', 'PROJ-005');
			expect(storage.store['kata_ws_personal_project']).toBe('PROJ-005');
		});

		it('stores an empty string for null so the round-trip yields null again', () => {
			const storage = makeStorage();
			vi.stubGlobal('localStorage', storage);
			writeProjectFilter('team', null);
			expect(storage.store['kata_ws_team_project']).toBe('');
			expect(readContext('team').activeProjectId).toBeNull();
		});
	});

	describe('writeGroupBy', () => {
		it('stores the groupBy value for the given workspace', () => {
			const storage = makeStorage();
			vi.stubGlobal('localStorage', storage);
			writeGroupBy('personal', 'project');
			expect(storage.store['kata_ws_personal_groupby']).toBe('project');
			expect(readContext('personal').groupBy).toBe('project');
		});
	});
});
