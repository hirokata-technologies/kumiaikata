// Render tests for NavItem (REQ-002 US-2 AC2) — no coverage existed anywhere before this
// ticket. This is the component with the most real branching in the sidebar subtree: the
// enabled/disabled split changes the rendered element entirely (a real <a> vs a <span>), and
// the old source-string audit in Sidebar.test.ts could never prove that split for real.

import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "@testing-library/svelte";
import NavItem from "./NavItem.svelte";

describe("NavItem.svelte — enabled", () => {
	it("renders an <a> with the given href, label, and icon", async () => {
		render(NavItem, {
			props: { label: "This week", href: "/week", icon: "CalendarDays" },
		});

		const link = page.getByRole("link", { name: "This week" });
		await expect.element(link).toBeInTheDocument();
		await expect.element(link).toHaveAttribute("href", "/week");
		expect(link.element().querySelector("svg")).not.toBeNull();
	});

	it("active={true} sets aria-current=\"page\"", async () => {
		render(NavItem, {
			props: {
				label: "This week",
				href: "/week",
				icon: "CalendarDays",
				active: true,
			},
		});

		await expect
			.element(page.getByRole("link", { name: "This week" }))
			.toHaveAttribute("aria-current", "page");
	});

	it("inactive (default) does not set aria-current", async () => {
		render(NavItem, {
			props: { label: "This week", href: "/week", icon: "CalendarDays" },
		});

		await expect
			.element(page.getByRole("link", { name: "This week" }))
			.not.toHaveAttribute("aria-current");
	});

	it("badge given: renders the number", async () => {
		render(NavItem, {
			props: {
				label: "Backlog",
				href: "/backlog",
				icon: "Inbox",
				badge: 3,
			},
		});

		await expect.element(page.getByText("3", { exact: true })).toBeInTheDocument();
	});

	it("badge undefined: renders no badge element", async () => {
		render(NavItem, {
			props: { label: "This week", href: "/week", icon: "CalendarDays" },
		});

		const link = page.getByRole("link", { name: "This week" });
		await expect.element(link).toBeInTheDocument();
		expect(link.element().querySelector(".nav-item-badge")).toBeNull();
	});
});

describe("NavItem.svelte — disabled", () => {
	it("disabled={true} renders a <span aria-disabled=\"true\">, not a link", async () => {
		render(NavItem, {
			props: {
				label: "Projects",
				href: "/projects/abc",
				icon: "Folder",
				disabled: true,
			},
		});

		const labelText = page.getByText("Projects");
		await expect.element(labelText).toBeInTheDocument();
		expect(page.getByRole("link").elements()).toHaveLength(0);

		const disabledSpan = labelText.element().closest('span[aria-disabled="true"]');
		expect(disabledSpan).not.toBeNull();
	});

	it("href={null} renders a <span aria-disabled=\"true\">, not a link", async () => {
		render(NavItem, {
			props: { label: "Projects", href: null, icon: "Folder" },
		});

		const labelText = page.getByText("Projects");
		await expect.element(labelText).toBeInTheDocument();
		expect(page.getByRole("link").elements()).toHaveLength(0);

		const disabledSpan = labelText.element().closest('span[aria-disabled="true"]');
		expect(disabledSpan).not.toBeNull();
	});
});

describe("NavItem.svelte — icon mapping", () => {
	it.each([
		["CalendarDays", "This week"],
		["Folder", "Projects"],
	] as const)("renders an icon for NavIconName %s", async (icon, label) => {
		render(NavItem, { props: { label, href: "/x", icon } });

		const link = page.getByRole("link", { name: label });
		await expect.element(link).toBeInTheDocument();
		expect(link.element().querySelector("svg")).not.toBeNull();
	});
});
