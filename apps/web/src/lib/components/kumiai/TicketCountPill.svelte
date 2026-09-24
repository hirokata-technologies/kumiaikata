<script lang="ts">
	let { count }: { count: number } = $props();
</script>

<span class="ticket-pill">{count} open tickets</span>

<style>
	.ticket-pill {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		white-space: nowrap;
		padding: 4px var(--space-3);
		border-radius: var(--radius-pill);
		background: var(--accent-soft);
		color: var(--accent);
		font: 600 12px var(--font-sans);
	}
</style>
