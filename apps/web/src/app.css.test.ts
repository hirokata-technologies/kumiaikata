// Design token audit for REQ-001: Kumiaikata app shell & data layer.
//
// app.css defines the design tokens the shell components consume as
// `var(--token)`. There is no CSS parser or renderer in this vitest config
// (environment: "node", no jsdom), so this reads the source as a string and
// asserts the literal token declarations are present — the same
// source-string audit strategy used by login-page.test.ts / workspace-restore.test.ts.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

let cssSource: string;

beforeAll(() => {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	cssSource = readFileSync(resolve(__dirname, 'app.css'), 'utf-8');
});

// ---------------------------------------------------------------------------
// US-1 AC1 — palette / semantic / spacing / radius / shadow / motion tokens
// ---------------------------------------------------------------------------

describe('app.css — paper & ink palette (US-1 AC1)', () => {
	it('defines the paper scale --paper-0 through --paper-3', () => {
		for (const i of [0, 1, 2, 3]) {
			expect(cssSource).toContain(`--paper-${i}:`);
		}
	});

	it('defines the ink scale --ink-0 through --ink-5', () => {
		for (const i of [0, 1, 2, 3, 4, 5]) {
			expect(cssSource).toContain(`--ink-${i}:`);
		}
	});
});

describe('app.css — accent tokens (US-1 AC1)', () => {
	it('defines --accent, --accent-hover, --accent-soft', () => {
		expect(cssSource).toContain('--accent:');
		expect(cssSource).toContain('--accent-hover:');
		expect(cssSource).toContain('--accent-soft:');
	});
});

describe('app.css — semantic tokens (US-1 AC1)', () => {
	it('defines --success, --warning, --danger, --info', () => {
		expect(cssSource).toContain('--success:');
		expect(cssSource).toContain('--warning:');
		expect(cssSource).toContain('--danger:');
		expect(cssSource).toContain('--info:');
	});

	it('defines the 3 soft-tint variants added by TASK-002', () => {
		expect(cssSource).toContain('--success-soft:');
		expect(cssSource).toContain('--warning-soft:');
		expect(cssSource).toContain('--danger-soft:');
	});
});

describe('app.css — spacing scale (US-1 AC1, TASK-002 addition — regression guard)', () => {
	it('defines --space-1 through --space-10', () => {
		for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
			expect(cssSource).toContain(`--space-${i}:`);
		}
	});
});

describe('app.css — radius scale (US-1 AC1)', () => {
	it('defines --radius-sm, --radius-md, --radius-lg, --radius-xl, --radius-pill', () => {
		expect(cssSource).toContain('--radius-sm:');
		expect(cssSource).toContain('--radius-md:');
		expect(cssSource).toContain('--radius-lg:');
		expect(cssSource).toContain('--radius-xl:');
		expect(cssSource).toContain('--radius-pill:');
	});
});

describe('app.css — shadow scale (US-1 AC1)', () => {
	it('defines --shadow-sm, --shadow-md, --shadow-lg', () => {
		expect(cssSource).toContain('--shadow-sm:');
		expect(cssSource).toContain('--shadow-md:');
		expect(cssSource).toContain('--shadow-lg:');
	});
});

describe('app.css — motion tokens (US-1 AC1)', () => {
	it('defines --dur-fast, --dur-base, --dur-slow', () => {
		expect(cssSource).toContain('--dur-fast:');
		expect(cssSource).toContain('--dur-base:');
		expect(cssSource).toContain('--dur-slow:');
	});

	it('defines --ease-out and --ease-in-out', () => {
		expect(cssSource).toContain('--ease-out:');
		expect(cssSource).toContain('--ease-in-out:');
	});
});

// ---------------------------------------------------------------------------
// US-1 AC2 — font tokens
// ---------------------------------------------------------------------------

describe('app.css — font tokens (US-1 AC2)', () => {
	it('--font-display contains Domine', () => {
		expect(cssSource).toMatch(/--font-display:\s*[^;]*Domine/);
	});

	it('--font-sans contains Manrope', () => {
		expect(cssSource).toMatch(/--font-sans:\s*[^;]*Manrope/);
	});

	it('--font-mono contains JetBrains Mono', () => {
		expect(cssSource).toMatch(/--font-mono:\s*[^;]*JetBrains Mono/);
	});
});

// ---------------------------------------------------------------------------
// TASK-002's @custom-variant dark fix — regression guard
// ---------------------------------------------------------------------------

describe('app.css — dark variant selector (TASK-002 fix — regression guard)', () => {
	it('the @custom-variant dark rule targets [data-theme="dark"], not the old .dark class', () => {
		const match = cssSource.match(/@custom-variant dark \((.*)\);/);
		expect(match).not.toBeNull();
		expect(match?.[1]).toContain('[data-theme="dark"]');
	});

	it('does not select the old bare .dark class in the custom-variant declaration', () => {
		const match = cssSource.match(/@custom-variant dark \((.*)\);/);
		expect(match?.[1]).not.toMatch(/&:where\(\.dark /);
	});

	it('the [data-theme="dark"] block overrides the palette tokens', () => {
		expect(cssSource).toContain('[data-theme="dark"] {');
	});
});
