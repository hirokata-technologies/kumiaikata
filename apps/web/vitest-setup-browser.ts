import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/svelte";

/**
 * `$app/navigation` and `$app/state` provision for every browser-mode component test.
 *
 * `Sidebar.svelte` reads `page` from `$app/state`, `SearchBox.svelte` calls `goto` from
 * `$app/navigation`, and `AppHeader.svelte` pulls `SearchBox` in transitively — every
 * retrofit ticket that mounts one of these needs both provided, so it lives here once
 * rather than being re-invented per test file.
 *
 * `vi.mock` factories may only close over variables declared through `vi.hoisted` (or
 * named with a `mock` prefix) because the `vi.mock` calls themselves are hoisted above
 * the rest of the module — see https://vitest.dev/api/vi.html#vi-hoisted.
 */
const { mockGoto, mockPage } = vi.hoisted(() => {
	return {
		mockGoto: vi.fn(),
		mockPage: {
			url: new URL("http://localhost/"),
			params: {} as Record<string, string>,
			route: { id: null as string | null },
			status: 200,
			error: null as { message: string } | null,
			data: {} as Record<string, unknown>,
			state: {} as Record<string, unknown>,
			form: null as unknown,
		},
	};
});

vi.mock("$app/navigation", () => ({
	goto: mockGoto,
	invalidate: vi.fn(),
	invalidateAll: vi.fn(),
	preloadCode: vi.fn(),
	preloadData: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn(),
	afterNavigate: vi.fn(),
	beforeNavigate: vi.fn(),
	onNavigate: vi.fn(),
	disableScrollHandling: vi.fn(),
}));

vi.mock("$app/state", () => ({
	page: mockPage,
}));

/** The `goto` spy installed in place of `$app/navigation`'s `goto`. Assert on this. */
export const goto = mockGoto;

/**
 * Sets the `pathname` (and, optionally, the full URL) a mounted component reads from
 * `page.url` in `$app/state`. Call this *before* `render()` — `page.url` is read at
 * component init, not reactively re-read afterwards, so changing it after mount has no
 * effect on an already-rendered instance.
 */
export function setPageUrl(pathname: string): void {
	mockPage.url = new URL(pathname, "http://localhost/");
}

beforeEach(() => {
	setPageUrl("/");
	mockGoto.mockClear();
});

// Vitest Browser Mode isolates test FILES, not individual tests within a file — a
// component mounted by an earlier test stays in the DOM unless torn down explicitly.
// Without this, later `getByRole`/`getByText` queries in the same file start matching
// duplicates left over from prior tests.
afterEach(() => {
	cleanup();
});
