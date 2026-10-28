<script lang="ts">
	import ScatterChart from '@lucide/svelte/icons/scatter-chart';
	import Map from '@lucide/svelte/icons/map';
	import type { LucideIcon } from '@lucide/svelte';
	import type { NavIconName } from './nav-config.js';

	const ICONS: Record<NavIconName, LucideIcon> = {
		ScatterChart,
		Map
	};

	let {
		label,
		href,
		icon,
		active = false
	}: {
		label: string;
		href: string;
		icon: NavIconName;
		active?: boolean;
	} = $props();

	const Icon = $derived(ICONS[icon]);
</script>

<a class="nav-item" class:is-active={active} {href} aria-current={active ? 'page' : undefined}>
	<Icon size={16} />
	<span class="nav-item-label">{label}</span>
</a>

<style>
	.nav-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 6px var(--space-2);
		border-radius: var(--radius-md);
		color: var(--fg-2);
		text-decoration: none;
		font: 500 13px var(--font-sans);
		transition:
			background var(--dur-fast),
			color var(--dur-fast);
	}

	.nav-item:hover {
		background: var(--paper-2);
		color: var(--fg-1);
	}

	.nav-item.is-active {
		background: var(--accent-soft);
		color: var(--accent);
	}

	.nav-item :global(svg) {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}

	.nav-item-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
