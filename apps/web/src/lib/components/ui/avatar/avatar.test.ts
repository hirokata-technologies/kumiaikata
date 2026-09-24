// Structural audit for REQ-001 US-1 AC3: UI primitives are composed from
// Shadcn/bits-ui primitives, not a bespoke kit. No renderer is available
// (vitest.config.ts has no jsdom/sveltekit plugin), so this reads the
// component source and asserts on it structurally.
//
// Covers all three files behind the avatar/ barrel (Root, Image, Fallback) —
// AppHeader.svelte's `Avatar.Root` / `Avatar.Image` / `Avatar.Fallback` usage
// resolves to these three.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

let rootSource: string;
let imageSource: string;
let fallbackSource: string;
let indexSource: string;

beforeAll(() => {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	rootSource = readFileSync(resolve(__dirname, 'avatar.svelte'), 'utf-8');
	imageSource = readFileSync(resolve(__dirname, 'avatar-image.svelte'), 'utf-8');
	fallbackSource = readFileSync(resolve(__dirname, 'avatar-fallback.svelte'), 'utf-8');
	indexSource = readFileSync(resolve(__dirname, 'index.ts'), 'utf-8');
});

describe('avatar.svelte (Root) — composed from bits-ui (US-1 AC3)', () => {
	it('imports the Avatar primitive from bits-ui', () => {
		expect(rootSource).toMatch(/import\s*\{\s*Avatar as AvatarPrimitive\s*\}\s*from\s*["']bits-ui["']/);
	});

	it('renders AvatarPrimitive.Root', () => {
		expect(rootSource).toContain('<AvatarPrimitive.Root');
	});
});

describe('avatar-image.svelte — composed from bits-ui (US-1 AC3)', () => {
	it('imports the Avatar primitive from bits-ui', () => {
		expect(imageSource).toMatch(/import\s*\{\s*Avatar as AvatarPrimitive\s*\}\s*from\s*["']bits-ui["']/);
	});

	it('renders AvatarPrimitive.Image', () => {
		expect(imageSource).toContain('<AvatarPrimitive.Image');
	});
});

describe('avatar-fallback.svelte — composed from bits-ui (US-1 AC3)', () => {
	it('imports the Avatar primitive from bits-ui', () => {
		expect(fallbackSource).toMatch(/import\s*\{\s*Avatar as AvatarPrimitive\s*\}\s*from\s*["']bits-ui["']/);
	});

	it('renders AvatarPrimitive.Fallback', () => {
		expect(fallbackSource).toContain('<AvatarPrimitive.Fallback');
	});
});

describe('avatar/index.ts — barrel exports Root/Image/Fallback as Avatar.*', () => {
	it('re-exports Root, Image, Fallback under both bare and Avatar-qualified names', () => {
		expect(indexSource).toContain('Root as Avatar');
		expect(indexSource).toContain('Image as AvatarImage');
		expect(indexSource).toContain('Fallback as AvatarFallback');
	});
});
