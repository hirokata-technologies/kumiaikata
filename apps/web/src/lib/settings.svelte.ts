import { DEFAULT_ACCENT } from './accent-presets.js';

export type Theme = 'light' | 'dark';
export type Density = 'compact' | 'comfortable' | 'spacious';
export type ColumnStyle = 'tray' | 'minimal';
export type ChatPlacement = 'floating' | 'side' | 'overlay';

const KEYS = {
	theme: 'kata_theme',
	density: 'kata_density',
	columnStyle: 'kata_column_style',
	mist: 'kata_mist',
	accent: 'kata_accent',
	chatPlacement: 'kata_chat_placement',
	notificationsInApp: 'kata_notifications_inapp',
} as const;

// --- safe storage helpers (US-9.3 / quota edge) ---
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
		// QuotaExceeded / blocked — in-memory value still applies for the session (US-9 edge)
	}
}

// --- per-key parse-with-default (US-9.2 / US-9.4) ---
function oneOf<T extends string>(raw: string | null, allowed: readonly T[], def: T): T {
	return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : def;
}

function parseBool(raw: string | null, def: boolean): boolean {
	if (raw === 'true') return true;
	if (raw === 'false') return false;
	return def; // missing or unrecognised
}

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

function parseAccent(raw: string | null): string {
	// US-6.6: non-preset values are allowed to persist, but must be valid 6-digit hex
	// to prevent CSS injection from tampered localStorage.
	return raw && HEX_COLOR_RE.test(raw) ? raw : DEFAULT_ACCENT;
}

export const settings = $state({
	theme:              oneOf<Theme>(readRaw(KEYS.theme), ['light', 'dark'], 'light'),
	density:            oneOf<Density>(readRaw(KEYS.density), ['compact', 'comfortable', 'spacious'], 'comfortable'),
	columnStyle:        oneOf<ColumnStyle>(readRaw(KEYS.columnStyle), ['tray', 'minimal'], 'tray'),
	mist:               parseBool(readRaw(KEYS.mist), true),
	accent:             parseAccent(readRaw(KEYS.accent)),
	chatPlacement:      oneOf<ChatPlacement>(readRaw(KEYS.chatPlacement), ['floating', 'side', 'overlay'], 'floating'),
	notificationsInApp: parseBool(readRaw(KEYS.notificationsInApp), true),
});

export function setTheme(v: Theme): void {
	settings.theme = v;
	writeRaw(KEYS.theme, v);
}

export function setDensity(v: Density): void {
	settings.density = v;
	writeRaw(KEYS.density, v);
}

export function setColumnStyle(v: ColumnStyle): void {
	settings.columnStyle = v;
	writeRaw(KEYS.columnStyle, v);
}

export function setMist(v: boolean): void {
	settings.mist = v;
	writeRaw(KEYS.mist, String(v));
}

export function setAccent(v: string): void {
	settings.accent = v;
	writeRaw(KEYS.accent, v);
}

export function setChatPlacement(v: ChatPlacement): void {
	settings.chatPlacement = v;
	writeRaw(KEYS.chatPlacement, v);
}

export function setNotificationsInApp(v: boolean): void {
	settings.notificationsInApp = v;
	writeRaw(KEYS.notificationsInApp, String(v));
}

export function toggleTheme(): void {
	setTheme(settings.theme === 'dark' ? 'light' : 'dark');
}
