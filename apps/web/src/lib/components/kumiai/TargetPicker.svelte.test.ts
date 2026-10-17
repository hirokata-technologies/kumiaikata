import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "@testing-library/svelte";
import TargetPicker from "./TargetPicker.svelte";
import type { PeriodSelection } from "$lib/kumiai/period.js";

function setup(props: { mode?: "target" | "filter"; current?: PeriodSelection | null } = {}) {
	const onselect = vi.fn();
	const onclear = vi.fn();
	const onclose = vi.fn();
	render(TargetPicker, {
		props: {
			mode: props.mode ?? "target",
			subject: "p1 · Sepsis model",
			current: props.current ?? null,
			onselect,
			onclear,
			onclose,
		},
	});
	return { onselect, onclear, onclose };
}

describe("TargetPicker.svelte", () => {
	it("opens on the granularity of the current target", async () => {
		setup({ current: { kind: "quarter", year: 2026, number: 4 } });
		await expect.element(page.getByText("Oct · Nov · Dec")).toBeVisible();
	});

	it("picks a month", async () => {
		const { onselect } = setup({ current: { kind: "month", year: 2026, number: 10 } });
		await page.getByRole("button", { name: "Nov" }).click();
		expect(onselect).toHaveBeenCalledWith({ kind: "month", year: 2026, number: 11 });
	});

	it("picks a quarter, in the year being viewed", async () => {
		const { onselect } = setup({ current: { kind: "quarter", year: 2026, number: 1 } });
		await page.getByRole("button", { name: "Next" }).click();
		await page.getByRole("button", { name: /Q2/ }).click();
		expect(onselect).toHaveBeenCalledWith({ kind: "quarter", year: 2027, number: 2 });
	});

	it("picks a week row by its ISO week and week-year", async () => {
		const { onselect } = setup({ current: { kind: "week", year: 2026, number: 39 } });
		await page.getByRole("button", { name: /W39/ }).click();
		expect(onselect).toHaveBeenCalledWith({ kind: "week", year: 2026, number: 39 });
	});

	it("labels the clear action for what it clears", async () => {
		const { onclear } = setup({ mode: "filter" });
		await page.getByRole("button", { name: "Clear filter" }).click();
		expect(onclear).toHaveBeenCalledOnce();
	});

	it("describes a filter rather than a project when picking a period filter", async () => {
		setup({ mode: "filter" });
		await expect
			.element(page.getByText("Shows projects targeted inside the period you pick"))
			.toBeVisible();
	});

	it("closes on Escape and on Done", async () => {
		const { onclose } = setup();
		await page.getByRole("button", { name: "Done" }).click();
		expect(onclose).toHaveBeenCalledTimes(1);
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(onclose).toHaveBeenCalledTimes(2);
	});
});
