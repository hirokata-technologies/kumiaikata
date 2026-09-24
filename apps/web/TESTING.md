# Testing apps/web

## The rule: extract pure logic, render-test everything else

Extract pure, reusable logic into a plain module with injectable dependencies and unit-test it
there — the existing `workspace-restore.test.ts` / `EditProfileModal.test.ts` pattern. Use a
`@testing-library/svelte` render test, running in a real headless browser, for everything else —
in particular behavior that only exists inline in a component's markup, event bindings, or
lifecycle.

**These are not alternatives.** Most components have both kinds of behavior, and both apply at
once: extract what is pure, render-test the rest. `SearchBox` is the worked example — its
result-shaping logic could be pulled into a plain module and unit-tested, but its debounce,
outside-click dismissal, and focus-reopen behavior exist only in the component itself and can
only be proven by rendering it. Neither approach substitutes for the other.

A new component with inline interactive behavior is expected to have a render test before its
ticket is done (REQ-002 US-3 AC2). **This is a convention, not an automated gate** — nothing in
CI enforces it. Catching a missing render test is review's job.

See `adr-kumiai-component-test-convention` in the guild library for the full reasoning and the
alternatives that were rejected.

## How to do it

### Naming decides where a test runs

- `*.svelte.test.ts` — runs in the **browser** project (real headless Chromium).
- `*.test.ts` — runs in the **unit** (node) project.

The browser glob is anchored to the component directories
(`src/lib/components/**/*.svelte.test.ts`), not a bare `src/**/*.svelte.test.ts`. That's
deliberate: `src/lib/components/kumiai/nav-config.test.ts` sits among components but tests a
plain module with no DOM involvement, and `src/lib/settings.svelte.test.ts` /
`src/lib/workspace.svelte.test.ts` are node tests of `.svelte.ts` rune modules, not components —
neither should be dragged into a browser. Adding a component render test outside the anchored
directories will silently run it in node instead, and it will fail with something like
`document is not defined`. See `adr-kumiai-test-file-naming` for the full rationale.

### Commands

```bash
pnpm --filter @kata/web test           # both projects (unit + browser)
pnpm --filter @kata/web test:browser   # browser project only
pnpm --filter @kata/web test:coverage  # both projects + coverage (unit only is covered)
pnpm --filter @kata/web test:watch     # watch mode, both projects
```

To debug a browser test with the window visible instead of headless, run Vitest's UI or flip
`browser.headless` to `false` in `vitest.config.ts` locally — don't commit that change.

### A minimal render test

```ts
// src/lib/components/kumiai/TicketCountPill.svelte.test.ts
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "@testing-library/svelte";
import TicketCountPill from "./TicketCountPill.svelte";

describe("TicketCountPill.svelte", () => {
	it("renders a non-zero count", async () => {
		render(TicketCountPill, { props: { count: 7 } });

		await expect.element(page.getByText("7", { exact: false })).toBeInTheDocument();
	});
});
```

Query with `page` from `vitest/browser` (`page.getByRole(...)`, `page.getByText(...)`, etc — the
same locator API Playwright exposes). Assert with `expect.element(locator)`, which ships its own
DOM matchers (`toBeInTheDocument`, `toBeVisible`, ...) via Browser Mode itself — no
`@testing-library/jest-dom` needed.

### `$app/navigation` and `$app/state`

Both are mocked globally for every browser test by `apps/web/vitest-setup-browser.ts` — don't
re-mock them per file. **Import `goto` and `page` directly from `$app/navigation` /
`$app/state`, not via a relative re-export of `vitest-setup-browser.ts`.** A relative re-export
resolves a second, disconnected module instance whose `vi.fn()` / mock object is not the one
`vi.mock(...)` actually wires into a rendered component — `setPageUrl`-style helpers silently do
nothing and `expect(goto).toHaveBeenCalledWith(...)` always sees 0 calls (BUG-018).

```ts
import { goto } from "$app/navigation";
import { page } from "$app/state";

// @ts-expect-error -- the mocked `page` is a plain mutable object in test builds only.
page.url = new URL("/week", "http://localhost/"); // set page.url BEFORE render() — it's read
// at component init, not re-read reactively, so changing it after mount has no effect on an
// already-mounted instance. Each test that needs a different pathname must set page.url then
// render fresh.

render(Sidebar, { props: { /* ... */ } });

// ...

expect(goto).toHaveBeenCalledWith("/projects/123"); // goto is a vi.fn(), cleared before each test
```

### Stubbing `$lib/api`

Mock the specifier your component actually imports from — usually the barrel at
`$lib/api`:

```ts
vi.mock("$lib/api", () => ({
	searchWorkspace: vi.fn().mockResolvedValue({ goals: [], projects: [], requirements: [] }),
}));
```

Extend with `vi.importActual` if the same test file also needs other real exports from the
barrel.

### No fake timers — use the auto-retrying assertion instead

Fake timers are unreliable against a real browser's scheduler and are ruled out for browser
tests (see `adr-kumiai-browser-mode-testing`). `expect.element(locator).toX()` is poll-based and
auto-retries until it passes or times out — use it in place of a manual `setTimeout` /
`waitFor` for anything that becomes true asynchronously, including debounced behavior:

```ts
// SearchBox debounces its query by 200ms before calling searchWorkspace — don't fake the
// clock, just let expect.element retry until the debounced result shows up:
await expect.element(page.getByText("No results")).toBeInTheDocument();
```

## Two things that will cost you an afternoon otherwise

- **Docker.** Running the suite inside a container without the Playwright browser installed
  will fail — Browser Mode needs a real Chromium binary (`playwright install chromium`), which
  isn't part of the base container image. This affects the project's Docker preview flow
  (`docker-compose.local.yml`); if you're testing inside that container, install the browser
  first or run the test suite on the host instead.
- **Browser-mode isolation is per file, not per test.** A component mounted by one test in a
  `*.svelte.test.ts` file stays in the DOM for the next test in the same file unless torn down.
  `vitest-setup-browser.ts` calls `cleanup()` from `@testing-library/svelte` in a global
  `afterEach`, so this is handled for you automatically — you don't need to call `cleanup()`
  yourself, but if you add your own `afterEach` in a test file, don't skip calling through to
  it.

## CI cost

TASK-025 wired the browser project into CI and measured the actual added time to the `test-web`
job: **cold 116s (before: 22s, delta +94s)** on a first run with no cached Chromium binary, and
**warm 128s (delta +106s)** with the binary cached. The Chromium provisioning step itself (install
+ cache restore/save) accounts for roughly **~24s cold** and **~17s warm** of that delta — the
rest is the browser test run itself. These are measured numbers from `.github/workflows/test.yml`,
not the plan-time estimate from `adr-kumiai-browser-mode-testing`.
