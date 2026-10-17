<script lang="ts">
	let {
		impact,
		height = 5,
		width
	}: { impact: number; height?: number; width?: number } = $props();

	const pct = $derived(Math.min(100, Math.max(0, impact)));
</script>

<span
	class="track"
	role="img"
	aria-label="Impact {impact} of 100"
	style:height="{height}px"
	style:width={width ? `${width}px` : '100%'}
>
	<span class="fill" style:width="{pct}%"></span>
</span>

<style>
	.track {
		display: block;
		border-radius: var(--radius-pill);
		background: var(--paper-2);
		overflow: hidden;
	}

	.fill {
		display: block;
		height: 100%;
		background: var(--accent);
	}
</style>
