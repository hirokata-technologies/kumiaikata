// BarSlider's drag maths and keyboard handling live in the component, so they are proven
// by rendering it in a real browser: the pointer position -> value mapping needs real layout.

import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "@testing-library/svelte";
import BarSlider from "./BarSlider.svelte";

function setup(kind: "impact" | "effort", value: number) {
	const onchange = vi.fn();
	const oncommit = vi.fn();
	render(BarSlider, { props: { kind, value, label: kind, onchange, oncommit } });
	return { onchange, oncommit, slider: page.getByRole("slider", { name: kind }) };
}

describe("BarSlider.svelte — keyboard", () => {
	it("exposes the value and range to assistive tech", async () => {
		const { slider } = setup("effort", 4);
		await expect.element(slider).toHaveAttribute("aria-valuenow", "4");
		await expect.element(slider).toHaveAttribute("aria-valuemax", "10");
	});

	it("arrow keys step by one and commit immediately", async () => {
		const { slider, onchange, oncommit } = setup("effort", 4);
		(slider.element() as HTMLElement).focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(onchange).toHaveBeenLastCalledWith(5);
		expect(oncommit).toHaveBeenLastCalledWith(5);
	});

	it("does not step past the ends of the range", async () => {
		const { slider, oncommit } = setup("effort", 10);
		(slider.element() as HTMLElement).focus();
		await userEvent.keyboard("{ArrowRight}");
		expect(oncommit).not.toHaveBeenCalled();
	});

	it("shift+arrow moves impact by ten", async () => {
		const { slider, oncommit } = setup("impact", 50);
		(slider.element() as HTMLElement).focus();
		await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
		expect(oncommit).toHaveBeenLastCalledWith(60);
	});
});

describe("BarSlider.svelte — pointer", () => {
	function pointer(el: HTMLElement, type: string, clientX: number) {
		el.dispatchEvent(
			new PointerEvent(type, { clientX, pointerId: 1, bubbles: true, cancelable: true }),
		);
	}

	it("maps the pointer position to an effort value and commits once on release", async () => {
		const { slider, onchange, oncommit } = setup("effort", 1);
		const el = slider.element() as HTMLElement;
		el.setPointerCapture = () => {};
		const rect = el.getBoundingClientRect();

		pointer(el, "pointerdown", rect.left + rect.width * 0.95);
		expect(onchange).toHaveBeenLastCalledWith(10);
		pointer(el, "pointermove", rect.left + rect.width * 0.05);
		expect(onchange).toHaveBeenLastCalledWith(1);
		expect(oncommit).not.toHaveBeenCalled();
		pointer(el, "pointerup", rect.left + rect.width * 0.05);
		expect(oncommit).toHaveBeenCalledTimes(1);
		expect(oncommit).toHaveBeenCalledWith(1);
	});

	it("maps the pointer position to an impact value between 1 and 100", async () => {
		const { slider, onchange } = setup("impact", 1);
		const el = slider.element() as HTMLElement;
		el.setPointerCapture = () => {};
		const rect = el.getBoundingClientRect();

		pointer(el, "pointerdown", rect.left - 50);
		expect(onchange).toHaveBeenLastCalledWith(1);
		pointer(el, "pointermove", rect.right + 50);
		expect(onchange).toHaveBeenLastCalledWith(100);
	});

	it("ignores movement when no drag started", async () => {
		const { slider, onchange } = setup("effort", 3);
		const el = slider.element() as HTMLElement;
		pointer(el, "pointermove", el.getBoundingClientRect().left + 10);
		expect(onchange).not.toHaveBeenCalled();
	});
});
