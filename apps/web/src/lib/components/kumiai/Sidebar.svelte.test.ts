// Render tests for Sidebar (REQ-002 US-2 AC1/AC2), replacing the source-string audit in
// Sidebar.test.ts (deleted by this ticket). Composition and the active-route state are
// proven against the real DOM.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "@testing-library/svelte";
import Sidebar from "./Sidebar.svelte";
// Reading/mutating `page` directly from `$app/state` (rather than the `setPageUrl` helper
// re-exported from vitest-setup-browser.ts) is the confirmed-working path — see BUG-018:
// a relative re-import of that setup file resolves a *second*, disconnected module
// instance whose mockPage is not the one the `vi.mock('$app/state', ...)` factory (wired
// through Vitest's setupFiles pipeline) actually hands to a rendered component.
import { page as appPage } from "$app/state";
import type { RecentProject } from "$lib/api/kumiai/types.js";

function setPathname(pathname: string): void {
	// @ts-expect-error -- the mocked `page` is a plain mutable object in test builds only.
	appPage.url = new URL(pathname, "http://localhost/");
}

function makeRecentProject(overrides: Partial<RecentProject> = {}): RecentProject {
	return {
		id: "proj-1",
		title: "Kata Redesign",
		priority: "high",
		status: "in-progress",
		openedAt: "2026-09-20T00:00:00Z",
		...overrides,
	};
}

describe("Sidebar.svelte — nav landmarks", () => {
	it("renders the Planning <nav> landmark and no Views landmark", async () => {
		render(Sidebar, {
			props: { team: null, recentProjects: [] },
		});

		await expect
			.element(browserPage.getByRole("navigation", { name: "Planning" }))
			.toBeInTheDocument();
		expect(browserPage.getByRole("navigation", { name: "Views" }).elements()).toHaveLength(0);
	});

	it("links Goals & Projects to /roadmap and Impact & effort to /matrix", async () => {
		render(Sidebar, {
			props: { team: null, recentProjects: [] },
		});

		await expect
			.element(browserPage.getByRole("link", { name: "Goals & Projects" }))
			.toHaveAttribute("href", "/roadmap");
		await expect
			.element(browserPage.getByRole("link", { name: "Impact & effort" }))
			.toHaveAttribute("href", "/matrix");
	});

	it("renders no removed view links", async () => {
		render(Sidebar, {
			props: { team: null, recentProjects: [] },
		});

		await expect
			.element(browserPage.getByRole("link", { name: "Goals & Projects" }))
			.toBeInTheDocument();
		for (const name of ["This week", "Backlog", "To do", "In progress", "Projects"]) {
			expect(browserPage.getByRole("link", { name, exact: true }).elements()).toHaveLength(0);
		}
	});
});

describe("Sidebar.svelte — workspace selector", () => {
	const workspace = {
		id: "w1",
		teamId: "t",
		name: "default",
		isDefault: true,
		goalCount: 3,
		projectCount: 7,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};

	it("shows the active workspace under the team name", async () => {
		render(Sidebar, {
			props: {
				team: null,
				recentProjects: [],
				workspaces: [workspace],
				activeWorkspaceId: "w1",
			},
		});

		await expect.element(browserPage.getByText("3 goals · 7 projects")).toBeVisible();
	});

	it("renders no selector when the workspaces could not be loaded", async () => {
		render(Sidebar, {
			props: { team: null, recentProjects: [] },
		});

		expect(browserPage.getByText("Workspace", { exact: true }).elements()).toHaveLength(0);
	});
});

describe("Sidebar.svelte — RecentlyOpened", () => {
	it("mounts RecentlyOpened and renders its empty-state copy for []", async () => {
		render(Sidebar, {
			props: { team: null, recentProjects: [] },
		});

		await expect.element(browserPage.getByText("No projects opened yet.")).toBeInTheDocument();
	});

	it("mounts RecentlyOpened and renders a project title for a non-empty list", async () => {
		render(Sidebar, {
			props: {
				team: null,
				recentProjects: [makeRecentProject({ title: "Kata Redesign" })],
			},
		});

		await expect.element(browserPage.getByText("Kata Redesign")).toBeInTheDocument();
	});
});

describe("Sidebar.svelte — active nav state from $app/state", () => {
	it("marks the nav item matching page.url.pathname as active", async () => {
		setPathname("/roadmap");

		render(Sidebar, {
			props: { team: null, recentProjects: [] },
		});

		await expect
			.element(browserPage.getByRole("link", { name: "Goals & Projects" }))
			.toHaveAttribute("aria-current", "page");
	});
});

describe("Sidebar.svelte — narrow-screen drawer", () => {
	beforeAll(async () => {
		await browserPage.viewport(390, 844);
	});
	afterAll(async () => {
		await browserPage.viewport(1280, 800);
	});

	it("is hidden until opened", async () => {
		const { rerender } = render(Sidebar, {
			props: { team: null, recentProjects: [] },
		});
		const planning = browserPage.getByRole("navigation", { name: "Planning", includeHidden: true });
		await expect.element(planning).not.toBeVisible();

		await rerender({ team: null, recentProjects: [], open: true });
		await expect.element(planning).toBeVisible();
	});
});
