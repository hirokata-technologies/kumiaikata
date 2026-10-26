<script lang="ts">
	import Menu from '@lucide/svelte/icons/menu';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import SearchBox from './SearchBox.svelte';
	import TicketCountPill from './TicketCountPill.svelte';

	let {
		user,
		tasksInProgress,
		navOpen = false,
		onmenu
	}: {
		user: { name?: string | null; email: string; image?: string | null };
		tasksInProgress: number;
		navOpen?: boolean;
		onmenu?: () => void;
	} = $props();

	// Mirrors src/lib/components/kata/MeMenu.svelte's resolution: display name falls
	// back to email, initials fall back to the email's first letter.
	const displayName = $derived(user.name?.trim() || user.email || 'You');
	const initials = $derived.by(() => {
		const name = user.name?.trim();
		if (name) {
			const parts = name.split(/\s+/);
			if (parts.length >= 2) return parts[0][0].toUpperCase() + parts[1][0].toUpperCase();
			return name[0].toUpperCase();
		}
		return user.email[0]?.toUpperCase() ?? 'Y';
	});
</script>

<header class="app-header">
	<button
		type="button"
		class="app-header-menu"
		aria-label="Open menu"
		aria-controls="app-sidebar"
		aria-expanded={navOpen}
		onclick={onmenu}
	>
		<Menu size={20} />
	</button>

	<SearchBox />

	<div class="app-header-right">
		<TicketCountPill count={tasksInProgress} />
		<Avatar.Root class="app-header-avatar" title={displayName}>
			{#if user.image}
				<Avatar.Image src={user.image} alt="" />
			{/if}
			<Avatar.Fallback>{initials}</Avatar.Fallback>
		</Avatar.Root>
	</div>
</header>

<style>
	.app-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-5);
		border-bottom: 1px solid var(--line-1);
		background: var(--paper-0);
		flex-shrink: 0;
	}

	.app-header-menu {
		display: none;
	}

	.app-header-right {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-shrink: 0;
	}

	.app-header-right :global(.app-header-avatar) {
		background: var(--accent);
		color: var(--paper-0);
		font: 600 13px var(--font-sans);
	}

	@media (max-width: 768px) {
		.app-header {
			gap: var(--space-2);
			padding: var(--space-2) var(--space-3);
		}

		.app-header-menu {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			flex-shrink: 0;
			width: 40px;
			height: 40px;
			border: 0;
			border-radius: var(--radius-md);
			background: transparent;
			color: var(--fg-2);
			cursor: pointer;
		}

		.app-header-right {
			gap: var(--space-2);
		}
	}
</style>
