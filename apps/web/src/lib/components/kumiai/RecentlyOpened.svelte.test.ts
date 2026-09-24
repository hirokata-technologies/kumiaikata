// Render tests for REQ-002 US-2 (edge case): RecentlyOpened's empty state, the five-item
// defensive cap, and the priority dot colour, replacing the old source-string audit in
// RecentlyOpened.test.ts (which could only prove the literal strings existed in source, not
// that the component actually renders that way).

import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from '@testing-library/svelte';
import RecentlyOpened from './RecentlyOpened.svelte';
import { projectPriorityPill } from '$lib/kumiai';
import type { RecentProject } from '$lib/api/kumiai/types.js';

function project(overrides: Partial<RecentProject> & { id: string }): RecentProject {
	return {
		title: `Project ${overrides.id}`,
		priority: 'medium',
		status: 'todo',
		openedAt: '2026-09-01T00:00:00Z',
		...overrides
	};
}

describe('RecentlyOpened.svelte — empty state (REQ-002 US-2 edge case)', () => {
	it('renders the eyebrow and the empty copy, and no list, when there are no projects', async () => {
		render(RecentlyOpened, { props: { projects: [] } });

		await expect.element(page.getByText('Recently opened')).toBeInTheDocument();
		await expect.element(page.getByText('No projects opened yet.')).toBeInTheDocument();
		await expect.element(page.getByRole('list')).not.toBeInTheDocument();
	});
});

describe('RecentlyOpened.svelte — populated list (REQ-002 US-2 edge case)', () => {
	it('renders one link per project, with title, id, and href', async () => {
		const projects = [
			project({ id: 'PROJ-001', title: 'Alpha' }),
			project({ id: 'PROJ-002', title: 'Beta' })
		];
		render(RecentlyOpened, { props: { projects } });

		await expect.element(page.getByText('Recently opened')).toBeInTheDocument();

		const links = page.getByRole('link');
		await expect.element(links.nth(0)).toBeInTheDocument();

		const alpha = page.getByRole('link', { name: /Alpha/ });
		await expect.element(alpha).toBeInTheDocument();
		await expect.element(alpha).toHaveAttribute('href', '/projects/PROJ-001');
		await expect.element(alpha.getByText('PROJ-001')).toBeInTheDocument();

		const beta = page.getByRole('link', { name: /Beta/ });
		await expect.element(beta).toBeInTheDocument();
		await expect.element(beta).toHaveAttribute('href', '/projects/PROJ-002');
	});

	it('caps the rendered list at 5 even when given 7 projects', async () => {
		const projects = Array.from({ length: 7 }, (_, i) =>
			project({ id: `PROJ-00${i + 1}`, title: `Project ${i + 1}` })
		);
		render(RecentlyOpened, { props: { projects } });

		const links = page.getByRole('link');
		await expect.element(links.first()).toBeInTheDocument();
		expect(links.all()).toHaveLength(5);
	});

	it('reflects a different colour for two different priorities via the shared palette', async () => {
		const projects = [
			project({ id: 'PROJ-001', title: 'Alpha', priority: 'urgent' }),
			project({ id: 'PROJ-002', title: 'Beta', priority: 'low' })
		];
		const { container } = render(RecentlyOpened, { props: { projects } });

		const dots = container.querySelectorAll('.recent-dot');
		expect(dots).toHaveLength(2);

		// Compare computed styles rather than raw hex strings — the browser normalizes
		// inline `background` values (e.g. to rgb()), so a probe element pushed through
		// the same CSSOM is the only reliable way to assert against the imported palette
		// function without fossilizing the browser's own serialization format.
		const doc = container.ownerDocument;
		function computedBackgroundFor(hex: string) {
			const probe = doc.createElement('span');
			probe.style.background = hex;
			doc.body.appendChild(probe);
			const value = doc.defaultView!.getComputedStyle(probe).backgroundColor;
			probe.remove();
			return value;
		}

		const urgentHex = projectPriorityPill('urgent').dotHex;
		const lowHex = projectPriorityPill('low').dotHex;
		expect(urgentHex).not.toBe(lowHex);

		const urgentBackground = doc.defaultView!.getComputedStyle(dots[0]).backgroundColor;
		const lowBackground = doc.defaultView!.getComputedStyle(dots[1]).backgroundColor;

		expect(urgentBackground).toBe(computedBackgroundFor(urgentHex));
		expect(lowBackground).toBe(computedBackgroundFor(lowHex));
		expect(urgentBackground).not.toBe(lowBackground);
	});
});
