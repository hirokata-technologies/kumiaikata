<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		eyebrow,
		title,
		sub,
		actions
	}: { eyebrow: string; title: string; sub?: string; actions?: Snippet } = $props();
</script>

<header class="page-header">
	<div class="page-header-text">
		<div class="eyebrow">{eyebrow}</div>
		<h1>{title}</h1>
		{#if sub}<p>{sub}</p>{/if}
	</div>
	{#if actions}
		<div class="page-header-actions">{@render actions()}</div>
	{/if}
</header>

<style>
	.page-header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-5);
		margin-bottom: var(--space-5);
	}

	.eyebrow {
		margin-bottom: 6px;
	}

	h1 {
		margin: 0;
		font: 400 36px var(--font-display);
		letter-spacing: -0.02em;
		color: var(--fg-1);
	}

	p {
		margin: 6px 0 0;
		max-width: 68ch;
		font: 400 14px var(--font-sans);
		color: var(--fg-3);
	}
</style>
