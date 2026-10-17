<script lang="ts">
	import type { PageProps } from './$types';
	import { invalidateAll } from '$app/navigation';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
	import Pill from '$lib/components/kumiai/Pill.svelte';
	import BarSlider from '$lib/components/kumiai/BarSlider.svelte';
	import TargetPicker from '$lib/components/kumiai/TargetPicker.svelte';
	import EmptyState from '$lib/components/kumiai/EmptyState.svelte';
	import LoadError from '$lib/components/kumiai/LoadError.svelte';
	import { approvalPill, projectPriorityPill, statusPill } from '$lib/kumiai/index.js';
	import { buildProjectViews, displayId, EMPTY_WORKSPACE, reqLine, taskLine } from '$lib/kumiai/derive.js';
	import { saveProject } from '$lib/kumiai/actions.js';
	import { formatTargetWindow } from '$lib/kumiai/target-window.js';
	import { toTargetWindow, type PeriodSelection } from '$lib/kumiai/period.js';

	let { data }: PageProps = $props();

	let expanded = $state<Record<string, boolean>>({});
	let draft = $state<{ impact?: number; effort?: number }>({});
	let picking = $state(false);
	let error = $state<string | null>(null);

	const project = $derived(data.project);
	const workspace = $derived(data.notFound ? EMPTY_WORKSPACE : data.workspace);
	const view = $derived(
		project ? buildProjectViews(workspace).find((v) => v.project.id === project.id) : undefined
	);
	const impact = $derived(draft.impact ?? project?.impact ?? 1);
	const effort = $derived(draft.effort ?? project?.effort ?? 1);
	const requirements = $derived(view?.requirements ?? []);
	const goal = $derived(
		project ? workspace.goals.find((g) => g.id === project.goalId) : undefined
	);
	const current = $derived<PeriodSelection | null>(
		project?.targetWindow
			? {
					kind: project.targetWindow.kind,
					year: project.targetWindow.year,
					number: project.targetWindow.number
				}
			: null
	);

	async function save(patch: Parameters<typeof saveProject>[1]) {
		if (!project) return;
		error = await saveProject(project.id, patch);
		await invalidateAll();
		draft = {};
	}
</script>

<svelte:head>
	<title>{data.notFound || !project ? 'Project not found' : project.title} — Kata</title>
</svelte:head>

{#if data.notFound || !project}
	<section class="not-found">
		<h1>Project not found</h1>
		<p>This project doesn't exist, or you don't have access to it.</p>
		<a href="/roadmap">Back to the roadmap</a>
	</section>
{:else}
	{#if data.failed}<LoadError />{/if}

	<a class="back" href="/roadmap"><ArrowLeft size={14} /> <span>All projects</span></a>

	<div class="head">
		<div class="head-text">
			<div class="tags">
				<span class="id" title={project.id}>{displayId(project.id)}</span>
				<Pill variant="priority" pill={projectPriorityPill(project.priority)} />
				<Pill pill={statusPill(project.status)} />
			</div>
			<h1>{project.title}</h1>
			<p class="goal">{goal?.title ?? ''}</p>
		</div>

		<div class="scores">
			<div>
				<div class="cap">Impact</div>
				<div class="figure"><span>{impact}</span><small>/ 100</small></div>
				<div class="slider">
					<BarSlider
						kind="impact"
						label="Impact"
						value={impact}
						onchange={(v) => (draft = { ...draft, impact: v })}
						oncommit={(v) => void save({ impact: v })}
					/>
				</div>
			</div>
			<div>
				<div class="cap">Effort</div>
				<div class="figure"><span>{effort}</span><small>/ 10</small></div>
				<div class="slider">
					<BarSlider
						kind="effort"
						label="Effort"
						value={effort}
						onchange={(v) => (draft = { ...draft, effort: v })}
						oncommit={(v) => void save({ effort: v })}
					/>
				</div>
			</div>
			<div>
				<div class="cap">Target</div>
				<button type="button" class="target" onclick={() => (picking = true)}>
					<span class="figure-text">
						{project.targetWindow ? formatTargetWindow(project.targetWindow) : 'None'}
					</span>
					<CalendarDays size={14} />
				</button>
				<div class="mono">
					{view ? `${view.reqsDone} of ${view.reqsTotal} requirements done` : ''}
				</div>
			</div>
		</div>
	</div>

	{#if error}<p class="error" role="alert">{error}</p>{/if}

	{#if project.status === 'blocked' && project.blockedReason}
		<div class="blocked">
			<AlertTriangle size={14} />
			<span>{project.blockedReason}</span>
		</div>
	{/if}

	<div class="eyebrow list-title">Requirements</div>
	<div class="reqs">
		{#each requirements as r (r.requirement.id)}
			{@const open = !!expanded[r.requirement.id]}
			<div class="req">
				<button
					type="button"
					class="req-head"
					aria-expanded={open}
					onclick={() => (expanded[r.requirement.id] = !open)}
				>
					<span class="caret" class:open><ChevronRight size={16} /></span>
					<span class="req-main">
						<span class="req-ids">
							<span class="id" title={r.requirement.id}>{displayId(r.requirement.id)}</span>
							<span class="id light">{taskLine(r)}</span>
						</span>
						<span class="req-title">{r.requirement.title}</span>
					</span>
					<Pill pill={approvalPill(r.plan?.approval)} />
					<Pill pill={statusPill(r.requirement.status)} />
				</button>

				{#if open}
					<div class="req-body">
						{#if r.plan}
							<div class="eyebrow">Plan</div>
							<div class="plan">
								<div class="plan-head">
									<span class="id" title={r.plan.id}>{displayId(r.plan.id)}</span>
									<span class="plan-title">{r.plan.title}</span>
									<Pill pill={approvalPill(r.plan.approval)} />
								</div>
								{#if r.plan.body}<p>{r.plan.body}</p>{/if}
							</div>
						{/if}

						<div class="eyebrow">Tasks</div>
						<div class="tasks">
							{#each r.tasks as t (t.id)}
								<div class="task">
									<div>
										<div class="task-title">{t.title}</div>
										<div class="id light" title={t.id}>{displayId(t.id)}</div>
									</div>
									<Pill pill={statusPill(t.status)} />
								</div>
							{:else}
								<div class="none">No tasks yet.</div>
							{/each}
						</div>

						{#if !r.plan}
							<div class="no-plan">
								<div class="plan-title">No plan yet</div>
								<p>Nothing is built until a plan is written and approved.</p>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	{#if requirements.length === 0 && !data.failed}
		<EmptyState
			title="Nothing planned yet"
			text="This project carries a priority, an impact score and an effort estimate ({reqLine({ reqsTotal: 0, reqsDone: 0 })}), but no requirements have been written."
		/>
	{/if}

	{#if picking}
		<TargetPicker
			mode="target"
			subject="{displayId(project.id)} · {project.title}"
			{current}
			onselect={(period) => {
				picking = false;
				void save({ targetWindow: toTargetWindow(period) });
			}}
			onclear={() => {
				picking = false;
				void save({ targetWindow: null });
			}}
			onclose={() => (picking = false)}
		/>
	{/if}
{/if}

<style>
	.not-found {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.not-found h1 {
		margin: 0;
		font: 400 28px var(--font-display);
		color: var(--fg-1);
	}

	.not-found p {
		margin: 0;
		font: 400 13px var(--font-sans);
		color: var(--fg-3);
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
		color: var(--fg-3);
		font: 500 13px var(--font-sans);
		text-decoration: none;
	}

	.back:hover {
		color: var(--fg-1);
	}

	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-5);
		margin-bottom: 26px;
	}

	.head-text {
		min-width: 0;
	}

	.tags {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.id {
		font: 500 11px var(--font-mono);
		color: var(--fg-4);
	}

	.id.light {
		font-weight: 400;
	}

	h1 {
		margin: 10px 0 0;
		font: 400 36px var(--font-display);
		letter-spacing: -0.02em;
		color: var(--ink-1);
	}

	.goal {
		margin: 8px 0 0;
		font: 400 14px var(--font-sans);
		color: var(--fg-3);
	}

	.scores {
		display: flex;
		flex-wrap: wrap;
		gap: 26px;
		padding: 18px 22px;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}

	.cap {
		margin-bottom: 7px;
		font: 600 10px var(--font-sans);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg-4);
	}

	.figure {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.figure span {
		font: 400 24px var(--font-display);
		color: var(--ink-0);
	}

	.figure small {
		font: 400 11px var(--font-mono);
		color: var(--fg-4);
	}

	.slider {
		width: 150px;
	}

	.target {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 0;
		border: none;
		background: transparent;
		color: var(--fg-3);
		cursor: pointer;
	}

	.target:hover {
		opacity: 0.7;
	}

	.figure-text {
		font: 400 24px var(--font-display);
		color: var(--ink-0);
	}

	.mono {
		margin-top: 10px;
		font: 400 11px var(--font-mono);
		color: var(--fg-3);
	}

	.error {
		margin: 0 0 var(--space-4);
		font: 500 13px var(--font-sans);
		color: var(--danger);
	}

	.blocked {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		margin-bottom: var(--space-5);
		padding: 10px 14px;
		border-radius: var(--radius-md);
		background: var(--danger-soft);
		color: var(--danger);
		font: 400 13px var(--font-sans);
	}

	.blocked span {
		color: var(--fg-2);
	}

	.list-title {
		margin-bottom: var(--space-3);
	}

	.reqs {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.req {
		overflow: hidden;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}

	.req-head {
		display: grid;
		grid-template-columns: 20px 1fr auto auto;
		gap: 14px;
		align-items: center;
		width: 100%;
		padding: 16px 20px;
		border: none;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}

	.caret {
		display: flex;
		color: var(--fg-4);
		transition: transform var(--dur-fast) var(--ease-out);
	}

	.caret.open {
		transform: rotate(90deg);
	}

	.req-main {
		min-width: 0;
	}

	.req-ids {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.req-title {
		display: block;
		margin-top: 5px;
		font: 600 15px var(--font-sans);
		color: var(--fg-1);
	}

	.req-body {
		padding: 18px 20px 20px 54px;
		background: var(--paper-1);
		border-top: 1px solid var(--line-1);
	}

	.req-body .eyebrow {
		margin-bottom: var(--space-2);
	}

	.plan {
		margin-bottom: 18px;
		padding: 14px 16px;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: 10px;
	}

	.plan-head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px;
	}

	.plan-title {
		font: 600 14px var(--font-sans);
		color: var(--fg-1);
	}

	.plan p {
		margin: 8px 0 0;
		max-width: 68ch;
		white-space: pre-wrap;
		font: 400 13px var(--font-sans);
		color: var(--fg-2);
	}

	.tasks {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.task {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: 11px 14px;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-md);
	}

	.task-title {
		font: 500 13px var(--font-sans);
		color: var(--fg-1);
	}

	.none {
		font: 400 13px var(--font-sans);
		color: var(--fg-3);
	}

	.no-plan {
		margin-top: var(--space-3);
		padding: 26px;
		border: 1px dashed var(--line-2);
		border-radius: 10px;
		background: var(--paper-0);
		text-align: center;
	}

	.no-plan p {
		margin: 4px 0 0;
		font: 400 13px var(--font-sans);
		color: var(--fg-3);
	}
</style>
