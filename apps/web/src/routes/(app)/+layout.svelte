<script lang="ts">
	import type { LayoutProps } from './$types';
	import Sidebar from '$lib/components/kumiai/Sidebar.svelte';
	import AppHeader from '$lib/components/kumiai/AppHeader.svelte';

	let { data, children }: LayoutProps = $props();
</script>

<div class="app-shell">
	<Sidebar
		team={data.team}
		recentProjects={data.recentProjects}
		projectCounts={data.stats.projectCounts}
		workspaces={data.workspaces}
		activeWorkspaceId={data.activeWorkspaceId}
	/>

	<div class="app-shell-main">
		<AppHeader user={data.user} tasksInProgress={data.stats.tasksInProgress} />

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
	}

	.app-shell-main {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		height: 100vh;
	}

	.app-shell-content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--space-6);
	}
</style>
