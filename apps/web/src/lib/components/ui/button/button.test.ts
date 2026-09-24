// Structural audit for REQ-001 US-1 AC3: UI primitives are composed from
// Shadcn/bits-ui primitives, not a bespoke kit.
//
// Deviation from the test plan's literal wording: the plan's case list says
// "each of the four primitives imports from bits-ui". button.svelte does
// not — shadcn-svelte's own upstream Button component is a plain
// <a>/<button> styled with tailwind-variants, not a bits-ui wrapper (only
// interactive/composite primitives like Avatar and Separator wrap bits-ui
// in shadcn-svelte). Asserting a bits-ui import here would fail against
// correct, on-convention shipped code. This audits the actual shadcn
// signature instead: the tailwind-variants variant/size API and the shared
// cn() helper from $lib/utils, which is what marks this as the shadcn
// pattern rather than a bespoke kit.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

let source: string;

beforeAll(() => {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	source = readFileSync(resolve(__dirname, 'button.svelte'), 'utf-8');
});

describe('button.svelte — shadcn tailwind-variants pattern (US-1 AC3)', () => {
	it('defines buttonVariants with tailwind-variants (tv)', () => {
		expect(source).toMatch(/from\s*["']tailwind-variants["']/);
		expect(source).toContain('export const buttonVariants = tv(');
	});

	it('declares the shadcn variant set (default/destructive/outline/secondary/ghost/link)', () => {
		for (const variant of ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link']) {
			expect(source).toContain(`${variant}:`);
		}
	});

	it('declares the shadcn size set (default/sm/lg/icon)', () => {
		expect(source).toContain('size:');
		expect(source).toContain('sm:');
		expect(source).toContain('lg:');
		expect(source).toContain('icon:');
	});

	it('uses the shared cn() class-merge helper from $lib/utils', () => {
		expect(source).toMatch(/from\s*["']\$lib\/utils\.js["']/);
		expect(source).toContain('cn(');
	});

	it('renders an <a> when href is set and a <button> otherwise (link/button duality, not a new kit)', () => {
		expect(source).toContain('<a');
		expect(source).toContain('<button');
	});
});
