<script lang="ts">
	import { projectPriorityPill } from '$lib/kumiai';
	import type { RecentProject } from '$lib/api/kumiai/types.js';

	let { projects }: { projects: RecentProject[] } = $props();

	// The API already caps at 5 and orders newest-first; slicing here is a defensive
	// belt-and-suspenders so the UI's own contract does not depend on the server's.
	const shown = $derived(projects.slice(0, 5));
</script>

<div class="recent">
	<span class="eyebrow recent-eyebrow">Recently opened</span>

	{#if shown.length === 0}
		<p class="recent-empty">No projects opened yet.</p>
	{:else}
		<ul class="recent-list">
			{#each shown as project (project.id)}
				<li>
					<a class="recent-item" href={`/projects/${project.id}`}>
						<span
							class="recent-dot"
							style:background={projectPriorityPill(project.priority).dotHex}
						></span>
						<span class="recent-title">{project.title}</span>
						<span class="recent-id">{project.id}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.recent {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.recent-eyebrow {
		padding: 0 var(--space-2);
		margin-bottom: var(--space-1);
	}

	.recent-empty {
		margin: 0;
		padding: 6px var(--space-2);
		font: 400 12px var(--font-sans);
		color: var(--fg-4);
	}

	.recent-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.recent-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 6px var(--space-2);
		border-radius: var(--radius-md);
		text-decoration: none;
		color: var(--fg-2);
		transition: background var(--dur-fast);
	}

	.recent-item:hover {
		background: var(--paper-2);
		color: var(--fg-1);
	}

	.recent-dot {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		flex-shrink: 0;
	}

	.recent-title {
		flex: 1;
		min-width: 0;
		font: 500 13px var(--font-sans);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.recent-id {
		flex-shrink: 0;
		font: 400 11px var(--font-mono);
		color: var(--fg-4);
	}
</style>
