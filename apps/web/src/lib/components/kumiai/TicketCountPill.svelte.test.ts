// Proof-of-life for the Vitest Browser Mode foundation (REQ-002 US-1): TicketCountPill is
// rendered in a real headless Chromium and asserted on the actual DOM, replacing the old
// source-string audit in TicketCountPill.test.ts (which could only prove that no {#if}
// appeared in the markup, not that a `0` count actually rendered).
//
// The assertion targets the rendered count only, not the sentence around it — REQ-001's
// open TASK-016 will change this pill's label to be status-neutral, and an assertion on
// the literal "tickets in progress" text would break for a reason unrelated to this
// requirement.

import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "@testing-library/svelte";
import TicketCountPill from "./TicketCountPill.svelte";
import Sidebar from "./Sidebar.svelte";
// Reading/mutating `page` directly from `$app/state` (rather than the `setPageUrl` helper
// re-exported from vitest-setup-browser.ts) is the confirmed-working path — see BUG-018:
// a relative re-import of that setup file resolves a *second*, disconnected module
// instance whose mockPage is not the one the `vi.mock('$app/state', ...)` factory (wired
// through Vitest's setupFiles pipeline) actually hands to a rendered component.
import { page as appPage } from "$app/state";

function setPathname(pathname: string): void {
	// @ts-expect-error -- the mocked `page` is a plain mutable object in test builds only.
	appPage.url = new URL(pathname, "http://localhost/");
}

describe("TicketCountPill.svelte — renders the real DOM (REQ-002 US-1)", () => {
	it("a count of 0 renders 0 and the pill is visible", async () => {
		render(TicketCountPill, { props: { count: 0 } });

		await expect.element(page.getByText("0", { exact: false })).toBeInTheDocument();
		await expect.element(page.getByText("0", { exact: false })).toBeVisible();
	});

	it("a non-zero count renders that number", async () => {
		render(TicketCountPill, { props: { count: 7 } });

		await expect.element(page.getByText("7", { exact: false })).toBeInTheDocument();
	});
});

// Smoke test only — proves the `$app/state` provision from vitest-setup-browser.ts works
// end to end. Full Sidebar coverage (active nav state, recently-opened) belongs to
// the ticket that owns Sidebar.svelte.test.ts, not this one.
describe("$app/state provision — a component importing it renders in the browser project", () => {
	it("Sidebar renders with page.url.pathname driving active nav state", async () => {
		setPathname("/roadmap");

		render(Sidebar, {
			props: {
				team: null,
				recentProjects: [],
			},
		});

		await expect.element(page.getByRole("link", { name: "Goals & Projects" })).toBeInTheDocument();
	});
});
