import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "@testing-library/svelte";
import ProjectFormModal from "./ProjectFormModal.svelte";

function setup(kind: "goal" | "project", extra: Record<string, unknown> = {}) {
	const onsubmit = vi.fn();
	const oncancel = vi.fn();
	render(ProjectFormModal, { props: { kind, goalTitle: "Safer decisions", onsubmit, oncancel, ...extra } });
	return { onsubmit, oncancel };
}

describe("ProjectFormModal.svelte", () => {
	it("keeps the create button disabled until there is a name", async () => {
		setup("project");
		const create = page.getByRole("button", { name: "Create project" });
		await expect.element(create).toBeDisabled();
		await page.getByLabelText("Project name").fill("   ");
		await expect.element(create).toBeDisabled();
		await page.getByLabelText("Project name").fill("Ward handover");
		await expect.element(create).toBeEnabled();
	});

	it("submits a trimmed name with the default scores for a project", async () => {
		const { onsubmit } = setup("project");
		await page.getByLabelText("Project name").fill("  Ward handover  ");
		await page.getByRole("button", { name: "Create project" }).click();
		expect(onsubmit).toHaveBeenCalledWith({
			title: "Ward handover",
			priority: "medium",
			impact: 50,
			effort: 5,
		});
	});

	it("takes the chosen priority", async () => {
		const { onsubmit } = setup("project");
		await page.getByLabelText("Project name").fill("Urgent thing");
		await page.getByRole("button", { name: "Urgent" }).click();
		await page.getByRole("button", { name: "Create project" }).click();
		expect(onsubmit).toHaveBeenCalledWith(expect.objectContaining({ priority: "urgent" }));
	});

	it("offers no impact or effort controls for a goal", async () => {
		setup("goal");
		await expect.element(page.getByRole("slider", { name: "Impact" })).not.toBeInTheDocument();
		await expect.element(page.getByRole("button", { name: "Create goal" })).toBeVisible();
	});

	it("shows a failure from the server and disables the button while busy", async () => {
		setup("goal", { busy: true, error: "Nope" });
		await expect.element(page.getByRole("alert")).toHaveTextContent("Nope");
		await expect.element(page.getByRole("button", { name: "Creating…" })).toBeDisabled();
	});

	it("cancels", async () => {
		const { oncancel } = setup("goal");
		await page.getByRole("button", { name: "Cancel" }).click();
		expect(oncancel).toHaveBeenCalledOnce();
	});
});
