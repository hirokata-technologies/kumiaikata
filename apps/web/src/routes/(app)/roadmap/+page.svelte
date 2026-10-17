<script lang="ts">
	import type { PageProps } from './$types';
	import { invalidateAll } from '$app/navigation';
	import Plus from '@lucide/svelte/icons/plus';
	import PageHeader from '$lib/components/kumiai/PageHeader.svelte';
	import Pill from '$lib/components/kumiai/Pill.svelte';
	import LoadError from '$lib/components/kumiai/LoadError.svelte';
	import ProjectFormModal, {
		type NewItemValues
	} from '$lib/components/kumiai/ProjectFormModal.svelte';
	import { priorityLevelPill, projectPriorityPill, statusPill } from '$lib/kumiai/index.js';
	import { buildProjectViews, displayId, percent, reqLine } from '$lib/kumiai/derive.js';
	import { addGoal, addProject, errorMessage } from '$lib/kumiai/actions.js';
	import { formatTargetWindow } from '$lib/kumiai/target-window.js';

	let { data }: PageProps = $props();

	/** Which dialog is open: a new goal, or a new project under the goal with this id. */
	let dialog = $state<{ kind: 'goal' } | { kind: 'project'; goalId: string } | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);

	const views = $derived(buildProjectViews(data.workspace));
	const goals = $derived(
		data.workspace.goals.map((goal) => {
			const projects = views.filter((v) => v.project.goalId === goal.id);
			const total = projects.reduce((n, v) => n + v.reqsTotal, 0);
			const done = projects.reduce((n, v) => n + v.reqsDone, 0);
			return { goal, projects, total, done };
		})
	);
	const dialogGoal = $derived.by(() => {
		const open = dialog;
		return open?.kind === 'project'
			? data.workspace.goals.find((g) => g.id === open.goalId)
			: undefined;
	});

	async function create(values: NewItemValues) {
		if (!dialog) return;
		busy = true;
		error = null;
		try {
			if (dialog.kind === 'goal') {
				await addGoal(values.title, values.priority);
			} else {
				await addProject({
					goalId: dialog.goalId,
					title: values.title,
					status: 'backlog',
					priority: values.priority,
					impact: values.impact,
					effort: values.effort
				});
			}
			dialog = null;
			await invalidateAll();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Roadmap — Kata</title>
</svelte:head>

{#if data.failed}<LoadError />{/if}

<PageHeader
	eyebrow="Direction"
	title="Roadmap"
	sub="Goals, their projects, and how far the requirements under each have got."
>
	{#snippet actions()}
		<button
			type="button"
			class="k-btn k-btn-primary"
			onclick={() => {
				error = null;
				dialog = { kind: 'goal' };
			}}
		>
			<Plus size={15} /> New goal
		</button>
	{/snippet}
</PageHeader>

{#each goals as { goal, projects, total, done } (goal.id)}
	<section class="goal">
		<div class="goal-head">
			<div class="tags">
				<span class="id" title={goal.id}>{displayId(goal.id)}</span>
				<Pill variant="priority" pill={priorityLevelPill(goal.priority)} />
			</div>
			<h3>{goal.title}</h3>
			<div class="progress">
				<div class="bar"><div class="fill" style:width="{percent(done, total)}%"></div></div>
				<span class="mono">
					{done} of {total} requirements done · {projects.length}
					{projects.length === 1 ? 'project' : 'projects'}
				</span>
			</div>
		</div>

		{#each projects as view (view.project.id)}
			{@const p = view.project}
			<a class="project" href="/projects/{p.id}">
				<div class="project-title">
					<span class="id" title={p.id}>{displayId(p.id)}</span>
					<span class="name">{p.title}</span>
					<Pill variant="priority" pill={projectPriorityPill(p.priority)} />
				</div>
				<Pill pill={statusPill(p.status)} />
				<div class="project-progress">
					<div class="bar small">
						<div class="fill grey" style:width="{percent(view.reqsDone, view.reqsTotal)}%"></div>
					</div>
					<span class="id">{reqLine(view)}</span>
				</div>
				<span class="target">{p.targetWindow ? formatTargetWindow(p.targetWindow) : 'no target'}</span>
			</a>
		{:else}
			<div class="none">No projects under this goal yet.</div>
		{/each}

		<button
			type="button"
			class="add"
			onclick={() => {
				error = null;
				dialog = { kind: 'project', goalId: goal.id };
			}}
		>
			<Plus size={15} /> <span>Add a project to this goal</span>
		</button>
	</section>
{/each}

{#if goals.length === 0 && !data.failed}
	<p class="empty">No goals yet. Create the first one to start a roadmap.</p>
{/if}

{#if dialog}
	<ProjectFormModal
		kind={dialog.kind}
		goalTitle={dialogGoal?.title ?? ''}
		{busy}
		{error}
		onsubmit={create}
		oncancel={() => (dialog = null)}
	/>
{/if}

<style>
	.goal {
		margin-bottom: var(--space-6);
		overflow: hidden;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}

	.goal-head {
		padding: 20px 24px;
		border-bottom: 1px solid var(--line-1);
	}

	.tags {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.id {
		font: 500 11px var(--font-mono);
		color: var(--fg-4);
		white-space: nowrap;
	}

	h3 {
		margin: 8px 0 0;
		font: 400 28px var(--font-display);
		letter-spacing: -0.01em;
		color: var(--ink-1);
	}

	.progress {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		margin-top: 14px;
	}

	.bar {
		flex: 1;
		max-width: 420px;
		height: 6px;
		border-radius: var(--radius-pill);
		background: var(--paper-2);
		overflow: hidden;
	}

	.bar.small {
		height: 5px;
		max-width: none;
	}

	.fill {
		height: 100%;
		background: var(--ink-2);
	}

	.fill.grey {
		background: var(--ink-3);
	}

	.mono {
		font: 400 12px var(--font-mono);
		color: var(--fg-3);
	}

	.project {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px 18px;
		padding: 14px 24px;
		border-bottom: 1px solid var(--line-1);
		color: inherit;
		text-decoration: none;
	}

	.project:hover {
		background: var(--paper-1);
	}

	.project-title {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex: 1 1 260px;
		min-width: 0;
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font: 600 14px var(--font-sans);
		color: var(--fg-1);
	}

	.project-progress {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 0 1 160px;
		min-width: 120px;
	}

	.target {
		margin-left: auto;
		white-space: nowrap;
		font: 400 11px var(--font-mono);
		color: var(--fg-3);
	}

	.none {
		padding: 26px 24px;
		border-bottom: 1px solid var(--line-1);
		text-align: center;
		font: 400 13px var(--font-sans);
		color: var(--fg-3);
	}

	.add {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: 14px 24px;
		border: none;
		background: transparent;
		color: var(--fg-3);
		font: 500 13px var(--font-sans);
		text-align: left;
		cursor: pointer;
	}

	.add:hover {
		background: var(--paper-1);
		color: var(--ink-1);
	}

	.empty {
		font: 400 14px var(--font-sans);
		color: var(--fg-3);
	}
</style>
