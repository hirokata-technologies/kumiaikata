<script lang="ts">
	import type { PageProps } from './$types';
	import { invalidateAll } from '$app/navigation';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import PageHeader from '$lib/components/kumiai/PageHeader.svelte';
	import Segmented from '$lib/components/kumiai/Segmented.svelte';
	import FilterChips from '$lib/components/kumiai/FilterChips.svelte';
	import Pill from '$lib/components/kumiai/Pill.svelte';
	import ImpactBar from '$lib/components/kumiai/ImpactBar.svelte';
	import EffortNotches from '$lib/components/kumiai/EffortNotches.svelte';
	import EmptyState from '$lib/components/kumiai/EmptyState.svelte';
	import TargetPicker from '$lib/components/kumiai/TargetPicker.svelte';
	import LoadError from '$lib/components/kumiai/LoadError.svelte';
	import { projectPriorityPill, quadrantOf, QUADRANT_LABELS } from '$lib/kumiai/index.js';
	import { buildProjectViews, displayId, sortProjects, type BacklogSort } from '$lib/kumiai/derive.js';
	import { saveProject, statusPatch } from '$lib/kumiai/actions.js';
	import { formatTargetWindow } from '$lib/kumiai/target-window.js';
	import { toTargetWindow, type PeriodSelection } from '$lib/kumiai/period.js';

	let { data }: PageProps = $props();

	let filter = $state('all');
	let sort = $state<BacklogSort>('impact');
	let pickFor = $state<string | null>(null);
	let error = $state<string | null>(null);

	const backlog = $derived(buildProjectViews(data.workspace).filter((v) => v.project.status === 'backlog'));
	const filterOptions = $derived([
		{ value: 'all', label: 'All' },
		...data.workspace.goals.map((g) => ({ value: `goal:${g.id}`, label: g.title })),
		{ value: 'urgent', label: 'Urgent' },
		{ value: 'high', label: 'High' },
		{ value: 'medium', label: 'Medium' },
		{ value: 'low', label: 'Low' }
	]);
	const rows = $derived.by(() => {
		const matching = backlog.filter((v) => {
			if (filter === 'all') return true;
			if (filter.startsWith('goal:')) return v.project.goalId === filter.slice(5);
			return v.project.priority === filter;
		});
		return sortProjects(matching, sort);
	});
	const picking = $derived(backlog.find((v) => v.project.id === pickFor));
	const pickingCurrent = $derived<PeriodSelection | null>(
		picking?.project.targetWindow
			? {
					kind: picking.project.targetWindow.kind,
					year: picking.project.targetWindow.year,
					number: picking.project.targetWindow.number
				}
			: null
	);

	async function save(id: string, patch: Parameters<typeof saveProject>[1]) {
		error = await saveProject(id, patch);
		await invalidateAll();
	}
</script>

<svelte:head>
	<title>Backlog — Kata</title>
</svelte:head>

{#if data.failed}<LoadError />{/if}

<PageHeader
	eyebrow="Triage"
	title="Backlog"
	sub="{backlog.length} {backlog.length === 1 ? 'project' : 'projects'} waiting on a decision. Scored on impact and effort, so the order is an argument rather than an opinion."
>
	{#snippet actions()}
		<Segmented
			label="Sort by"
			value={sort}
			options={[
				{ value: 'impact', label: 'Impact' },
				{ value: 'effort', label: 'Least effort' },
				{ value: 'priority', label: 'Priority' }
			]}
			onselect={(s) => (sort = s)}
		/>
	{/snippet}
</PageHeader>

<div class="filters">
	<FilterChips label="Filter" value={filter} options={filterOptions} onselect={(f) => (filter = f)} />
</div>

{#if error}<p class="error" role="alert">{error}</p>{/if}

<div class="rows">
	{#each rows as view (view.project.id)}
		{@const p = view.project}
		<div class="row">
			<div class="lead">
				<div class="tags">
					<span class="id" title={p.id}>{displayId(p.id)}</span>
					<Pill variant="priority" pill={projectPriorityPill(p.priority)} />
					<span class="id light">{QUADRANT_LABELS[quadrantOf(p.impact, p.effort)]}</span>
				</div>
				<a class="title" href="/projects/{p.id}">{p.title}</a>
				<div class="goal">{view.goal?.title ?? ''}</div>
			</div>
			<div class="impact">
				<div class="cap">Impact {p.impact}</div>
				<ImpactBar impact={p.impact} height={6} />
			</div>
			<div>
				<div class="cap">Effort {p.effort}</div>
				<EffortNotches effort={p.effort} height={12} />
			</div>
			<div class="actions">
				<button type="button" class="target" onclick={() => (pickFor = p.id)}>
					<CalendarDays size={14} />
					<span class:muted={!p.targetWindow}>
						{p.targetWindow ? formatTargetWindow(p.targetWindow) : 'Set target'}
					</span>
				</button>
				<button
					type="button"
					class="k-btn k-btn-secondary k-btn-sm"
					onclick={() => save(p.id, statusPatch('todo'))}
				>
					Pull to To do
				</button>
			</div>
		</div>
	{/each}
</div>

{#if rows.length === 0 && !data.failed}
	<EmptyState
		title="Nothing here yet"
		text={backlog.length === 0 ? 'The backlog is empty.' : 'No backlog project matches this filter.'}
	>
		{#snippet action()}
			{#if backlog.length > 0}
				<button type="button" class="k-btn k-btn-secondary" onclick={() => (filter = 'all')}>
					Clear the filter
				</button>
			{/if}
		{/snippet}
	</EmptyState>
{/if}

{#if picking}
	<TargetPicker
		mode="target"
		subject="{displayId(picking.project.id)} · {picking.project.title}"
		current={pickingCurrent}
		onselect={(period) => {
			const id = picking.project.id;
			pickFor = null;
			void save(id, { targetWindow: toTargetWindow(period) });
		}}
		onclear={() => {
			const id = picking.project.id;
			pickFor = null;
			void save(id, { targetWindow: null });
		}}
		onclose={() => (pickFor = null)}
	/>
{/if}

<style>
	.filters {
		margin-bottom: 20px;
	}

	.error {
		margin: 0 0 var(--space-4);
		font: 500 13px var(--font-sans);
		color: var(--danger);
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 14px 20px;
		padding: 16px 20px;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}

	.lead {
		flex: 1 1 260px;
		min-width: 0;
	}

	.tags {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.id {
		font: 500 11px var(--font-mono);
		color: var(--fg-4);
	}

	.id.light {
		font-weight: 400;
	}

	.title {
		display: block;
		margin-top: 6px;
		font: 600 15px var(--font-sans);
		color: var(--fg-1);
		text-decoration: none;
	}

	.title:hover {
		text-decoration: underline;
	}

	.goal {
		margin-top: 3px;
		font: 400 12px var(--font-sans);
		color: var(--fg-3);
	}

	.impact {
		flex: 0 1 170px;
		min-width: 120px;
	}

	.cap {
		margin-bottom: 6px;
		font: 600 10px var(--font-sans);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg-4);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-left: auto;
	}

	.target {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 8px 10px;
		border: 1px solid var(--line-2);
		border-radius: 6px;
		background: var(--paper-0);
		color: var(--fg-1);
		font: 500 12px var(--font-mono);
		cursor: pointer;
	}

	.target:hover {
		background: var(--paper-1);
	}

	.target :global(svg) {
		color: var(--fg-3);
	}

	.muted {
		color: var(--fg-3);
	}
</style>
