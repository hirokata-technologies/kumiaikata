// Structural audit for REQ-001 US-1 AC3: UI primitives are composed from
// Shadcn/bits-ui primitives, not a bespoke kit. No renderer is available
// (vitest.config.ts has no jsdom/sveltekit plugin), so this reads the
// component source and asserts on it structurally — same strategy as
// login-page.test.ts / workspace-restore.test.ts.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

let source: string;

beforeAll(() => {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	source = readFileSync(resolve(__dirname, 'separator.svelte'), 'utf-8');
});

describe('separator.svelte — composed from bits-ui (US-1 AC3)', () => {
	it('imports the Separator primitive from bits-ui', () => {
		expect(source).toMatch(/import\s*\{\s*Separator as SeparatorPrimitive\s*\}\s*from\s*["']bits-ui["']/);
	});

	it('renders SeparatorPrimitive.Root, not a hand-rolled <hr>/<div>', () => {
		expect(source).toContain('<SeparatorPrimitive.Root');
	});

	it('uses the shadcn cn() class-merge helper from $lib/utils', () => {
		expect(source).toMatch(/from\s*["']\$lib\/utils\.js["']/);
		expect(source).toContain('cn(');
	});
});
