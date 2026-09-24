// Render tests for WorkspaceBlock (REQ-002 US-2 AC2) — this component had no coverage at
// all before this ticket: Sidebar.test.ts only read Sidebar.svelte's source text and never
// touched WorkspaceBlock.

import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "@testing-library/svelte";
import WorkspaceBlock from "./WorkspaceBlock.svelte";

describe("WorkspaceBlock.svelte", () => {
	it("renders the static Kumiaikata wordmark", async () => {
		render(WorkspaceBlock, { props: { teamName: "Edamama" } });

		await expect.element(page.getByText("Kumiaikata")).toBeInTheDocument();
	});

	it("renders the given teamName", async () => {
		render(WorkspaceBlock, { props: { teamName: "Edamama" } });

		await expect.element(page.getByText("Edamama")).toBeInTheDocument();
	});

	it("falls back to 'Your team' when teamName is null", async () => {
		render(WorkspaceBlock, { props: { teamName: null } });

		await expect.element(page.getByText("Your team")).toBeInTheDocument();
	});

	it("the logo image is decorative — alt=\"\", not exposed as a named image role", async () => {
		render(WorkspaceBlock, { props: { teamName: null } });

		// alt="" removes the image from the accessibility tree entirely (it becomes
		// presentational), so no element matches the "img" role at all — proving the
		// decorative markup for real, rather than string-matching `alt=""` in source.
		await expect.element(page.getByRole("img")).not.toBeInTheDocument();
	});
});
