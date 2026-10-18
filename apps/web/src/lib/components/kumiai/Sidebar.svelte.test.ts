// Render tests for Sidebar (REQ-002 US-2 AC1/AC2), replacing the source-string audit in
// Sidebar.test.ts (deleted by this ticket). Composition and the "Projects" derived-href
// logic — the only real logic Sidebar itself owns — are proven against the real DOM.

import { describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "@testing-library/svelte";
import Sidebar from "./Sidebar.svelte";
// Reading/mutating `page` directly from `$app/state` (rather than the `setPageUrl` helper
// re-exported from vitest-setup-browser.ts) is the confirmed-working path — see BUG-018:
// a relative re-import of that setup file resolves a *second*, disconnected module
// instance whose mockPage is not the one the `vi.mock('$app/state', ...)` factory (wired
// through Vitest's setupFiles pipeline) actually hands to a rendered component.
import { page as appPage } from "$app/state";
import type { ProjectCounts } from "./nav-config.js";
import type { RecentProject } from "$lib/api/kumiai/types.js";

function setPathname(pathname: string): void {
	// @ts-expect-error -- the mocked `page` is a plain mutable object in test builds only.
	appPage.url = new URL(pathname, "http://localhost/");
}

const emptyCounts: ProjectCounts = {
	backlog: 0,
	todo: 0,
	inProgress: 0,
	blocked: 0,
	done: 0,
};

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
	it("renders two <nav> landmarks: Views and Planning", async () => {
		render(Sidebar, {
			props: { team: null, recentProjects: [], projectCounts: emptyCounts },
		});

		await expect
			.element(browserPage.getByRole("navigation", { name: "Views" }))
			.toBeInTheDocument();
		await expect
			.element(browserPage.getByRole("navigation", { name: "Planning" }))
			.toBeInTheDocument();
	});
});

describe("Sidebar.svelte — nav order", () => {
	it("puts Planning before Views", async () => {
		render(Sidebar, {
			props: { team: null, recentProjects: [], projectCounts: emptyCounts },
		});

		const planning = browserPage.getByRole("navigation", { name: "Planning" }).element();
		const views = browserPage.getByRole("navigation", { name: "Views" }).element();
		expect(planning.compareDocumentPosition(views) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
				projectCounts: emptyCounts,
				workspaces: [workspace],
				activeWorkspaceId: "w1",
			},
		});

		await expect.element(browserPage.getByText("3 goals · 7 projects")).toBeVisible();
	});

	it("renders no selector when the workspaces could not be loaded", async () => {
		render(Sidebar, {
			props: { team: null, recentProjects: [], projectCounts: emptyCounts },
		});

		expect(browserPage.getByText("Workspace", { exact: true }).elements()).toHaveLength(0);
	});
});

describe("Sidebar.svelte — Projects entry", () => {
	it("with recentProjects: [], Projects renders disabled (no link)", async () => {
		render(Sidebar, {
			props: { team: null, recentProjects: [], projectCounts: emptyCounts },
		});

		await expect
			.element(browserPage.getByText("Projects", { exact: true }))
			.toBeInTheDocument();
		expect(browserPage.getByRole("link", { name: "Projects" }).elements()).toHaveLength(0);
	});

	it("with a non-empty recentProjects, Projects links to /projects/{first.id}", async () => {
		render(Sidebar, {
			props: {
				team: null,
				recentProjects: [
					makeRecentProject({ id: "proj-1" }),
					makeRecentProject({ id: "proj-2" }),
				],
				projectCounts: emptyCounts,
			},
		});

		await expect
			.element(browserPage.getByRole("link", { name: "Projects" }))
			.toHaveAttribute("href", "/projects/proj-1");
	});
});

describe("Sidebar.svelte — RecentlyOpened", () => {
	it("mounts RecentlyOpened and renders its empty-state copy for []", async () => {
		render(Sidebar, {
			props: { team: null, recentProjects: [], projectCounts: emptyCounts },
		});

		await expect.element(browserPage.getByText("No projects opened yet.")).toBeInTheDocument();
	});

	it("mounts RecentlyOpened and renders a project title for a non-empty list", async () => {
		render(Sidebar, {
			props: {
				team: null,
				recentProjects: [makeRecentProject({ title: "Kata Redesign" })],
				projectCounts: emptyCounts,
			},
		});

		await expect.element(browserPage.getByText("Kata Redesign")).toBeInTheDocument();
	});
});

describe("Sidebar.svelte — badges", () => {
	it("projectCounts flow into the NAV_VIEWS entries that declare a badge", async () => {
		render(Sidebar, {
			props: {
				team: null,
				recentProjects: [],
				projectCounts: { backlog: 4, todo: 2, inProgress: 1, blocked: 0, done: 0 },
			},
		});

		const backlogLink = browserPage.getByRole("link", { name: /Backlog/ });
		await expect.element(backlogLink).toBeInTheDocument();
		expect(backlogLink.element().querySelector(".nav-item-badge")?.textContent).toBe("4");

		const todoLink = browserPage.getByRole("link", { name: /To do/ });
		expect(todoLink.element().querySelector(".nav-item-badge")?.textContent).toBe("2");
	});
});

describe("Sidebar.svelte — active nav state from $app/state", () => {
	it("marks the nav item matching page.url.pathname as active", async () => {
		setPathname("/backlog");

		render(Sidebar, {
			props: { team: null, recentProjects: [], projectCounts: emptyCounts },
		});

		await expect
			.element(browserPage.getByRole("link", { name: /Backlog/ }))
			.toHaveAttribute("aria-current", "page");
	});
});
