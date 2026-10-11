// Unit tests for settings.svelte.ts — the persisted, reactive user-settings
// store. The module reads its initial values from localStorage at import
// time, so most tests seed a mock localStorage, then dynamically re-import
// the module (via vi.resetModules) to exercise a fresh initial-read.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_ACCENT } from './accent-presets.js';

function makeStorage(initial: Record<string, string> = {}) {
	let store: Record<string, string> = { ...initial };
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
			store = {};
		}),
		key: vi.fn(() => null),
		length: 0,
	};
}

async function loadFresh() {
	vi.resetModules();
	return import('./settings.svelte.js');
}

describe('settings.svelte.ts', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe('initial state — no localStorage', () => {
		it('falls back to defaults for every key when localStorage is undefined', async () => {
			vi.unstubAllGlobals();
			const { settings } = await loadFresh();
			expect(settings.theme).toBe('light');
			expect(settings.density).toBe('comfortable');
			expect(settings.columnStyle).toBe('tray');
			expect(settings.mist).toBe(true);
			expect(settings.accent).toBe(DEFAULT_ACCENT);
			expect(settings.notificationsInApp).toBe(true);
			expect(settings.view).toBe('board');
		});
	});

	describe('initial state — valid stored values', () => {
		it('reads every persisted key on import', async () => {
			const storage = makeStorage({
				kata_theme: 'dark',
				kata_density: 'spacious',
				kata_column_style: 'minimal',
				kata_mist: 'false',
				kata_accent: '#1A6B8A',
				kata_notifications_inapp: 'false',
				kata_view: 'roadmap',
			});
			vi.stubGlobal('localStorage', storage);
			const { settings } = await loadFresh();
			expect(settings.theme).toBe('dark');
			expect(settings.density).toBe('spacious');
			expect(settings.columnStyle).toBe('minimal');
			expect(settings.mist).toBe(false);
			expect(settings.accent).toBe('#1A6B8A');
			expect(settings.notificationsInApp).toBe(false);
			expect(settings.view).toBe('roadmap');
		});
	});

	describe('initial state — invalid/unrecognized stored values', () => {
		it('falls back to the default for each enum-like key', async () => {
			const storage = makeStorage({
				kata_theme: 'purple',
				kata_density: 'huge',
				kata_column_style: 'garbage',
				kata_view: 'kanban',
			});
			vi.stubGlobal('localStorage', storage);
			const { settings } = await loadFresh();
			expect(settings.theme).toBe('light');
			expect(settings.density).toBe('comfortable');
			expect(settings.columnStyle).toBe('tray');
			expect(settings.view).toBe('board');
		});

		it('parseBool falls back to the default for an unrecognized value', async () => {
			const storage = makeStorage({ kata_mist: 'maybe', kata_notifications_inapp: 'nope' });
			vi.stubGlobal('localStorage', storage);
			const { settings } = await loadFresh();
			expect(settings.mist).toBe(true);
			expect(settings.notificationsInApp).toBe(true);
		});

		it('parseAccent rejects a non-hex value and falls back to DEFAULT_ACCENT', async () => {
			const storage = makeStorage({ kata_accent: 'javascript:alert(1)' });
			vi.stubGlobal('localStorage', storage);
			const { settings } = await loadFresh();
			expect(settings.accent).toBe(DEFAULT_ACCENT);
		});

		it('parseAccent rejects a malformed hex (wrong length) and falls back', async () => {
			const storage = makeStorage({ kata_accent: '#FFF' });
			vi.stubGlobal('localStorage', storage);
			const { settings } = await loadFresh();
			expect(settings.accent).toBe(DEFAULT_ACCENT);
		});

		it('parseAccent accepts a valid 6-digit hex not in the preset list', async () => {
			const storage = makeStorage({ kata_accent: '#123abc' });
			vi.stubGlobal('localStorage', storage);
			const { settings } = await loadFresh();
			expect(settings.accent).toBe('#123abc');
		});
	});

	describe('initial state — localStorage.getItem throws', () => {
		it('treats a throwing getItem as "no value" and uses defaults', async () => {
			const storage = makeStorage();
			storage.getItem.mockImplementation(() => {
				throw new Error('blocked');
			});
			vi.stubGlobal('localStorage', storage);
			const { settings } = await loadFresh();
			expect(settings.theme).toBe('light');
		});
	});

	describe('setters', () => {
		let storage: ReturnType<typeof makeStorage>;
		let mod: Awaited<ReturnType<typeof loadFresh>>;

		beforeEach(async () => {
			storage = makeStorage();
			vi.stubGlobal('localStorage', storage);
			mod = await loadFresh();
		});

		it('setTheme updates state and persists', () => {
			mod.setTheme('dark');
			expect(mod.settings.theme).toBe('dark');
			expect(storage.store['kata_theme']).toBe('dark');
		});

		it('setDensity updates state and persists', () => {
			mod.setDensity('spacious');
			expect(mod.settings.density).toBe('spacious');
			expect(storage.store['kata_density']).toBe('spacious');
		});

		it('setColumnStyle updates state and persists', () => {
			mod.setColumnStyle('minimal');
			expect(mod.settings.columnStyle).toBe('minimal');
			expect(storage.store['kata_column_style']).toBe('minimal');
		});

		it('setMist updates state and persists a stringified boolean', () => {
			mod.setMist(false);
			expect(mod.settings.mist).toBe(false);
			expect(storage.store['kata_mist']).toBe('false');
		});

		it('setAccent updates state and persists', () => {
			mod.setAccent('#4A5568');
			expect(mod.settings.accent).toBe('#4A5568');
			expect(storage.store['kata_accent']).toBe('#4A5568');
		});

		it('setNotificationsInApp updates state and persists a stringified boolean', () => {
			mod.setNotificationsInApp(false);
			expect(mod.settings.notificationsInApp).toBe(false);
			expect(storage.store['kata_notifications_inapp']).toBe('false');
		});

		it('setView updates state and persists', () => {
			mod.setView('roadmap');
			expect(mod.settings.view).toBe('roadmap');
			expect(storage.store['kata_view']).toBe('roadmap');
		});

		it('toggleTheme flips light to dark', () => {
			mod.setTheme('light');
			mod.toggleTheme();
			expect(mod.settings.theme).toBe('dark');
			expect(storage.store['kata_theme']).toBe('dark');
		});

		it('toggleTheme flips dark to light', () => {
			mod.setTheme('dark');
			mod.toggleTheme();
			expect(mod.settings.theme).toBe('light');
			expect(storage.store['kata_theme']).toBe('light');
		});

		it('a setter still updates state even when persistence throws (QuotaExceeded)', () => {
			storage.setItem.mockImplementationOnce(() => {
				throw new Error('QuotaExceededError');
			});
			expect(() => mod.setTheme('dark')).not.toThrow();
			expect(mod.settings.theme).toBe('dark');
		});

		it('a setter is a no-op write when localStorage is undefined, but state still updates', () => {
			vi.unstubAllGlobals();
			expect(() => mod.setDensity('spacious')).not.toThrow();
			expect(mod.settings.density).toBe('spacious');
		});
	});
});
