<script lang="ts">
	import type { Snippet } from 'svelte';

	let { title, text, action }: { title: string; text: string; action?: Snippet } = $props();
</script>

<div class="empty">
	<div class="empty-title">{title}</div>
	<p>{text}</p>
	{#if action}{@render action()}{/if}
</div>

<style>
	.empty {
		border: 1px dashed var(--line-2);
		border-radius: var(--radius-lg);
		padding: 48px;
		text-align: center;
	}

	.empty-title {
		margin-bottom: 6px;
		font: 400 22px var(--font-display);
		color: var(--fg-1);
	}

	p {
		margin: 0 auto 18px;
		max-width: 52ch;
		font: 400 14px var(--font-sans);
		color: var(--fg-3);
	}

	.empty :global(p:last-child) {
		margin-bottom: 0;
	}
</style>
