<script lang="ts">
	import type { Pill } from '$lib/kumiai/types.js';

	let {
		pill,
		variant = 'status'
	}: {
		pill: Pill;
		/** `priority` is the small uppercase tag; `status` is the sentence-case chip. */
		variant?: 'status' | 'priority';
	} = $props();
</script>

<span class="pill pill-{variant}" style:background={pill.bg} style:color={pill.fg}>{pill.label}</span>

<style>
	.pill {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		white-space: nowrap;
		border-radius: var(--radius-pill);
		font-family: var(--font-sans);
	}

	.pill-status {
		padding: 3px 9px;
		font-size: 11px;
		font-weight: 500;
	}

	.pill-priority {
		padding: 3px 9px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
</style>
