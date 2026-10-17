<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		onclose,
		width = 480,
		children
	}: { label: string; onclose: () => void; width?: number; children: Snippet } = $props();

	let panel: HTMLElement | undefined = $state();

	$effect(() => {
		panel?.focus();
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') onclose();
	}}
/>

<div
	class="backdrop"
	role="presentation"
	onpointerdown={(e) => {
		if (e.target === e.currentTarget) onclose();
	}}
>
	<div
		class="panel"
		bind:this={panel}
		role="dialog"
		aria-modal="true"
		aria-label={label}
		tabindex="-1"
		style:max-width="{width}px"
	>
		{@render children()}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 80;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-5);
		background: rgba(20, 19, 15, 0.28);
		backdrop-filter: blur(4px);
	}

	.panel {
		width: 100%;
		max-height: calc(100vh - 48px);
		overflow-y: auto;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		padding: var(--space-5);
		outline: none;
	}
</style>
