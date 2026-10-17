<script lang="ts">
	import { notchBar, NOTCH_ON, NOTCH_OFF } from '$lib/kumiai/notch.js';

	let {
		effort,
		width = 5,
		height = 11
	}: { effort: number; width?: number; height?: number } = $props();

	const notches = $derived(notchBar(effort));
</script>

<span class="notches" role="img" aria-label="Effort {effort} of 10">
	{#each notches as on, i (i)}
		<span
			class="notch"
			style:width="{width}px"
			style:height="{height}px"
			style:background={on ? NOTCH_ON : NOTCH_OFF}
		></span>
	{/each}
</span>

<style>
	.notches {
		display: inline-flex;
		gap: 3px;
	}

	.notch {
		border-radius: 2px;
	}
</style>
