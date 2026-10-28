// Render tests for NavItem (REQ-002 US-2 AC2): a real <a> with the given href, label and
// icon, and aria-current driven by `active`.

import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "@testing-library/svelte";
import NavItem from "./NavItem.svelte";

describe("NavItem.svelte — link", () => {
	it("renders an <a> with the given href, label, and icon", async () => {
		render(NavItem, {
			props: { label: "Goals & Projects", href: "/roadmap", icon: "Map" },
		});

		const link = page.getByRole("link", { name: "Goals & Projects" });
		await expect.element(link).toBeInTheDocument();
		await expect.element(link).toHaveAttribute("href", "/roadmap");
		expect(link.element().querySelector("svg")).not.toBeNull();
	});

	it("active={true} sets aria-current=\"page\"", async () => {
		render(NavItem, {
			props: {
				label: "Goals & Projects",
				href: "/roadmap",
				icon: "Map",
				active: true,
			},
		});

		await expect
			.element(page.getByRole("link", { name: "Goals & Projects" }))
			.toHaveAttribute("aria-current", "page");
	});

	it("inactive (default) does not set aria-current", async () => {
		render(NavItem, {
			props: { label: "Goals & Projects", href: "/roadmap", icon: "Map" },
		});

		await expect
			.element(page.getByRole("link", { name: "Goals & Projects" }))
			.not.toHaveAttribute("aria-current");
	});
});

describe("NavItem.svelte — icon mapping", () => {
	it.each([
		["Map", "Goals & Projects"],
		["ScatterChart", "Impact & effort"],
	] as const)("renders an icon for NavIconName %s", async (icon, label) => {
		render(NavItem, { props: { label, href: "/x", icon } });

		const link = page.getByRole("link", { name: label });
		await expect.element(link).toBeInTheDocument();
		expect(link.element().querySelector("svg")).not.toBeNull();
	});
});
