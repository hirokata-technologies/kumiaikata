<script lang="ts">
	import type { LayoutProps } from './$types';
	import { afterNavigate } from '$app/navigation';
	import Sidebar from '$lib/components/kumiai/Sidebar.svelte';
	import AppHeader from '$lib/components/kumiai/AppHeader.svelte';

	let { data, children }: LayoutProps = $props();

	// Narrow screens show the sidebar as a drawer; any navigation closes it.
	let navOpen = $state(false);
	afterNavigate(() => (navOpen = false));
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (navOpen = false)} />

<div class="app-shell">
	<Sidebar
		team={data.team}
		recentProjects={data.recentProjects}
		workspaces={data.workspaces}
		activeWorkspaceId={data.activeWorkspaceId}
		open={navOpen}
	/>

	{#if navOpen}
		<button class="app-shell-scrim" aria-label="Close menu" onclick={() => (navOpen = false)}></button>
	{/if}

	<div class="app-shell-main">
		<AppHeader
			user={data.user}
			tasksInProgress={data.stats.tasksInProgress}
			{navOpen}
			onmenu={() => (navOpen = !navOpen)}
		/>

		<main class="app-shell-content">
			{@render children()}
		</main>
	</div>
</div>

<style>
	/* `body` carries a global `overflow: hidden` — the shell owns its own scroll
	   regions instead (sidebar and main content each get their own overflow-y). */
	.app-shell {
		display: flex;
		height: 100vh;
		height: 100dvh;
	}

	.app-shell-main {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		height: 100%;
	}

	.app-shell-content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-6);
	}

	.app-shell-scrim {
		display: none;
	}

	@media (max-width: 768px) {
		.app-shell-content {
			padding: var(--space-5) var(--space-4);
		}

		.app-shell-scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 40;
			border: 0;
			padding: 0;
			background: rgb(0 0 0 / 0.35);
		}
	}
</style>
