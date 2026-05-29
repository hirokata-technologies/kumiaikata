export type AccentPreset = { label: string; value: string };

export const ACCENT_PRESETS: AccentPreset[] = [
	{ label: 'Midnight blue', value: '#2E3A6B' },
	{ label: 'Ocean',         value: '#1A6B8A' },
	{ label: 'Forest',        value: '#2D6A4F' },
	{ label: 'Rust',          value: '#A64E2A' },
	{ label: 'Plum',          value: '#6B3A6B' },
	{ label: 'Slate',         value: '#4A5568' },
	{ label: 'Rose',          value: '#B5446E' },
	{ label: 'Amber',         value: '#B07D2A' },
];

export const DEFAULT_ACCENT = '#2E3A6B'; // Midnight blue (US-6.5)
