<script lang="ts">
	import { page } from '$app/state';
	import { NAV_VIEWS, NAV_PLANNING, NAV_PROJECTS_ENTRY, isActive } from './nav-config.js';
	import type { ProjectCounts } from './nav-config.js';
	import type { RecentProject } from '$lib/api/kumiai/types.js';
	import type { TeamInfo } from '$lib/api/types.js';
	import NavItem from './NavItem.svelte';
	import WorkspaceBlock from './WorkspaceBlock.svelte';
	import RecentlyOpened from './RecentlyOpened.svelte';

	let {
		team,
		recentProjects,
		projectCounts
	}: {
		team: TeamInfo | null;
		recentProjects: RecentProject[];
		projectCounts: ProjectCounts;
	} = $props();

	// The "Projects" nav item has no static route — it opens the most recently opened
	// project. With no history it renders disabled rather than linking nowhere.
	const projectsHref = $derived(recentProjects[0] ? `/projects/${recentProjects[0].id}` : null);
	const projectsActive = $derived(isActive(page.url.pathname, '/projects'));
</script>

<aside class="sidebar">
	<WorkspaceBlock teamName={team?.name ?? null} />

	<nav class="nav-group" aria-label="Views">
		<span class="eyebrow nav-group-label">Views</span>
		{#each NAV_VIEWS as entry (entry.href)}
			<NavItem
				label={entry.label}
				href={entry.href}
				icon={entry.icon}
				badge={entry.badge ? projectCounts[entry.badge] : undefined}
				active={isActive(page.url.pathname, entry.href)}
			/>
		{/each}
	</nav>

	<div class="nav-divider"></div>

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
		<NavItem
			label={NAV_PROJECTS_ENTRY.label}
			href={projectsHref}
			icon={NAV_PROJECTS_ENTRY.icon}
			active={projectsActive}
			disabled={!projectsHref}
		/>
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
		height: 100vh;
		overflow-y: auto;
		background: var(--paper-1);
		border-right: 1px solid var(--line-1);
		padding: var(--space-4) var(--space-3);
		gap: var(--space-4);
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
</style>
