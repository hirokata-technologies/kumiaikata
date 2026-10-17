<script lang="ts">
	import type { PageProps } from './$types';
	import PageHeader from '$lib/components/kumiai/PageHeader.svelte';
	import Segmented from '$lib/components/kumiai/Segmented.svelte';
	import ProjectCard from '$lib/components/kumiai/ProjectCard.svelte';
	import Pill from '$lib/components/kumiai/Pill.svelte';
	import EmptyState from '$lib/components/kumiai/EmptyState.svelte';
	import LoadError from '$lib/components/kumiai/LoadError.svelte';
	import { priorityLevelPill } from '$lib/kumiai/index.js';
	import { buildProjectViews, displayId } from '$lib/kumiai/derive.js';
	import { currentPeriod, describePeriod, matchesPeriod } from '$lib/kumiai/period.js';
	import type { TargetWindowKind } from '$lib/kumiai/types.js';

	let { data }: PageProps = $props();

	let kind = $state<TargetWindowKind>('week');

	const views = $derived(buildProjectViews(data.workspace));
	const period = $derived(currentPeriod(kind, new Date()));
	const heading = $derived(describePeriod(period));

	const targeted = $derived(
		views.filter((v) => v.project.status !== 'done' && matchesPeriod(v.project.targetWindow, period))
	);
	const groups = $derived(
		data.workspace.goals
			.map((goal) => ({ goal, cards: targeted.filter((v) => v.project.goalId === goal.id) }))
			.filter((g) => g.cards.length > 0)
	);
	const count = (status: string) => views.filter((v) => v.project.status === status).length;
	const stats = $derived([
		{ label: 'Targeted', value: targeted.length, foot: heading.title.toLowerCase() },
		{ label: 'In flight', value: count('in-progress'), foot: 'across all goals' },
		{ label: 'Blocked', value: count('blocked'), foot: 'waiting on something' },
		{ label: 'In-progress tickets', value: data.stats.tasksInProgress, foot: 'claimed by an agent' }
	]);
</script>

<svelte:head>
	<title>This week — Kata</title>
</svelte:head>

{#if data.failed}<LoadError />{/if}

<PageHeader eyebrow="Targeted work" title={heading.title} sub={heading.sub}>
	{#snippet actions()}
		<Segmented
			label="Period"
			value={kind}
			options={[
				{ value: 'week', label: 'Week' },
				{ value: 'month', label: 'Month' },
				{ value: 'quarter', label: 'Quarter' }
			]}
			onselect={(k) => (kind = k)}
		/>
	{/snippet}
</PageHeader>

<div class="stats">
	{#each stats as stat (stat.label)}
		<div class="stat">
			<div class="eyebrow">{stat.label}</div>
			<div class="stat-value">{stat.value}</div>
			<div class="stat-foot">{stat.foot}</div>
		</div>
	{/each}
</div>

{#each groups as group (group.goal.id)}
	<section class="group">
		<div class="group-head">
			<span class="id" title={group.goal.id}>{displayId(group.goal.id)}</span>
			<h3>{group.goal.title}</h3>
			<Pill variant="priority" pill={priorityLevelPill(group.goal.priority)} />
			<span class="spacer"></span>
			<span class="meta">
				{group.cards.length}
				{group.cards.length === 1 ? 'project' : 'projects'}
			</span>
		</div>
		<div class="cards">
			{#each group.cards as view (view.project.id)}
				<ProjectCard {view} />
			{/each}
		</div>
	</section>
{/each}

{#if groups.length === 0 && !data.failed}
	<EmptyState
		title="Nothing targeted for {heading.title}"
		text="Pull work in from the planning queue and set a target."
	>
		{#snippet action()}
			<a class="k-btn k-btn-primary" href="/todo">Open the planning queue</a>
		{/snippet}
	</EmptyState>
{/if}

<style>
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: var(--space-4);
		margin-bottom: var(--space-6);
	}

	.stat {
		padding: 20px;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}

	.stat-value {
		margin: 6px 0 2px;
		font: 400 36px var(--font-display);
		letter-spacing: -0.01em;
		color: var(--ink-0);
	}

	.stat-foot {
		font: 400 11px var(--font-mono);
		color: var(--fg-3);
	}

	.group {
		margin-bottom: 36px;
	}

	.group-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding-bottom: 10px;
		margin-bottom: var(--space-4);
		border-bottom: 1px solid var(--line-1);
	}

	.group-head h3 {
		margin: 0;
		font: 600 18px var(--font-sans);
		color: var(--fg-1);
	}

	.id {
		font: 500 11px var(--font-mono);
		color: var(--fg-4);
	}

	.spacer {
		flex: 1;
	}

	.meta {
		font: 400 12px var(--font-mono);
		color: var(--fg-3);
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: var(--space-4);
	}
</style>
