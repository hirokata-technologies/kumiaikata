<script lang="ts">
	import { LABELS } from '$lib/data.js';
	import type { LabelId } from '$lib/types.js';

	let { id }: { id: LabelId } = $props();

	const L = $derived(LABELS[id]);
</script>

{#if L}
	<span class="lbl" style="color: {L.fg}; background: {L.bg}">
		<span class="color-dot" style="background: {L.fg}"></span>
		{L.name}
	</span>
{/if}

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
