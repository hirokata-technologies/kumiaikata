<script lang="ts">
	import { Sun, Moon } from 'lucide-svelte';

	let {
		isDark,
		ontoggle
	}: {
		isDark: boolean;
		ontoggle: () => void;
	} = $props();

	const label = $derived(isDark ? 'Switch to light mode' : 'Switch to dark mode');
</script>

<button
	class="theme-toggle"
	role="switch"
	aria-checked={isDark}
	aria-label={label}
	title={label}
	onclick={ontoggle}
>
	<!-- Sliding thumb -->
	<span class="theme-toggle-thumb" class:is-dark={isDark} class:is-light={!isDark} aria-hidden="true">
		{#if isDark}
			<Moon size={13} />
		{:else}
			<Sun size={13} />
		{/if}
	</span>
	<!-- Track icons -->
	<span class="theme-toggle-track" aria-hidden="true">
		<span class="track-icon"><Sun size={13} /></span>
		<span class="track-icon"><Moon size={13} /></span>
	</span>
</button>

<style>
	.theme-toggle {
		position: relative;
		display: inline-flex;
		align-items: center;
		width: 56px;
		height: 28px;
		padding: 0;
		border: 1px solid var(--line-2);
		border-radius: 999px;
		background: var(--paper-2);
		cursor: pointer;
		transition: background var(--dur-fast), border-color var(--dur-fast);
		flex-shrink: 0;
	}

	.theme-toggle:hover {
		border-color: var(--line-3);
	}

	.theme-toggle:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}

	/* Track background with sun/moon icons on each end */
	.theme-toggle-track {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 7px;
		pointer-events: none;
	}

	.track-icon {
		display: inline-flex;
		color: var(--fg-4);
	}

	.track-icon :global(svg) {
		width: 13px;
		height: 13px;
	}

	/* Sliding thumb */
	.theme-toggle-thumb {
		position: absolute;
		top: 2px;
		width: 22px;
		height: 22px;
		border-radius: 999px;
		background: var(--paper-0);
		color: var(--ink-0);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-shadow: var(--shadow-sm), 0 0 0 1px var(--line-1);
		transition: left var(--dur-base) var(--ease-out);
		z-index: 1;
	}

	.theme-toggle-thumb :global(svg) {
		width: 13px;
		height: 13px;
	}

	.theme-toggle-thumb.is-light {
		left: 2px;
	}

	.theme-toggle-thumb.is-dark {
		left: calc(100% - 24px);
	}
</style>
