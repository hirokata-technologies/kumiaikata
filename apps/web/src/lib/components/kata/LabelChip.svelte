<script lang="ts">
	import type { KataLabel } from '$lib/types.js';

	let { label }: { label: KataLabel } = $props();

	const bg = $derived(label.color + '1a');
</script>

<span class="lbl" style="color: {label.color}; background: {bg}">
	<span class="color-dot" style="background: {label.color}"></span>
	{label.name}
</span>

<style>
	.lbl {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 8px;
		border-radius: 999px;
		font: 500 11px var(--font-sans);
		white-space: nowrap;
		border: 1px solid transparent;
	}

	.color-dot {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		flex-shrink: 0;
	}
</style>
