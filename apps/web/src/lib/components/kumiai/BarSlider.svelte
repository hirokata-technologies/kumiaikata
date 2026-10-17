<script lang="ts">
	import { notchBar, NOTCH_ON, NOTCH_OFF } from '$lib/kumiai/notch.js';

	let {
		kind,
		value,
		label,
		onchange,
		oncommit
	}: {
		/** `impact` is a 1-100 bar; `effort` is 1-10 notches. */
		kind: 'impact' | 'effort';
		value: number;
		label: string;
		/** Fires on every pointer move or key press, so the parent can show the value live. */
		onchange: (value: number) => void;
		/** Fires once when the pointer is released or a key is pressed — the point to save. */
		oncommit: (value: number) => void;
	} = $props();

	const max = $derived(kind === 'impact' ? 100 : 10);
	const notches = $derived(notchBar(value));

	let track: HTMLElement | undefined = $state();
	let dragging = false;
	let last = 0;

	function fromX(clientX: number): number {
		if (!track) return value;
		const rect = track.getBoundingClientRect();
		const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		return kind === 'impact' ? Math.round(f * 99) + 1 : Math.min(10, Math.max(1, Math.ceil(f * 10)));
	}

	function update(clientX: number) {
		last = fromX(clientX);
		onchange(last);
	}

	function onpointerdown(e: PointerEvent) {
		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		dragging = true;
		update(e.clientX);
	}

	function onpointermove(e: PointerEvent) {
		if (dragging) update(e.clientX);
	}

	function finish() {
		if (!dragging) return;
		dragging = false;
		oncommit(last);
	}

	function onkeydown(e: KeyboardEvent) {
		const step = kind === 'impact' && e.shiftKey ? 10 : 1;
		let next = value;
		if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step;
		else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step;
		else if (e.key === 'Home') next = 1;
		else if (e.key === 'End') next = max;
		else return;
		e.preventDefault();
		next = Math.min(max, Math.max(1, next));
		if (next === value) return;
		onchange(next);
		oncommit(next);
	}
</script>

<div
	class="slider slider-{kind}"
	bind:this={track}
	role="slider"
	tabindex="0"
	aria-label={label}
	aria-valuemin={1}
	aria-valuemax={max}
	aria-valuenow={value}
	{onpointerdown}
	{onpointermove}
	onpointerup={finish}
	onpointercancel={finish}
	{onkeydown}
>
	{#if kind === 'impact'}
		<span class="fill" style:width="{Math.min(100, Math.max(0, value))}%"></span>
	{:else}
		{#each notches as on, i (i)}
			<span class="notch" style:background={on ? NOTCH_ON : NOTCH_OFF}></span>
		{/each}
	{/if}
</div>

<style>
	.slider {
		cursor: ew-resize;
		touch-action: none;
		user-select: none;
	}

	.slider-impact {
		height: 10px;
		border-radius: var(--radius-pill);
		background: var(--paper-2);
	}

	.fill {
		display: block;
		height: 100%;
		border-radius: var(--radius-pill);
		background: var(--accent);
	}

	.slider-effort {
		display: flex;
		gap: 4px;
	}

	.notch {
		flex: 1;
		height: 22px;
		border-radius: 3px;
	}
</style>
