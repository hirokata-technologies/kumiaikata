// Structural audit for REQ-001 US-3 AC2: the 7 auth-guarded shell routes
// include 6 placeholder pages with minimal content ("Coming soon."). No
// renderer is available (vitest.config.ts has no jsdom/sveltekit plugin),
// so this reads each +page.svelte source and asserts on it structurally —
// table-driven across all 6 placeholder routes.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PLACEHOLDER_ROUTES = ['week', 'backlog', 'todo', 'board', 'matrix', 'roadmap'] as const;

describe.each(PLACEHOLDER_ROUTES)('(app)/%s/+page.svelte — placeholder content (US-3 AC2)', (route) => {
	const source = readFileSync(resolve(__dirname, route, '+page.svelte'), 'utf-8');

	it('renders an <h1>', () => {
		expect(source).toMatch(/<h1>[^<]+<\/h1>/);
	});

	it('contains the literal "Coming soon." copy', () => {
		expect(source).toContain('Coming soon.');
	});
});
