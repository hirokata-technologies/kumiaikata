<script lang="ts">
	import { X } from '@lucide/svelte';
	import type { KataProject, GroupBy } from '$lib/types.js';

	let {
		variant = 'board',
		groupBy,
		activeProjectId,
		boardProjects,
		projectCounts,
		totalCount,
		ongroupby,
		onprojectfilter,
	}: {
		variant?: 'board' | 'roadmap';
		groupBy: GroupBy;
		activeProjectId: string | null;
		boardProjects: KataProject[];
		projectCounts: Record<string, number>;
		totalCount: number;
		ongroupby: (g: GroupBy) => void;
		onprojectfilter: (pid: string | null) => void;
	} = $props();

	const noProjectCount = $derived(projectCounts['__none'] ?? 0);
</script>

<div class="viewbar">
	<div class="viewbar-l">
		{#if variant === 'board'}
			<!-- Group by segmented control -->
			<span class="viewbar-label">Group by</span>
			<div class="viewbar-seg" role="tablist">
				{#each [{ value: 'status', label: 'Status' }, { value: 'project', label: 'Project' }] as opt (opt.value)}
					<button
						role="tab"
						aria-selected={groupBy === opt.value}
						class="viewbar-seg-btn"
						class:is-on={groupBy === opt.value}
						onclick={() => ongroupby(opt.value as GroupBy)}
					>
						{opt.label}
					</button>
				{/each}
			</div>

			<span class="viewbar-sep" aria-hidden="true"></span>
		{/if}

		<!-- Project filter chips -->
		<span class="viewbar-label">Project</span>
		<div class="viewbar-chips">
			<!-- All -->
			<button
				class="pchip pchip-all"
				class:is-on={!activeProjectId}
				onclick={() => onprojectfilter(null)}
			>
				<span>All</span>
				<span class="pchip-count">{totalCount}</span>
			</button>

			<!-- Per-project chips -->
			{#each boardProjects as p (p.id)}
				{@const count = projectCounts[p.id] ?? 0}
				<button
					class="pchip"
					class:is-on={activeProjectId === p.id}
					style="--pc: {p.color}"
					onclick={() => onprojectfilter(activeProjectId === p.id ? null : p.id)}
				>
					<span class="pchip-dot"></span>
					<span class="pchip-name">{p.name}</span>
					<span class="pchip-count">{count}</span>
				</button>
			{/each}

			<!-- No project chip — only if some cards have no project -->
			{#if noProjectCount > 0}
				<button
					class="pchip pchip-none"
					class:is-on={activeProjectId === '__none'}
					onclick={() => onprojectfilter(activeProjectId === '__none' ? null : '__none')}
				>
					<span class="pchip-name">No project</span>
					<span class="pchip-count">{noProjectCount}</span>
				</button>
			{/if}
		</div>
	</div>

	<div class="viewbar-r">
		{#if variant === 'roadmap'}
			<div class="rm-bar-legend">
				<span class="rm-legend-item"><span class="rm-legend-dot is-todo"></span>Scheduled</span>
				<span class="rm-legend-item"><span class="rm-legend-dot is-doing"></span>In progress</span>
				<span class="rm-legend-item"><span class="rm-legend-dot is-done"></span>Done</span>
			</div>
		{/if}
		{#if activeProjectId}
			<button class="viewbar-clear" onclick={() => onprojectfilter(null)}>
				<X size={12} />
				<span>Clear filter</span>
			</button>
		{/if}
	</div>
</div>

<style>
	.viewbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 10px 24px;
		background: var(--paper-1);
		border-bottom: 1px solid var(--line-1);
		min-height: 48px;
		flex-shrink: 0;
		z-index: 4;
	}

	.viewbar-l {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		flex: 1;
		overflow-x: auto;
		scrollbar-width: none;
		padding-bottom: 1px;
	}

	.viewbar-l::-webkit-scrollbar {
		display: none;
	}

	.viewbar-r {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.viewbar-label {
		color: var(--fg-4);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		font-weight: 600;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.viewbar-sep {
		width: 1px;
		height: 20px;
		background: var(--line-2);
		flex-shrink: 0;
		margin: 0 6px;
	}

	/* Segmented control */
	.viewbar-seg {
		display: inline-flex;
		background: var(--paper-2);
		border: 1px solid var(--line-1);
		border-radius: 8px;
		padding: 2px;
		gap: 1px;
		flex-shrink: 0;
	}

	.viewbar-seg-btn {
		font: 500 12.5px var(--font-sans);
		color: var(--fg-3);
		background: transparent;
		border: none;
		padding: 4px 12px;
		border-radius: 6px;
		cursor: pointer;
		transition: all var(--dur-fast);
	}

	.viewbar-seg-btn:hover {
		color: var(--fg-1);
	}

	.viewbar-seg-btn.is-on {
		background: var(--paper-0);
		color: var(--fg-1);
		box-shadow: var(--shadow-sm);
	}

	/* Project chips */
	.viewbar-chips {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		flex-shrink: 0;
	}

	.pchip {
		--pc: var(--fg-3);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px 4px 9px;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: 999px;
		font: 500 12.5px var(--font-sans);
		color: var(--fg-2);
		cursor: pointer;
		transition: all var(--dur-fast);
		white-space: nowrap;
		letter-spacing: -0.005em;
	}

	.pchip:hover {
		border-color: var(--line-3);
		color: var(--fg-1);
	}

	.pchip-dot {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		background: var(--pc);
		flex-shrink: 0;
	}

	.pchip-count {
		font: 500 10.5px var(--font-mono);
		color: var(--fg-4);
		background: var(--paper-2);
		padding: 1px 6px;
		border-radius: 999px;
		letter-spacing: 0;
	}

	.pchip:hover .pchip-count {
		background: var(--paper-3);
	}

	.pchip.is-on {
		background: var(--ink-0);
		color: var(--paper-0);
		border-color: var(--ink-0);
	}

	.pchip.is-on .pchip-count {
		background: rgba(244, 241, 234, 0.16);
		color: var(--paper-0);
	}

	.pchip.is-on .pchip-dot {
		background: var(--paper-0);
	}

	.pchip-none {
		font-style: italic;
		color: var(--fg-3);
	}

	/* Clear filter button */
	.viewbar-clear {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 10px;
		background: transparent;
		border: 1px solid var(--line-2);
		border-radius: 999px;
		font: 500 12px var(--font-sans);
		color: var(--fg-3);
		cursor: pointer;
		transition: all var(--dur-fast);
	}

	.viewbar-clear:hover {
		color: var(--fg-1);
		border-color: var(--line-3);
	}

	/* Roadmap legend */
	.rm-bar-legend {
		display: inline-flex;
		align-items: center;
		gap: 12px;
	}

	.rm-legend-item {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: 500 11.5px var(--font-sans);
		color: var(--fg-3);
		white-space: nowrap;
	}

	.rm-legend-dot {
		width: 8px;
		height: 8px;
		border-radius: 999px;
		flex: 0 0 auto;
	}

	.rm-legend-dot.is-todo { background: var(--accent); }
	.rm-legend-dot.is-doing { background: var(--warning); }
	.rm-legend-dot.is-done { background: var(--success); }
</style>
