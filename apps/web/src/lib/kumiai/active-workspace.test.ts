import { describe, it, expect } from 'vitest';
import { resolveActiveWorkspace } from './active-workspace.js';
import type { KumiaiWorkspace } from './types.js';

const ws = (id: string, over: Partial<KumiaiWorkspace> = {}): KumiaiWorkspace => ({
	id,
	teamId: 't',
	name: id,
	isDefault: false,
	goalCount: 0,
	projectCount: 0,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	...over
});

describe('resolveActiveWorkspace', () => {
	const list = [ws('a', { isDefault: true }), ws('b'), ws('c')];

	it('returns the remembered workspace', () => {
		expect(resolveActiveWorkspace(list, 'b')?.id).toBe('b');
	});

	it('falls back to the default when nothing is remembered', () => {
		expect(resolveActiveWorkspace(list, undefined)?.id).toBe('a');
		expect(resolveActiveWorkspace(list, null)?.id).toBe('a');
	});

	it('falls back to the default when the remembered workspace is gone', () => {
		expect(resolveActiveWorkspace(list, 'deleted')?.id).toBe('a');
	});

	it('falls back to the first workspace when none is flagged default', () => {
		expect(resolveActiveWorkspace([ws('x'), ws('y')], null)?.id).toBe('x');
	});

	it('is null when there are no workspaces', () => {
		expect(resolveActiveWorkspace([], 'a')).toBeNull();
	});
});
