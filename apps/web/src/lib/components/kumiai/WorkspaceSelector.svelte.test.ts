import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "@testing-library/svelte";
import WorkspaceSelector from "./WorkspaceSelector.svelte";
import type { KumiaiWorkspace } from "$lib/kumiai/types.js";

const ws = (id: string, name: string, over: Partial<KumiaiWorkspace> = {}): KumiaiWorkspace => ({
	id,
	teamId: "t",
	name,
	isDefault: false,
	goalCount: 0,
	projectCount: 0,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	...over,
});

const WORKSPACES = [
	ws("w1", "default", { isDefault: true, goalCount: 2, projectCount: 5 }),
	ws("w2", "Research", { goalCount: 1, projectCount: 1 }),
];

function setup(props: { activeId?: string | null; oncreate?: (name: string) => Promise<string | null> } = {}) {
	const onselect = vi.fn();
	const oncreate = props.oncreate ?? vi.fn(async () => null);
	render(WorkspaceSelector, {
		props: { workspaces: WORKSPACES, activeId: props.activeId ?? "w1", onselect, oncreate },
	});
	return { onselect, oncreate };
}

describe("WorkspaceSelector.svelte", () => {
	it("shows the active workspace with its goal and project counts", async () => {
		setup();
		await expect.element(page.getByRole("button", { name: /default/ })).toBeVisible();
		await expect.element(page.getByText("2 goals · 5 projects")).toBeVisible();
	});

	it("uses singular wording for a single goal or project", async () => {
		setup({ activeId: "w2" });
		await expect.element(page.getByText("1 goal · 1 project")).toBeVisible();
	});

	it("lists every workspace when opened and marks the current one", async () => {
		setup();
		await page.getByRole("button", { name: /default/ }).click();
		await expect.element(page.getByRole("option", { name: /Research/ })).toBeVisible();
		await expect.element(page.getByRole("option", { name: /default/ })).toHaveAttribute("aria-selected", "true");
		await expect.element(page.getByRole("option", { name: /Research/ })).toHaveAttribute("aria-selected", "false");
	});

	it("selects another workspace and closes", async () => {
		const { onselect } = setup();
		await page.getByRole("button", { name: /default/ }).click();
		await page.getByRole("option", { name: /Research/ }).click();
		expect(onselect).toHaveBeenCalledExactlyOnceWith("w2");
		await expect.element(page.getByRole("listbox")).not.toBeInTheDocument();
	});

	it("does not re-select the current workspace", async () => {
		const { onselect } = setup();
		await page.getByRole("button", { name: /default/ }).click();
		await page.getByRole("option", { name: /default/ }).click();
		expect(onselect).not.toHaveBeenCalled();
	});

	it("creates a workspace from a name", async () => {
		const { oncreate } = setup();
		await page.getByRole("button", { name: /default/ }).click();
		await page.getByRole("button", { name: "New workspace" }).click();
		await page.getByRole("textbox", { name: "Workspace name" }).fill("Trials");
		await userEvent.keyboard("{Enter}");
		expect(oncreate).toHaveBeenCalledExactlyOnceWith("Trials");
	});

	it("shows the error when creating fails and keeps the field open", async () => {
		setup({ oncreate: async () => "A workspace with that name already exists." });
		await page.getByRole("button", { name: /default/ }).click();
		await page.getByRole("button", { name: "New workspace" }).click();
		await page.getByRole("textbox", { name: "Workspace name" }).fill("Research");
		await userEvent.keyboard("{Enter}");
		await expect.element(page.getByRole("alert")).toHaveTextContent("already exists");
		await expect.element(page.getByRole("textbox", { name: "Workspace name" })).toBeVisible();
	});
});
