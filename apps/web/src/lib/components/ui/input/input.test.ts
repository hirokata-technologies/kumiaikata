// Structural audit for REQ-001 US-1 AC3: UI primitives are composed from
// Shadcn/bits-ui primitives, not a bespoke kit.
//
// Deviation from the test plan's literal wording: the plan's case list says
// "each of the four primitives imports from bits-ui". input.svelte does
// not — shadcn-svelte's own upstream Input component is a plain <input>
// element styled with the shared cn() helper, not a bits-ui wrapper (only
// interactive/composite primitives like Avatar and Separator wrap bits-ui
// in shadcn-svelte). Asserting a bits-ui import here would fail against
// correct, on-convention shipped code. This audits the actual shadcn
// signature instead: the data-slot="input" marker and the shared cn()
// helper, which is what marks this as the shadcn pattern rather than a
// bespoke kit.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

let source: string;

beforeAll(() => {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	source = readFileSync(resolve(__dirname, 'input.svelte'), 'utf-8');
});

describe('input.svelte — shadcn primitive pattern (US-1 AC3)', () => {
	it('marks the rendered element data-slot="input" (the shadcn convention)', () => {
		expect(source).toContain('data-slot="input"');
	});

	it('uses the shared cn() class-merge helper from $lib/utils', () => {
		expect(source).toMatch(/from\s*["']\$lib\/utils\.js["']/);
		expect(source).toContain('cn(');
	});

	it('binds value and forwards the native input type, not a bespoke widget', () => {
		expect(source).toContain('bind:value');
		expect(source).toContain('{type}');
	});
});
