<script lang="ts">
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { NAV_PLANNING, isActive } from './nav-config.js';
	import type { RecentProject } from '$lib/api/kumiai/types.js';
	import type { TeamInfo } from '$lib/api/types.js';
	import type { KumiaiWorkspace } from '$lib/kumiai/types.js';
	import { createWorkspace } from '$lib/api/kumiai/workspaces.js';
	import { rememberWorkspace } from '$lib/kumiai/active-workspace.js';
	import { errorMessage } from '$lib/kumiai/actions.js';
	import NavItem from './NavItem.svelte';
	import WorkspaceBlock from './WorkspaceBlock.svelte';
	import WorkspaceSelector from './WorkspaceSelector.svelte';
	import RecentlyOpened from './RecentlyOpened.svelte';

	let {
		team,
		recentProjects,
		workspaces = [],
		activeWorkspaceId = null,
		open = false
	}: {
		team: TeamInfo | null;
		recentProjects: RecentProject[];
		workspaces?: KumiaiWorkspace[];
		activeWorkspaceId?: string | null;
		/** Drawer state on narrow screens; ignored on wide ones. */
		open?: boolean;
	} = $props();

	async function enter(id: string) {
		rememberWorkspace(id);
		// A project belongs to one workspace, so its page makes no sense in another.
		if (page.url.pathname.startsWith('/projects/')) await goto('/roadmap', { invalidateAll: true });
		else await invalidateAll();
	}

	async function addWorkspace(name: string): Promise<string | null> {
		try {
			const created = await createWorkspace(name);
			await enter(created.id);
			return null;
		} catch (e) {
			return errorMessage(e);
		}
	}
</script>

<aside id="app-sidebar" class="sidebar" class:open>
	<div class="sidebar-head">
		<WorkspaceBlock teamName={team?.name ?? null} />
		<WorkspaceSelector
			{workspaces}
			activeId={activeWorkspaceId}
			onselect={enter}
			oncreate={addWorkspace}
		/>
	</div>

	<nav class="nav-group" aria-label="Planning">
		<span class="eyebrow nav-group-label">Planning</span>
		{#each NAV_PLANNING as entry (entry.href)}
			<NavItem
				label={entry.label}
				href={entry.href}
				icon={entry.icon}
				active={isActive(page.url.pathname, entry.href)}
			/>
		{/each}
	</nav>

	<div class="nav-divider"></div>

	<RecentlyOpened projects={recentProjects} />
</aside>

<style>
	.sidebar {
		display: flex;
		flex-direction: column;
		width: 248px;
		flex-shrink: 0;
		height: 100%;
		overflow-y: auto;
		background: var(--paper-1);
		border-right: 1px solid var(--line-1);
		padding: var(--space-4) var(--space-3);
		gap: var(--space-4);
	}

	.sidebar-head {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.nav-group {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.nav-group-label {
		padding: 0 var(--space-2);
		margin-bottom: var(--space-1);
	}

	.nav-divider {
		height: 1px;
		flex-shrink: 0;
		background: var(--line-1);
		margin: 0 var(--space-1);
	}

	@media (max-width: 768px) {
		.sidebar {
			position: fixed;
			inset: 0 auto 0 0;
			z-index: 50;
			width: min(280px, 85vw);
			box-shadow: var(--shadow-md);
			transform: translateX(-100%);
			visibility: hidden;
			transition:
				transform var(--dur-fast) ease,
				visibility var(--dur-fast);
		}

		.sidebar.open {
			transform: none;
			visibility: visible;
		}
	}
</style>
