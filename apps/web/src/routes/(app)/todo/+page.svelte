<script lang="ts">
	import type { PageProps } from './$types';
	import PageHeader from '$lib/components/kumiai/PageHeader.svelte';
	import Pill from '$lib/components/kumiai/Pill.svelte';
	import ImpactBar from '$lib/components/kumiai/ImpactBar.svelte';
	import EffortNotches from '$lib/components/kumiai/EffortNotches.svelte';
	import EmptyState from '$lib/components/kumiai/EmptyState.svelte';
	import LoadError from '$lib/components/kumiai/LoadError.svelte';
	import {
		approvalPill,
		projectPriorityPill,
		quadrantOf,
		QUADRANT_LABELS,
		statusPill
	} from '$lib/kumiai/index.js';
	import { buildProjectViews, displayId, reqLine, taskLine } from '$lib/kumiai/derive.js';
	import { formatTargetWindowLong } from '$lib/kumiai/target-window.js';

	let { data }: PageProps = $props();

	const rows = $derived(buildProjectViews(data.workspace).filter((v) => v.project.status === 'todo'));
</script>

<svelte:head>
	<title>To do — Kata</title>
</svelte:head>

{#if data.failed}<LoadError />{/if}

<PageHeader
	eyebrow="Queued work"
	title="To do"
	sub="What is committed but not yet running, with the requirements and plans behind each project."
/>

<div class="rows">
	{#each rows as view (view.project.id)}
		{@const p = view.project}
		<article class="row">
			<div class="row-main">
				<div class="lead">
					<div class="tags">
						<span class="id" title={p.id}>{displayId(p.id)}</span>
						<Pill variant="priority" pill={projectPriorityPill(p.priority)} />
						<span class="id light">{QUADRANT_LABELS[quadrantOf(p.impact, p.effort)]}</span>
					</div>
					<a class="title" href="/projects/{p.id}">{p.title}</a>
					<div class="goal">{view.goal?.title ?? ''}</div>
				</div>
				<div class="scores">
					<div>
						<div class="cap">Impact</div>
						<div class="num">{p.impact}</div>
						<ImpactBar impact={p.impact} width={90} />
					</div>
					<div>
						<div class="cap">Effort</div>
						<div class="num">{p.effort}</div>
						<EffortNotches effort={p.effort} height={12} />
					</div>
					<div>
						<div class="cap">Target</div>
						<div class="num">
							{p.targetWindow ? formatTargetWindowLong(p.targetWindow) : 'No target set'}
						</div>
						<div class="mono">{reqLine(view)}</div>
					</div>
				</div>
			</div>
			<div class="reqs">
				<div class="eyebrow">Requirements</div>
				<div class="req-list">
					{#each view.requirements as r (r.requirement.id)}
						<div class="req">
							<span class="id" title={r.requirement.id}>{displayId(r.requirement.id)}</span>
							<span class="req-title">{r.requirement.title}</span>
							<span class="id light">{taskLine(r)}</span>
							<Pill pill={approvalPill(r.plan?.approval)} />
							<Pill pill={statusPill(r.requirement.status)} />
						</div>
					{:else}
						<div class="none">No requirements yet</div>
					{/each}
				</div>
			</div>
		</article>
	{/each}

	{#if rows.length === 0 && !data.failed}
		<EmptyState title="Nothing queued" text="Everything pulled forward is already running." />
	{/if}
</div>

<style>
	.rows {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.row {
		overflow: hidden;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}

	.row-main {
		display: flex;
		flex-wrap: wrap;
		gap: 16px 24px;
		padding: 20px 24px;
	}

	.lead {
		flex: 1 1 280px;
		min-width: 0;
	}

	.tags {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px;
	}

	.id {
		font: 500 11px var(--font-mono);
		color: var(--fg-4);
		flex: 0 0 auto;
	}

	.id.light {
		font-weight: 400;
	}

	.title {
		display: block;
		margin-top: 8px;
		font: 400 22px var(--font-display);
		letter-spacing: -0.01em;
		color: var(--ink-1);
		text-decoration: none;
	}

	.title:hover {
		text-decoration: underline;
	}

	.goal {
		margin-top: 4px;
		font: 400 13px var(--font-sans);
		color: var(--fg-3);
	}

	.scores {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 26px;
	}

	.cap {
		margin-bottom: 6px;
		font: 600 10px var(--font-sans);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg-4);
	}

	.num {
		margin-bottom: 6px;
		font: 400 20px var(--font-display);
		color: var(--ink-0);
	}

	.mono {
		margin-top: 6px;
		font: 400 11px var(--font-mono);
		color: var(--fg-3);
	}

	.reqs {
		padding: 16px 24px;
		background: var(--paper-1);
		border-top: 1px solid var(--line-1);
	}

	.reqs .eyebrow {
		margin-bottom: 10px;
	}

	.req-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.req {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 14px;
		padding: 11px 14px;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-md);
	}

	.req-title {
		flex: 1 1 200px;
		min-width: 0;
		font: 500 13px var(--font-sans);
		color: var(--fg-1);
	}

	.none {
		font: 400 13px var(--font-sans);
		color: var(--fg-3);
	}
</style>
