// Render tests for REQ-002 US-2 AC3: AppHeader composes SearchBox, TicketCountPill, and
// Avatar.*, and derives `initials` / `displayName` from the current user. Replaces the old
// source-string audit in AppHeader.test.ts (which could only prove the imports and tags
// existed in source, and did not exercise `initials` at all).
//
// AppHeader mounts SearchBox, which imports `searchWorkspace` from `$lib/api` on a 200ms
// debounce. None of these tests type into the search box, so no request should fire, but
// `$lib/api` is stubbed per the foundation ticket's interface contract so mounting alone
// never touches the network.

import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from '@testing-library/svelte';
import AppHeader from './AppHeader.svelte';

vi.mock('$lib/api', () => ({
	searchWorkspace: vi.fn().mockResolvedValue({ goals: [], projects: [], requirements: [] })
}));

function baseUser(overrides: Partial<{ name: string | null; email: string; image: string | null }> = {}) {
	return { name: null, email: 'ada@example.com', ...overrides };
}

describe('AppHeader.svelte — composition (REQ-002 US-2 AC3)', () => {
	it('mounts SearchBox (a labeled search textbox is present)', async () => {
		render(AppHeader, { props: { user: baseUser(), tasksInProgress: 0 } });

		await expect
			.element(page.getByRole('textbox', { name: /search/i }))
			.toBeInTheDocument();
	});

	it('renders the tasksInProgress count via TicketCountPill, asserting only the number', async () => {
		render(AppHeader, { props: { user: baseUser(), tasksInProgress: 4 } });

		await expect.element(page.getByText('4', { exact: false })).toBeInTheDocument();
	});
});

describe('AppHeader.svelte — initials (REQ-002 US-2 AC3)', () => {
	it('a two-word name renders both initials', async () => {
		render(AppHeader, {
			props: { user: baseUser({ name: 'Ada Lovelace' }), tasksInProgress: 0 }
		});

		await expect.element(page.getByText('AL', { exact: true })).toBeInTheDocument();
	});

	it('a one-word name renders its first letter', async () => {
		render(AppHeader, { props: { user: baseUser({ name: 'Ada' }), tasksInProgress: 0 } });

		await expect.element(page.getByText('A', { exact: true })).toBeInTheDocument();
	});

	it('no name falls back to the first letter of the email, uppercased', async () => {
		render(AppHeader, {
			props: { user: baseUser({ name: null, email: 'zed@example.com' }), tasksInProgress: 0 }
		});

		await expect.element(page.getByText('Z', { exact: true })).toBeInTheDocument();
	});

	it('no name and an empty email falls through to "Y"', async () => {
		render(AppHeader, {
			props: { user: baseUser({ name: null, email: '' }), tasksInProgress: 0 }
		});

		await expect.element(page.getByText('Y', { exact: true })).toBeInTheDocument();
	});
});

describe('AppHeader.svelte — displayName (REQ-002 US-2 AC3)', () => {
	it('renders the trimmed name as the avatar title when present', async () => {
		const { container } = render(AppHeader, {
			props: { user: baseUser({ name: '  Ada Lovelace  ' }), tasksInProgress: 0 }
		});

		const avatar = container.querySelector('[data-avatar-root]') as HTMLElement | null;
		expect(avatar?.getAttribute('title')).toBe('Ada Lovelace');
	});

	it('falls back to the email when name is absent', async () => {
		const { container } = render(AppHeader, {
			props: { user: baseUser({ name: null, email: 'ada@example.com' }), tasksInProgress: 0 }
		});

		const avatar = container.querySelector('[data-avatar-root]') as HTMLElement | null;
		expect(avatar?.getAttribute('title')).toBe('ada@example.com');
	});

	it('falls back to "You" when both name and email are absent', async () => {
		const { container } = render(AppHeader, {
			props: { user: baseUser({ name: null, email: '' }), tasksInProgress: 0 }
		});

		const avatar = container.querySelector('[data-avatar-root]') as HTMLElement | null;
		expect(avatar?.getAttribute('title')).toBe('You');
	});
});

describe('AppHeader.svelte — avatar image vs. fallback (REQ-002 US-2 AC3)', () => {
	it('renders an avatar image element when user.image is set', async () => {
		const { container } = render(AppHeader, {
			props: {
				user: baseUser({ image: 'https://example.com/avatar.png' }),
				tasksInProgress: 0
			}
		});

		expect(container.querySelector('[data-avatar-image]')).not.toBeNull();
	});

	it('renders no image element when user.image is unset, only the fallback initials', async () => {
		const { container } = render(AppHeader, {
			props: { user: baseUser({ image: null, name: 'Ada Lovelace' }), tasksInProgress: 0 }
		});

		expect(container.querySelector('[data-avatar-image]')).toBeNull();
		await expect.element(page.getByText('AL', { exact: true })).toBeInTheDocument();
	});
});
