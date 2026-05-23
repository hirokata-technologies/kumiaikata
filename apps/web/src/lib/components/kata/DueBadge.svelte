<script lang="ts">
	import { formatDue } from '$lib/data.js';

	let { iso, done = false, compact = false }: { iso?: string; done?: boolean; compact?: boolean } = $props();

	const info = $derived(iso ? formatDue(iso) : null);
	const tone = $derived(done ? 'done' : (info?.tone ?? 'later'));
</script>

{#if iso || done}
	<span class="due due-{tone}" class:compact>
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
			<line x1="16" y1="2" x2="16" y2="6"></line>
			<line x1="8" y1="2" x2="8" y2="6"></line>
			<line x1="3" y1="10" x2="21" y2="10"></line>
		</svg>
		{#if done}
			Done
		{:else if info}
			{info.label}
		{/if}
	</span>
{/if}

<style>
	.due {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 8px;
		border-radius: 999px;
		font: 500 11px var(--font-sans);
		white-space: nowrap;
	}

	.due-later {
		color: var(--ink-3);
		background: var(--paper-2);
	}

	.due-soon {
		color: #B07A2A;
		background: rgba(176, 122, 42, 0.10);
	}

	.due-today {
		color: #B07A2A;
		background: rgba(176, 122, 42, 0.16);
		border: 1px solid rgba(176, 122, 42, 0.35);
		padding: 1px 7px;
	}

	.due-overdue {
		color: #9B3B2E;
		background: rgba(155, 59, 46, 0.10);
		border: 1px solid rgba(155, 59, 46, 0.35);
		padding: 1px 7px;
		font-weight: 600;
	}

	.due-done {
		color: var(--ink-4);
		background: transparent;
		text-decoration: line-through;
	}
</style>
