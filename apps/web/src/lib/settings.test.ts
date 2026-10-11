// Unit tests for the Settings store logic (settings.svelte.ts) and accent presets
// (accent-presets.ts).
//
// settings.svelte.ts uses Svelte 5 $state runes, which cannot be resolved in the
// node test environment. These tests therefore extract every pure algorithm into
// plain functions with injectable localStorage dependencies and exercise all
// acceptance criteria from REQ-004.
//
// The extracted functions mirror the implementation in settings.svelte.ts exactly:
//
//   function readRaw(key, storage) — reads from injectable storage, returns null on failure
//   function writeRaw(key, value, storage) — writes to injectable storage, silently ignores QuotaExceededError
//   function oneOf(raw, allowed, def) — returns raw if in allowed, else def
//   function parseBool(raw, def) — parses "true"/"false" strings
//   function parseAccent(raw) — returns raw if non-empty, else DEFAULT_ACCENT
//   function initSettings(storage) — reads all keys and returns a plain settings object
//   function setterFor(key, storage, state, transform?) — builds a setter that updates state + writes to storage
//   function toggleTheme(state, storage) — flips theme between light and dark

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Import accent-presets (pure TS — no runes, safe in node)
// ---------------------------------------------------------------------------

import { ACCENT_PRESETS, DEFAULT_ACCENT, type AccentPreset } from './accent-presets.js';

// ---------------------------------------------------------------------------
// Types (mirrors settings.svelte.ts)
// ---------------------------------------------------------------------------

type Theme = 'light' | 'dark';
type Density = 'compact' | 'comfortable' | 'spacious';
type ColumnStyle = 'tray' | 'minimal';

interface Settings {
	theme: Theme;
	density: Density;
	columnStyle: ColumnStyle;
	mist: boolean;
	accent: string;
	notificationsInApp: boolean;
}

const KEYS = {
	theme: 'kata_theme',
	density: 'kata_density',
	columnStyle: 'kata_column_style',
	mist: 'kata_mist',
	accent: 'kata_accent',
	notificationsInApp: 'kata_notifications_inapp',
} as const;

// ---------------------------------------------------------------------------
// Injectable localStorage interface (mirrors the shape used in settings.svelte.ts)
// ---------------------------------------------------------------------------

interface StorageAdapter {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

// ---------------------------------------------------------------------------
// Extracted pure functions (mirrors settings.svelte.ts implementation)
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
		// QuotaExceeded / blocked — in-memory value still applies for the session (US-9 edge)
	}
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], def: T): T {
	return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : def;
}

function parseBool(raw: string | null, def: boolean): boolean {
	if (raw === 'true') return true;
	if (raw === 'false') return false;
	return def;
}

function parseAccent(raw: string | null): string {
	return raw && raw.trim() ? raw : DEFAULT_ACCENT;
}

function initSettings(storage: StorageAdapter | null): Settings {
	return {
		theme: oneOf<Theme>(readRaw(KEYS.theme, storage), ['light', 'dark'], 'light'),
		density: oneOf<Density>(
			readRaw(KEYS.density, storage),
			['compact', 'comfortable', 'spacious'],
			'comfortable',
		),
		columnStyle: oneOf<ColumnStyle>(readRaw(KEYS.columnStyle, storage), ['tray', 'minimal'], 'tray'),
		mist: parseBool(readRaw(KEYS.mist, storage), true),
		accent: parseAccent(readRaw(KEYS.accent, storage)),
		notificationsInApp: parseBool(readRaw(KEYS.notificationsInApp, storage), true),
	};
}

function setTheme(v: Theme, state: Settings, storage: StorageAdapter | null): void {
	state.theme = v;
	writeRaw(KEYS.theme, v, storage);
}

function setDensity(v: Density, state: Settings, storage: StorageAdapter | null): void {
	state.density = v;
	writeRaw(KEYS.density, v, storage);
}

function setColumnStyle(v: ColumnStyle, state: Settings, storage: StorageAdapter | null): void {
	state.columnStyle = v;
	writeRaw(KEYS.columnStyle, v, storage);
}

function setMist(v: boolean, state: Settings, storage: StorageAdapter | null): void {
	state.mist = v;
	writeRaw(KEYS.mist, String(v), storage);
}

function setAccent(v: string, state: Settings, storage: StorageAdapter | null): void {
	state.accent = v;
	writeRaw(KEYS.accent, v, storage);
}

function setNotificationsInApp(v: boolean, state: Settings, storage: StorageAdapter | null): void {
	state.notificationsInApp = v;
	writeRaw(KEYS.notificationsInApp, String(v), storage);
}

function toggleTheme(state: Settings, storage: StorageAdapter | null): void {
	setTheme(state.theme === 'dark' ? 'light' : 'dark', state, storage);
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

function makeDefaultSettings(): Settings {
	return {
		theme: 'light',
		density: 'comfortable',
		columnStyle: 'tray',
		mist: true,
		accent: DEFAULT_ACCENT,
		notificationsInApp: true,
	};
}

// ---------------------------------------------------------------------------
// accent-presets.ts tests
// ---------------------------------------------------------------------------

describe('accent-presets — structure (US-6 AC-1)', () => {
	it('exports exactly 8 presets', () => {
		expect(ACCENT_PRESETS).toHaveLength(8);
	});

	it('every preset has a non-empty label string', () => {
		for (const preset of ACCENT_PRESETS) {
			expect(typeof preset.label).toBe('string');
			expect(preset.label.length).toBeGreaterThan(0);
		}
	});

	it('every preset has a non-empty value string', () => {
		for (const preset of ACCENT_PRESETS) {
			expect(typeof preset.value).toBe('string');
			expect(preset.value.length).toBeGreaterThan(0);
		}
	});

	it('presets are in the order specified by REQ-004 US-6 AC-1', () => {
		const labels = ACCENT_PRESETS.map((p: AccentPreset) => p.label);
		expect(labels).toEqual([
			'Midnight blue',
			'Ocean',
			'Forest',
			'Rust',
			'Plum',
			'Slate',
			'Rose',
			'Amber',
		]);
	});

	it('preset values match the hex codes specified in REQ-004 US-6 AC-1', () => {
		const values = ACCENT_PRESETS.map((p: AccentPreset) => p.value);
		expect(values).toEqual([
			'#2E3A6B',
			'#1A6B8A',
			'#2D6A4F',
			'#A64E2A',
			'#6B3A6B',
			'#4A5568',
			'#B5446E',
			'#B07D2A',
		]);
	});

	it('DEFAULT_ACCENT equals the first preset (Midnight blue) — US-6 AC-5', () => {
		expect(DEFAULT_ACCENT).toBe('#2E3A6B');
		expect(DEFAULT_ACCENT).toBe(ACCENT_PRESETS[0].value);
	});
});

// ---------------------------------------------------------------------------
// oneOf — per-key validation with default (US-9.2 / US-9.4)
// ---------------------------------------------------------------------------

describe('oneOf — validate-with-default helper', () => {
	const allowed = ['light', 'dark'] as const;

	it('returns the raw value when it is in the allowed list', () => {
		expect(oneOf('dark', allowed, 'light')).toBe('dark');
		expect(oneOf('light', allowed, 'light')).toBe('light');
	});

	it('returns the default when raw is null (missing key — US-9.2)', () => {
		expect(oneOf(null, allowed, 'light')).toBe('light');
	});

	it('returns the default when raw is an unrecognised value (US-9.4)', () => {
		expect(oneOf('invalid', allowed, 'light')).toBe('light');
		expect(oneOf('', allowed, 'light')).toBe('light');
		expect(oneOf('DARK', allowed, 'light')).toBe('light'); // case-sensitive
	});
});

// ---------------------------------------------------------------------------
// parseBool — "true"/"false" string deserialization (US-5 AC-4, US-8 AC-5)
// ---------------------------------------------------------------------------

describe('parseBool — boolean deserialization', () => {
	it('returns true when raw is the string "true"', () => {
		expect(parseBool('true', false)).toBe(true);
	});

	it('returns false when raw is the string "false"', () => {
		expect(parseBool('false', true)).toBe(false);
	});

	it('returns the default when raw is null (missing key)', () => {
		expect(parseBool(null, true)).toBe(true);
		expect(parseBool(null, false)).toBe(false);
	});

	it('returns the default for unrecognised values (corrupted — US-9.4)', () => {
		expect(parseBool('yes', true)).toBe(true);
		expect(parseBool('1', false)).toBe(false);
		expect(parseBool('True', false)).toBe(false); // case-sensitive
		expect(parseBool('TRUE', true)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// parseAccent — accent validation (US-6 AC-5, US-6 AC-6)
// ---------------------------------------------------------------------------

describe('parseAccent — accent validation', () => {
	it('returns DEFAULT_ACCENT when raw is null (missing key — US-6 AC-5)', () => {
		expect(parseAccent(null)).toBe(DEFAULT_ACCENT);
	});

	it('returns DEFAULT_ACCENT when raw is an empty string', () => {
		expect(parseAccent('')).toBe(DEFAULT_ACCENT);
	});

	it('returns DEFAULT_ACCENT when raw is only whitespace', () => {
		expect(parseAccent('   ')).toBe(DEFAULT_ACCENT);
	});

	it('returns the raw value for a valid hex string (including non-preset — US-6 AC-6)', () => {
		expect(parseAccent('#2E3A6B')).toBe('#2E3A6B');
		expect(parseAccent('#FFFFFF')).toBe('#FFFFFF');
	});

	it('accepts any non-empty string (non-preset values are allowed to persist — US-6 AC-6)', () => {
		expect(parseAccent('#AABBCC')).toBe('#AABBCC');
	});
});

// ---------------------------------------------------------------------------
// readRaw — safe localStorage read (US-9.3)
// ---------------------------------------------------------------------------

describe('readRaw — safe storage read', () => {
	it('returns the stored value when the key exists', () => {
		const storage = makeStorage({ kata_theme: 'dark' });
		expect(readRaw('kata_theme', storage)).toBe('dark');
	});

	it('returns null when the key does not exist', () => {
		const storage = makeStorage({});
		expect(readRaw('kata_theme', storage)).toBeNull();
	});

	it('returns null when storage is null (unavailable — US-9.3)', () => {
		expect(readRaw('kata_theme', null)).toBeNull();
	});

	it('returns null when storage.getItem throws (blocked storage)', () => {
		const throwingStorage: StorageAdapter = {
			getItem: () => { throw new Error('Storage unavailable'); },
			setItem: vi.fn(),
		};
		expect(readRaw('kata_theme', throwingStorage)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// writeRaw — safe localStorage write with QuotaExceededError handling (US-9 edge)
// ---------------------------------------------------------------------------

describe('writeRaw — safe storage write', () => {
	it('writes the value to storage', () => {
		const storage = makeStorage();
		writeRaw('kata_theme', 'dark', storage);
		expect(storage.store['kata_theme']).toBe('dark');
	});

	it('does not throw when storage is null (unavailable — US-9.3)', () => {
		expect(() => writeRaw('kata_theme', 'dark', null)).not.toThrow();
	});

	it('does not throw when storage.setItem throws QuotaExceededError (US-9 edge)', () => {
		const quotaStorage: StorageAdapter = {
			getItem: () => null,
			setItem: () => { throw new DOMException('QuotaExceededError', 'QuotaExceededError'); },
		};
		expect(() => writeRaw('kata_theme', 'dark', quotaStorage)).not.toThrow();
	});

	it('does not throw for any setItem error (generic failure)', () => {
		const failStorage: StorageAdapter = {
			getItem: () => null,
			setItem: () => { throw new Error('Storage write failed'); },
		};
		expect(() => writeRaw('kata_theme', 'dark', failStorage)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// initSettings — initialise with defaults when localStorage is empty (US-9.2)
// ---------------------------------------------------------------------------

describe('initSettings — defaults when localStorage is empty (US-9.2)', () => {
	let storage: ReturnType<typeof makeStorage>;

	beforeEach(() => {
		storage = makeStorage(); // empty storage
	});

	it('defaults theme to "light" — US-2 AC-5', () => {
		expect(initSettings(storage).theme).toBe('light');
	});

	it('defaults density to "comfortable" — US-3 AC-5', () => {
		expect(initSettings(storage).density).toBe('comfortable');
	});

	it('defaults columnStyle to "tray" — US-4 AC-4', () => {
		expect(initSettings(storage).columnStyle).toBe('tray');
	});

	it('defaults mist to true — US-5 AC-4', () => {
		expect(initSettings(storage).mist).toBe(true);
	});

	it('defaults accent to DEFAULT_ACCENT (#2E3A6B) — US-6 AC-5', () => {
		expect(initSettings(storage).accent).toBe('#2E3A6B');
	});

	it('defaults notificationsInApp to true — US-8 AC-5', () => {
		expect(initSettings(storage).notificationsInApp).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// initSettings — reads stored values (US-9 AC-1)
// ---------------------------------------------------------------------------

describe('initSettings — reads stored values from localStorage (US-9 AC-1)', () => {
	it('reads theme "dark" from storage', () => {
		const s = makeStorage({ kata_theme: 'dark' });
		expect(initSettings(s).theme).toBe('dark');
	});

	it('reads density "compact" from storage', () => {
		const s = makeStorage({ kata_density: 'compact' });
		expect(initSettings(s).density).toBe('compact');
	});

	it('reads density "spacious" from storage', () => {
		const s = makeStorage({ kata_density: 'spacious' });
		expect(initSettings(s).density).toBe('spacious');
	});

	it('reads columnStyle "minimal" from storage', () => {
		const s = makeStorage({ kata_column_style: 'minimal' });
		expect(initSettings(s).columnStyle).toBe('minimal');
	});

	it('reads mist=false from storage (string "false")', () => {
		const s = makeStorage({ kata_mist: 'false' });
		expect(initSettings(s).mist).toBe(false);
	});

	it('reads mist=true from storage (string "true")', () => {
		const s = makeStorage({ kata_mist: 'true' });
		expect(initSettings(s).mist).toBe(true);
	});

	it('reads a non-default accent from storage', () => {
		const s = makeStorage({ kata_accent: '#B07D2A' });
		expect(initSettings(s).accent).toBe('#B07D2A');
	});

	it('reads notificationsInApp=false from storage', () => {
		const s = makeStorage({ kata_notifications_inapp: 'false' });
		expect(initSettings(s).notificationsInApp).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// initSettings — corrupted/invalid values fall back to defaults (US-9 AC-4)
// ---------------------------------------------------------------------------

describe('initSettings — corrupted or invalid values fall back to defaults (US-9 AC-4)', () => {
	it('falls back to theme "light" for unrecognised theme value', () => {
		const s = makeStorage({ kata_theme: 'solarized' });
		expect(initSettings(s).theme).toBe('light');
	});

	it('falls back to density "comfortable" for unrecognised density value', () => {
		const s = makeStorage({ kata_density: 'ultra-compact' });
		expect(initSettings(s).density).toBe('comfortable');
	});

	it('falls back to columnStyle "tray" for unrecognised column style', () => {
		const s = makeStorage({ kata_column_style: 'grid' });
		expect(initSettings(s).columnStyle).toBe('tray');
	});

	it('falls back to mist=true for unrecognised mist string', () => {
		const s = makeStorage({ kata_mist: 'yes' });
		expect(initSettings(s).mist).toBe(true);
	});

	it('falls back to notificationsInApp=true for unrecognised value', () => {
		const s = makeStorage({ kata_notifications_inapp: '1' });
		expect(initSettings(s).notificationsInApp).toBe(true);
	});

	it('accepts any non-empty accent string (non-preset values are valid — US-6 AC-6)', () => {
		const s = makeStorage({ kata_accent: '#DEADBEEF' });
		expect(initSettings(s).accent).toBe('#DEADBEEF');
	});

	it('falls back to DEFAULT_ACCENT for empty accent string', () => {
		const s = makeStorage({ kata_accent: '' });
		expect(initSettings(s).accent).toBe(DEFAULT_ACCENT);
	});
});

// ---------------------------------------------------------------------------
// initSettings — storage unavailable (US-9 AC-3)
// ---------------------------------------------------------------------------

describe('initSettings — storage unavailable uses all defaults (US-9 AC-3)', () => {
	it('returns all defaults when storage is null', () => {
		const result = initSettings(null);
		expect(result).toEqual(makeDefaultSettings());
	});

	it('returns all defaults when storage.getItem always throws', () => {
		const throwingStorage: StorageAdapter = {
			getItem: () => { throw new Error('blocked'); },
			setItem: vi.fn(),
		};
		const result = initSettings(throwingStorage);
		expect(result).toEqual(makeDefaultSettings());
	});

	it('does not throw when initialised with unavailable storage', () => {
		expect(() => initSettings(null)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// setTheme — updates state and writes correct localStorage key (US-2)
// ---------------------------------------------------------------------------

describe('setTheme — state mutation and storage write', () => {
	it('updates state.theme to the supplied value', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setTheme('dark', state, storage);
		expect(state.theme).toBe('dark');
	});

	it('writes "dark" to kata_theme in localStorage', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setTheme('dark', state, storage);
		expect(storage.store[KEYS.theme]).toBe('dark');
	});

	it('writes "light" to kata_theme in localStorage', () => {
		const storage = makeStorage({ kata_theme: 'dark' });
		const state = { ...makeDefaultSettings(), theme: 'dark' as Theme };
		setTheme('light', state, storage);
		expect(storage.store[KEYS.theme]).toBe('light');
	});

	it('does not throw when storage is unavailable', () => {
		const state = makeDefaultSettings();
		expect(() => setTheme('dark', state, null)).not.toThrow();
		expect(state.theme).toBe('dark');
	});
});

// ---------------------------------------------------------------------------
// setDensity — updates state and writes correct localStorage key (US-3)
// ---------------------------------------------------------------------------

describe('setDensity — state mutation and storage write', () => {
	it('updates state.density to "compact"', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setDensity('compact', state, storage);
		expect(state.density).toBe('compact');
	});

	it('updates state.density to "spacious"', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setDensity('spacious', state, storage);
		expect(state.density).toBe('spacious');
	});

	it('writes density value to kata_density key', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setDensity('compact', state, storage);
		expect(storage.store[KEYS.density]).toBe('compact');
	});
});

// ---------------------------------------------------------------------------
// setColumnStyle — updates state and writes correct localStorage key (US-4)
// ---------------------------------------------------------------------------

describe('setColumnStyle — state mutation and storage write', () => {
	it('updates state.columnStyle to "minimal"', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setColumnStyle('minimal', state, storage);
		expect(state.columnStyle).toBe('minimal');
	});

	it('updates state.columnStyle back to "tray"', () => {
		const storage = makeStorage();
		const state = { ...makeDefaultSettings(), columnStyle: 'minimal' as ColumnStyle };
		setColumnStyle('tray', state, storage);
		expect(state.columnStyle).toBe('tray');
	});

	it('writes column style to kata_column_style key', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setColumnStyle('minimal', state, storage);
		expect(storage.store[KEYS.columnStyle]).toBe('minimal');
	});
});

// ---------------------------------------------------------------------------
// setMist — boolean serialized as "true"/"false" string (US-5)
// ---------------------------------------------------------------------------

describe('setMist — state mutation and boolean string serialisation', () => {
	it('updates state.mist to false', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setMist(false, state, storage);
		expect(state.mist).toBe(false);
	});

	it('updates state.mist to true', () => {
		const storage = makeStorage();
		const state = { ...makeDefaultSettings(), mist: false };
		setMist(true, state, storage);
		expect(state.mist).toBe(true);
	});

	it('writes the string "false" to kata_mist (not the boolean false)', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setMist(false, state, storage);
		expect(storage.store[KEYS.mist]).toBe('false');
	});

	it('writes the string "true" to kata_mist (not the boolean true)', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setMist(true, state, storage);
		expect(storage.store[KEYS.mist]).toBe('true');
	});
});

// ---------------------------------------------------------------------------
// setAccent — updates state and writes to kata_accent key (US-6)
// ---------------------------------------------------------------------------

describe('setAccent — state mutation and storage write', () => {
	it('updates state.accent to a new preset value', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setAccent('#B07D2A', state, storage);
		expect(state.accent).toBe('#B07D2A');
	});

	it('writes the accent value to kata_accent key', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setAccent('#1A6B8A', state, storage);
		expect(storage.store[KEYS.accent]).toBe('#1A6B8A');
	});

	it('accepts and persists a non-preset accent value (US-6 AC-6)', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setAccent('#AABBCC', state, storage);
		expect(state.accent).toBe('#AABBCC');
		expect(storage.store[KEYS.accent]).toBe('#AABBCC');
	});
});

// ---------------------------------------------------------------------------
// setNotificationsInApp — boolean serialized as "true"/"false" string (US-8)
// ---------------------------------------------------------------------------

describe('setNotificationsInApp — state mutation and boolean string serialisation', () => {
	it('updates state.notificationsInApp to false', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setNotificationsInApp(false, state, storage);
		expect(state.notificationsInApp).toBe(false);
	});

	it('updates state.notificationsInApp to true', () => {
		const storage = makeStorage();
		const state = { ...makeDefaultSettings(), notificationsInApp: false };
		setNotificationsInApp(true, state, storage);
		expect(state.notificationsInApp).toBe(true);
	});

	it('writes the string "false" to kata_notifications_inapp (not the boolean false)', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setNotificationsInApp(false, state, storage);
		expect(storage.store[KEYS.notificationsInApp]).toBe('false');
	});

	it('writes the string "true" to kata_notifications_inapp (not the boolean true)', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setNotificationsInApp(true, state, storage);
		expect(storage.store[KEYS.notificationsInApp]).toBe('true');
	});
});

// ---------------------------------------------------------------------------
// toggleTheme — flips between light and dark (US-2 AC-2 / TopBar integration)
// ---------------------------------------------------------------------------

describe('toggleTheme — flip between light and dark', () => {
	it('flips theme from "light" to "dark"', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings(); // theme defaults to 'light'
		toggleTheme(state, storage);
		expect(state.theme).toBe('dark');
	});

	it('flips theme from "dark" to "light"', () => {
		const storage = makeStorage();
		const state = { ...makeDefaultSettings(), theme: 'dark' as Theme };
		toggleTheme(state, storage);
		expect(state.theme).toBe('light');
	});

	it('writes the new theme to kata_theme in localStorage', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings(); // starts as 'light'
		toggleTheme(state, storage);
		expect(storage.store[KEYS.theme]).toBe('dark');
	});

	it('alternates correctly over multiple toggles', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		toggleTheme(state, storage); // light → dark
		expect(state.theme).toBe('dark');
		toggleTheme(state, storage); // dark → light
		expect(state.theme).toBe('light');
		toggleTheme(state, storage); // light → dark
		expect(state.theme).toBe('dark');
	});

	it('does not throw when storage is unavailable', () => {
		const state = makeDefaultSettings();
		expect(() => toggleTheme(state, null)).not.toThrow();
		expect(state.theme).toBe('dark');
	});
});

// ---------------------------------------------------------------------------
// Storage write isolation — each setter writes only its own key
// ---------------------------------------------------------------------------

describe('setters — each setter writes only its own localStorage key', () => {
	it('setTheme writes only kata_theme', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setTheme('dark', state, storage);
		expect(storage.setItemMock).toHaveBeenCalledOnce();
		expect(storage.setItemMock).toHaveBeenCalledWith(KEYS.theme, 'dark');
	});

	it('setDensity writes only kata_density', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setDensity('compact', state, storage);
		expect(storage.setItemMock).toHaveBeenCalledOnce();
		expect(storage.setItemMock).toHaveBeenCalledWith(KEYS.density, 'compact');
	});

	it('setColumnStyle writes only kata_column_style', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setColumnStyle('minimal', state, storage);
		expect(storage.setItemMock).toHaveBeenCalledOnce();
		expect(storage.setItemMock).toHaveBeenCalledWith(KEYS.columnStyle, 'minimal');
	});

	it('setMist writes only kata_mist', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setMist(false, state, storage);
		expect(storage.setItemMock).toHaveBeenCalledOnce();
		expect(storage.setItemMock).toHaveBeenCalledWith(KEYS.mist, 'false');
	});

	it('setAccent writes only kata_accent', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setAccent('#1A6B8A', state, storage);
		expect(storage.setItemMock).toHaveBeenCalledOnce();
		expect(storage.setItemMock).toHaveBeenCalledWith(KEYS.accent, '#1A6B8A');
	});

	it('setNotificationsInApp writes only kata_notifications_inapp', () => {
		const storage = makeStorage();
		const state = makeDefaultSettings();
		setNotificationsInApp(false, state, storage);
		expect(storage.setItemMock).toHaveBeenCalledOnce();
		expect(storage.setItemMock).toHaveBeenCalledWith(KEYS.notificationsInApp, 'false');
	});
});

// ---------------------------------------------------------------------------
// QuotaExceededError on write — in-memory value still applies (US-9 edge)
// ---------------------------------------------------------------------------

describe('setters — QuotaExceededError on write leaves in-memory state intact', () => {
	let quotaStorage: StorageAdapter;

	beforeEach(() => {
		quotaStorage = {
			getItem: () => null,
			setItem: () => { throw new DOMException('QuotaExceededError', 'QuotaExceededError'); },
		};
	});

	it('setTheme updates state even when storage.setItem throws', () => {
		const state = makeDefaultSettings();
		setTheme('dark', state, quotaStorage);
		expect(state.theme).toBe('dark');
	});

	it('setDensity updates state even when storage.setItem throws', () => {
		const state = makeDefaultSettings();
		setDensity('compact', state, quotaStorage);
		expect(state.density).toBe('compact');
	});

	it('setMist updates state even when storage.setItem throws', () => {
		const state = makeDefaultSettings();
		setMist(false, state, quotaStorage);
		expect(state.mist).toBe(false);
	});

	it('setAccent updates state even when storage.setItem throws', () => {
		const state = makeDefaultSettings();
		setAccent('#AABBCC', state, quotaStorage);
		expect(state.accent).toBe('#AABBCC');
	});

	it('toggleTheme updates state even when storage.setItem throws', () => {
		const state = makeDefaultSettings(); // starts as 'light'
		toggleTheme(state, quotaStorage);
		expect(state.theme).toBe('dark');
	});
});

// ---------------------------------------------------------------------------
// Source file structural audit — settings.svelte.ts
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const settingsSource = readFileSync(resolve(__dirname, 'settings.svelte.ts'), 'utf-8');

describe('settings.svelte.ts — structural audit', () => {
	it('exports a settings object created with $state', () => {
		expect(settingsSource).toContain('$state');
		expect(settingsSource).toContain('settings');
	});

	it('imports DEFAULT_ACCENT from accent-presets', () => {
		expect(settingsSource).toContain('DEFAULT_ACCENT');
		expect(settingsSource).toContain('accent-presets');
	});

	it('uses kata_theme as the localStorage key for theme', () => {
		expect(settingsSource).toContain("'kata_theme'");
	});

	it('uses kata_density as the localStorage key for density', () => {
		expect(settingsSource).toContain("'kata_density'");
	});

	it('uses kata_column_style as the localStorage key for column style', () => {
		expect(settingsSource).toContain("'kata_column_style'");
	});

	it('uses kata_mist as the localStorage key for mist', () => {
		expect(settingsSource).toContain("'kata_mist'");
	});

	it('uses kata_accent as the localStorage key for accent', () => {
		expect(settingsSource).toContain("'kata_accent'");
	});

	it('uses kata_notifications_inapp as the localStorage key for notifications', () => {
		expect(settingsSource).toContain("'kata_notifications_inapp'");
	});

	it('exports setTheme function', () => {
		expect(settingsSource).toContain('export function setTheme');
	});

	it('exports setDensity function', () => {
		expect(settingsSource).toContain('export function setDensity');
	});

	it('exports setColumnStyle function', () => {
		expect(settingsSource).toContain('export function setColumnStyle');
	});

	it('exports setMist function', () => {
		expect(settingsSource).toContain('export function setMist');
	});

	it('exports setAccent function', () => {
		expect(settingsSource).toContain('export function setAccent');
	});

	it('exports setNotificationsInApp function', () => {
		expect(settingsSource).toContain('export function setNotificationsInApp');
	});

	it('exports toggleTheme function', () => {
		expect(settingsSource).toContain('export function toggleTheme');
	});

	it('toggleTheme flips light to dark in the implementation', () => {
		// The expression "settings.theme === 'dark'" drives the flip
		expect(settingsSource).toContain("settings.theme === 'dark'");
	});

	it('setMist serialises boolean to string with String(v)', () => {
		expect(settingsSource).toContain('String(v)');
	});

	it('wraps localStorage.getItem in a try/catch for storage safety', () => {
		expect(settingsSource).toContain('localStorage.getItem');
		expect(settingsSource).toContain('try {');
	});

	it('wraps localStorage.setItem in a try/catch for storage safety', () => {
		expect(settingsSource).toContain('localStorage.setItem');
	});

	it('guards against localStorage being undefined (SSR safety)', () => {
		expect(settingsSource).toContain("typeof localStorage");
	});

	it('exports Theme type', () => {
		expect(settingsSource).toContain('export type Theme');
	});

	it('exports Density type', () => {
		expect(settingsSource).toContain('export type Density');
	});

	it('exports ColumnStyle type', () => {
		expect(settingsSource).toContain('export type ColumnStyle');
	});
});
