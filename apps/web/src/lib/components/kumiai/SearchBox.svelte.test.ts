// Retrofit for REQ-002 US-2 AC3 (BUG-007): the old SearchBox.test.ts was a source-string
// audit — it could prove `setTimeout(..., DEBOUNCE_MS)` appeared in the file text, but
// could not prove the debounce, the stale-response guard, outside-click/Escape close, or
// focus-reopen actually work. This file replaces it with real render/interaction tests in
// headless Chromium (Vitest Browser Mode, per TASK-021's foundation).
//
// What the old audit claimed, and what proves the same claim here now:
//   - "No results" string reached only via !hasResults           -> `renders the no-results state`
//   - DEBOUNCE_MS declared and used as the setTimeout delay       -> the two `debounce` tests
//   - selectProject calls goto, landingNoop does not              -> the `navigation` describe block
//   - Goal/Requirement buttons wire to landingNoop, Project to
//     selectProject                                                -> same `navigation` describe block
//   - imports searchWorkspace from $lib/api (real data layer)     -> implicit: every test here
//     drives the component through the mocked `searchWorkspace`, i.e. the component actually
//     calls it at runtime, which the old audit could only infer from an import statement.
//
// No `vi.useFakeTimers()` anywhere — DEBOUNCE_MS (200ms) is a real, short delay and Browser
// Mode's `expect.element()` is auto-retrying (poll-based), so we let the real timer elapse
// and assert through retrying queries instead of faking the clock (per TASK-021's brief:
// fake timers are unreliable against a real browser's scheduler).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from '@testing-library/svelte';
import SearchBox from './SearchBox.svelte';
// BUG-018: importing `goto` via the vitest-setup-browser.js relative re-export resolves a
// SECOND, disconnected module instance whose vi.fn() is not the one actually wired into
// `vi.mock('$app/navigation', ...)` in that setup file — `expect(goto).toHaveBeenCalledWith`
// would then always see 0 calls. Import `goto` directly from `$app/navigation` instead; that
// resolves through the same `vi.mock` registration the setup file installs for this project.
import { goto } from '$app/navigation';
import { searchWorkspace } from '$lib/api';
import type { KumiaiSearchResults } from '$lib/api/kumiai/types.js';

vi.mock('$lib/api', () => ({
	searchWorkspace: vi.fn()
}));

const mockedSearchWorkspace = vi.mocked(searchWorkspace);

const emptyResults: KumiaiSearchResults = { goals: [], projects: [], requirements: [] };

function withResults(overrides: Partial<KumiaiSearchResults>): KumiaiSearchResults {
	return { ...emptyResults, ...overrides };
}

const searchInput = () => page.getByLabelText('Search goals, projects, requirements');

/**
 * Simulates a pointerdown landing outside the component, the way SearchBox's own
 * outside-close effect listens for it (`document.addEventListener('pointerdown', ..., true)`).
 *
 * FLAGGED LIMITATION (filed as a bug — see the work log / final report for this ticket):
 * `userEvent.click(...)` from `vitest/browser` — regardless of target (a `page.getByRole`
 * locator, `page.elementLocator`, `document.body`, even a second independently-rendered
 * component instance) — was verified empirically in this environment (Vitest 4.1.7 +
 * `@vitest/browser-playwright` + headless Chromium via Playwright 1.63.0) to never dispatch
 * a native `pointerdown` (or even a plain `click` observed by a raw `addEventListener`) that
 * reaches a `document`-level listener. Real `userEvent.click` DOES correctly fire Svelte's
 * own `onclick={...}` prop handlers (proven by the Project/Goal/Requirement navigation tests
 * below), so the click delivery path exists — it just doesn't produce a `pointerdown` a raw
 * `document.addEventListener` can observe, which is exactly what this component's
 * outside-click detection relies on.
 *
 * Rather than leave "outside click closes the dropdown" unverified or fall back to reading
 * source text, this dispatches a genuine `PointerEvent('pointerdown', { bubbles: true })` —
 * a real DOM event, run through the real capture-phase listener and the real
 * `wrapRef.contains(...)` check — just triggered via `dispatchEvent` rather than simulated
 * hardware input. `target` defaults to `document.body`, which is never inside `wrapRef`.
 */
function dispatchOutsidePointerDown(target: EventTarget = document.body) {
	target.dispatchEvent(
		new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true })
	);
}

/**
 * Moves real browser focus off whatever is currently focused, for tests that need the
 * search input to be genuinely un-focused before refocusing it (refocusing an
 * already-focused input fires no `focus` event, which is exactly what the focus-reopen
 * tests below need to trigger). `userEvent.click` on a plain, real, appended element does
 * reliably move focus in this environment even though — per `dispatchOutsidePointerDown`'s
 * note above — it does not reliably deliver bubbling DOM events. The element is removed
 * immediately after, so it never becomes a visible/query-relevant part of the DOM.
 */
async function blurBySwitchingFocus() {
	const decoy = document.createElement('button');
	decoy.type = 'button';
	decoy.textContent = 'blur target';
	document.body.appendChild(decoy);
	try {
		await userEvent.click(page.getByRole('button', { name: 'blur target' }));
	} finally {
		decoy.remove();
	}
}

beforeEach(() => {
	mockedSearchWorkspace.mockReset();
	mockedSearchWorkspace.mockResolvedValue(emptyResults);
});

describe('SearchBox.svelte — debounce (US-2 AC5, BUG-007)', () => {
	it('does not call searchWorkspace immediately, calls it once after the debounce with the final query', async () => {
		render(SearchBox);

		await userEvent.type(searchInput(), 'abc');

		// Negative half: nothing has fired yet, well before 200ms elapses.
		expect(mockedSearchWorkspace).not.toHaveBeenCalled();

		// Positive half: after the debounce, exactly one call, carrying the final query.
		await vi.waitFor(() => {
			expect(mockedSearchWorkspace).toHaveBeenCalledTimes(1);
		});
		expect(mockedSearchWorkspace).toHaveBeenCalledWith('abc');
	});

	it('renders results once the debounced search resolves', async () => {
		mockedSearchWorkspace.mockResolvedValue(withResults({ projects: [{ id: 'p1', title: 'Alpha' }] }));
		render(SearchBox);

		await userEvent.type(searchInput(), 'alpha');

		await expect.element(page.getByText('Alpha')).toBeInTheDocument();
	});

	it('clearing the input to empty resets results and closes the dropdown without searching', async () => {
		mockedSearchWorkspace.mockResolvedValue(withResults({ projects: [{ id: 'p1', title: 'Alpha' }] }));
		render(SearchBox);

		await userEvent.type(searchInput(), 'alpha');
		await expect.element(page.getByText('Alpha')).toBeInTheDocument();

		mockedSearchWorkspace.mockClear();
		await userEvent.clear(searchInput());

		// Dropdown closes — results content disappears.
		await expect.element(page.getByText('Alpha')).not.toBeInTheDocument();

		// No new search fires from the clear itself. Clearing to empty runs the debounce
		// effect's `!trimmed` early-return branch, which never schedules a timer in the
		// first place — but to guard against a future regression that reintroduces a
		// debounced call here, poll rather than sleep a fixed amount: `vi.waitFor` retries
		// the positive assertion every 20ms across a window past the 200ms debounce, so a
		// stray call landing anywhere in that window is still caught even under CI
		// scheduling jitter, and `.rejects.toThrow()` turns "never became true within the
		// window" into the outcome this test actually expects.
		await expect(
			vi.waitFor(
				() => {
					expect(mockedSearchWorkspace).toHaveBeenCalled();
				},
				{ timeout: 300, interval: 20 }
			)
		).rejects.toThrow();
	});
});

describe('SearchBox.svelte — stale-response guard (US-2, BUG-007)', () => {
	it('applies the latest query result even when an earlier, slower search resolves after it', async () => {
		let resolveA: ((v: KumiaiSearchResults) => void) | undefined;
		let resolveAb: ((v: KumiaiSearchResults) => void) | undefined;

		mockedSearchWorkspace.mockImplementation((q: string) => {
			if (q === 'a') {
				return new Promise((resolve) => {
					resolveA = resolve;
				});
			}
			if (q === 'ab') {
				return new Promise((resolve) => {
					resolveAb = resolve;
				});
			}
			return Promise.resolve(emptyResults);
		});

		render(SearchBox);

		// Start a search for "a" and let its debounce fire, capturing the in-flight promise.
		await userEvent.type(searchInput(), 'a');
		await vi.waitFor(() => expect(mockedSearchWorkspace).toHaveBeenCalledWith('a'));

		// Move on to "ab" before "a" resolves, and let its debounce fire too.
		await userEvent.type(searchInput(), 'b');
		await vi.waitFor(() => expect(mockedSearchWorkspace).toHaveBeenCalledWith('ab'));

		// Resolve "ab" (the current query) first.
		resolveAb?.(withResults({ projects: [{ id: 'p-ab', title: 'AB Result' }] }));
		await expect.element(page.getByText('AB Result')).toBeInTheDocument();

		// Now resolve the stale "a" response — it must be discarded, not applied. No fixed
		// sleep needed here: the two `expect.element` assertions below are already
		// poll-based and auto-retrying, so they give the stale resolution's microtask
		// chain every chance to (wrongly) apply before their own timeout elapses.
		resolveA?.(withResults({ projects: [{ id: 'p-a', title: 'A Result' }] }));

		await expect.element(page.getByText('AB Result')).toBeInTheDocument();
		await expect.element(page.getByText('A Result')).not.toBeInTheDocument();
	});
});

describe('SearchBox.svelte — outside-click and Escape close (BUG-007)', () => {
	it('closes when a pointerdown lands outside the component', async () => {
		mockedSearchWorkspace.mockResolvedValue(withResults({ projects: [{ id: 'p1', title: 'Alpha' }] }));
		render(SearchBox);

		await userEvent.type(searchInput(), 'alpha');
		await expect.element(page.getByText('Alpha')).toBeInTheDocument();

		dispatchOutsidePointerDown();

		await expect.element(page.getByText('Alpha')).not.toBeInTheDocument();
	});

	it('does not close from a pointerdown inside the results', async () => {
		mockedSearchWorkspace.mockResolvedValue(withResults({ projects: [{ id: 'p1', title: 'Alpha' }] }));
		render(SearchBox);

		await userEvent.type(searchInput(), 'alpha');
		await expect.element(page.getByText('Alpha')).toBeInTheDocument();

		// Dispatch the same real pointerdown, but targeted at an element inside the results
		// dropdown (the "Projects" group label) rather than outside the component — proves
		// the `wrapRef.contains(...)` branch, not just the absence of an outside handler.
		const insideTarget = document.querySelector('.search-group-label');
		expect(insideTarget).not.toBeNull();
		dispatchOutsidePointerDown(insideTarget!);

		await expect.element(page.getByText('Alpha')).toBeInTheDocument();
	});

	it('closes on Escape', async () => {
		mockedSearchWorkspace.mockResolvedValue(withResults({ projects: [{ id: 'p1', title: 'Alpha' }] }));
		render(SearchBox);

		await userEvent.type(searchInput(), 'alpha');
		await expect.element(page.getByText('Alpha')).toBeInTheDocument();

		await userEvent.keyboard('{Escape}');

		await expect.element(page.getByText('Alpha')).not.toBeInTheDocument();
	});

	it('tears down the document listeners once closed — a further outside pointerdown and Escape are no-ops', async () => {
		mockedSearchWorkspace.mockResolvedValue(withResults({ projects: [{ id: 'p1', title: 'Alpha' }] }));
		render(SearchBox);

		await userEvent.type(searchInput(), 'alpha');
		await expect.element(page.getByText('Alpha')).toBeInTheDocument();

		await userEvent.keyboard('{Escape}');
		await expect.element(page.getByText('Alpha')).not.toBeInTheDocument();

		// With the dropdown already closed, further outside pointerdown / Escape must not
		// throw or reopen/alter anything.
		expect(() => dispatchOutsidePointerDown()).not.toThrow();
		await expect(userEvent.keyboard('{Escape}')).resolves.not.toThrow();
		await expect.element(page.getByText('Alpha')).not.toBeInTheDocument();
	});
});

describe('SearchBox.svelte — focus-reopen', () => {
	it('reopens showing previous results when the input is refocused after results exist', async () => {
		mockedSearchWorkspace.mockResolvedValue(withResults({ projects: [{ id: 'p1', title: 'Alpha' }] }));
		render(SearchBox);

		await userEvent.type(searchInput(), 'alpha');
		await expect.element(page.getByText('Alpha')).toBeInTheDocument();

		// Close via Escape, leaving `results` populated but `open` false. Escape does not
		// blur the input, so it must be blurred first — refocusing an already-focused input
		// fires no `focus` event, and `onfocus` is exactly what reopens the dropdown. Click
		// the (non-focusable) search icon first to move focus off the input without
		// triggering any handler of its own, then click back onto the input.
		await userEvent.keyboard('{Escape}');
		await expect.element(page.getByText('Alpha')).not.toBeInTheDocument();
		await blurBySwitchingFocus();

		await userEvent.click(searchInput());

		await expect.element(page.getByText('Alpha')).toBeInTheDocument();
	});

	it('does not open on focus when results is null (fresh component)', async () => {
		render(SearchBox);

		await userEvent.click(searchInput());

		await expect.element(page.getByText('No results')).not.toBeInTheDocument();
	});
});

describe('SearchBox.svelte — no-results state', () => {
	it('renders the "No results" state, not the loading state, when a search returns all-empty arrays', async () => {
		mockedSearchWorkspace.mockResolvedValue(emptyResults);
		render(SearchBox);

		await userEvent.type(searchInput(), 'nothing');

		await expect.element(page.getByText('No results')).toBeInTheDocument();
		await expect.element(page.getByText('Searching…')).not.toBeInTheDocument();
	});
});

describe('SearchBox.svelte — Project results navigate, Goal/Requirement do not (US-2 AC5, BUG-007)', () => {
	it('clicking a Project result calls goto and closes the dropdown', async () => {
		mockedSearchWorkspace.mockResolvedValue(
			withResults({ projects: [{ id: 'proj-1', title: 'Alpha Project' }] })
		);
		render(SearchBox);

		await userEvent.type(searchInput(), 'alpha');
		await expect.element(page.getByText('Alpha Project')).toBeInTheDocument();

		// Click the `<button>` itself (via its accessible role/name), not the inner `<span>`
		// text node — clicking the text node via `page.getByText(...)` was observed to not
		// reliably deliver the click to the button's `onclick` in this DOM shape.
		await userEvent.click(page.getByRole('button', { name: /Alpha Project/ }));

		expect(goto).toHaveBeenCalledWith('/projects/proj-1');
		await expect.element(page.getByText('Alpha Project')).not.toBeInTheDocument();
	});

	it('clicking a Goal result closes the dropdown without calling goto', async () => {
		mockedSearchWorkspace.mockResolvedValue(withResults({ goals: [{ id: 'goal-1', title: 'Beta Goal' }] }));
		render(SearchBox);

		await userEvent.type(searchInput(), 'beta');
		await expect.element(page.getByText('Beta Goal')).toBeInTheDocument();

		await userEvent.click(page.getByRole('button', { name: /Beta Goal/ }));

		expect(goto).not.toHaveBeenCalled();
		await expect.element(page.getByText('Beta Goal')).not.toBeInTheDocument();
	});

	it('clicking a Requirement result closes the dropdown without calling goto', async () => {
		mockedSearchWorkspace.mockResolvedValue(
			withResults({ requirements: [{ id: 'req-1', title: 'Gamma Requirement' }] })
		);
		render(SearchBox);

		await userEvent.type(searchInput(), 'gamma');
		await expect.element(page.getByText('Gamma Requirement')).toBeInTheDocument();

		await userEvent.click(page.getByRole('button', { name: /Gamma Requirement/ }));

		expect(goto).not.toHaveBeenCalled();
		await expect.element(page.getByText('Gamma Requirement')).not.toBeInTheDocument();
	});
});
