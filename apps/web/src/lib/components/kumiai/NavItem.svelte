<script lang="ts">
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Inbox from '@lucide/svelte/icons/inbox';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import Columns3 from '@lucide/svelte/icons/columns-3';
	import ScatterChart from '@lucide/svelte/icons/scatter-chart';
	import Map from '@lucide/svelte/icons/map';
	import Folder from '@lucide/svelte/icons/folder';
	import type { LucideIcon } from '@lucide/svelte';
	import type { NavIconName } from './nav-config.js';

	const ICONS: Record<NavIconName, LucideIcon> = {
		CalendarDays,
		Inbox,
		ListChecks,
		Columns3,
		ScatterChart,
		Map,
		Folder
	};

	let {
		label,
		href,
		icon,
		badge,
		active = false,
		disabled = false
	}: {
		label: string;
		href: string | null;
		icon: NavIconName;
		badge?: number;
		active?: boolean;
		disabled?: boolean;
	} = $props();

	const Icon = $derived(ICONS[icon]);
</script>

{#if disabled || !href}
	<span class="nav-item is-disabled" aria-disabled="true">
		<Icon size={16} />
		<span class="nav-item-label">{label}</span>
	</span>
{:else}
	<a class="nav-item" class:is-active={active} {href} aria-current={active ? 'page' : undefined}>
		<Icon size={16} />
		<span class="nav-item-label">{label}</span>
		{#if badge !== undefined}
			<span class="nav-item-badge">{badge}</span>
		{/if}
	</a>
{/if}

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

	a.nav-item:hover {
		background: var(--paper-2);
		color: var(--fg-1);
	}

	.nav-item.is-active {
		background: var(--accent-soft);
		color: var(--accent);
	}

	.nav-item.is-disabled {
		color: var(--fg-4);
		cursor: default;
		opacity: 0.6;
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

	.nav-item-badge {
		flex-shrink: 0;
		min-width: 18px;
		padding: 0 5px;
		border-radius: var(--radius-pill);
		background: var(--paper-3);
		color: var(--fg-2);
		font: 600 11px var(--font-sans);
		text-align: center;
		line-height: 18px;
	}

	.nav-item.is-active .nav-item-badge {
		background: var(--accent);
		color: var(--paper-0);
	}
</style>
