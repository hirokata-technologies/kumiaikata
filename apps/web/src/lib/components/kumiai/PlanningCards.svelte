<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Plus from '@lucide/svelte/icons/plus';
	import Target from '@lucide/svelte/icons/target';
	import FolderKanban from '@lucide/svelte/icons/folder-kanban';
	import Pill from './Pill.svelte';
	import ImpactBar from './ImpactBar.svelte';
	import EffortNotches from './EffortNotches.svelte';
	import { priorityLevelPill, projectPriorityPill } from '$lib/kumiai/index.js';
	import { displayId } from '$lib/kumiai/derive.js';
	import type { Draft, DraftTarget } from '$lib/kumiai/planning.js';

	let {
		draft,
		goalTitle = '',
		adding = null,
		error = null,
		onadd,
		onview
	}: {
		draft: Draft;
		/** The existing goal's name, when the draft adds projects to it. */
		goalTitle?: string;
		/** The card whose Add is in flight. */
		adding?: DraftTarget | null;
		error?: string | null;
		onadd: (target: DraftTarget) => void;
		onview: () => void;
	} = $props();

	const parent = $derived(draft.goal?.value.title || goalTitle);
	const goalReady = $derived(draft.goal ? !!draft.goal.createdId : !!draft.goalId);
</script>

<div class="cards">
	{#if draft.goal}
		{@const goal = draft.goal}
		<article class="card">
			<div class="top">
				<Target size={14} /> <span class="kind">Goal</span>
				<span class="grow"></span>
				<Pill variant="priority" pill={priorityLevelPill(goal.value.priority)} />
			</div>
			<h4>{goal.value.title}</h4>
			{#if goal.value.body}<p class="note">{goal.value.body}</p>{/if}
			{@render actions('goal', goal.createdId, 'Add goal', true)}
		</article>
	{/if}

	{#each draft.projects as project, i (i)}
		<article class="card">
			<div class="top">
				<FolderKanban size={14} /> <span class="kind">Project</span>
				<span class="grow"></span>
				<Pill variant="priority" pill={projectPriorityPill(project.value.priority)} />
			</div>
			<h4>{project.value.title}</h4>
			{#if project.value.body}<p class="note">{project.value.body}</p>{/if}
			<div class="meta">
				{#if parent}
					<div class="under">
						<span class="label">Under goal</span>
						<span class="goal-name">{parent}</span>
					</div>
				{/if}
				<div>
					<span class="label">Impact {project.value.impact}</span>
					<ImpactBar impact={project.value.impact} width={84} />
				</div>
				<div>
					<span class="label">Effort {project.value.effort}</span>
					<EffortNotches effort={project.value.effort} />
				</div>
			</div>
			{@render actions(i, project.createdId, 'Add project', goalReady)}
		</article>
	{/each}

	{#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

{#snippet actions(target: DraftTarget, createdId: string | null, label: string, ready: boolean)}
	<div class="actions">
		{#if createdId}
			<span class="ok"><Check size={15} /></span>
			<span class="added">Added as</span>
			<span class="id">{displayId(createdId)}</span>
			<span class="grow"></span>
			<button type="button" class="link" onclick={onview}>View in Goals &amp; Projects</button>
		{:else if ready}
			<button
				type="button"
				class="k-btn k-btn-primary"
				disabled={adding !== null}
				onclick={() => onadd(target)}
			>
				<Plus size={15} /> {adding === target ? 'Adding…' : label}
			</button>
		{:else}
			<button type="button" class="k-btn k-btn-secondary" disabled><Plus size={15} /> {label}</button>
			<span class="wait">Add its goal first</span>
		{/if}
	</div>
{/snippet}

<style>
	.cards {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-width: 560px;
	}

	.card {
		padding: 18px 20px;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}

	.top {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--fg-3);
	}

	.kind,
	.label {
		font: 600 10px var(--font-sans);
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.kind {
		font-size: 11px;
		letter-spacing: 0.12em;
	}

	.label {
		display: block;
		margin-bottom: 5px;
		color: var(--fg-4);
	}

	.grow {
		flex: 1;
	}

	h4 {
		margin: 10px 0 0;
		font: 600 16px var(--font-sans);
		color: var(--fg-1);
		text-wrap: pretty;
	}

	.note {
		margin: 4px 0 0;
		font: 400 13px/1.55 var(--font-sans);
		color: var(--fg-3);
		text-wrap: pretty;
		white-space: pre-line;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 12px 20px;
		margin-top: 14px;
	}

	.under {
		flex: 1 1 180px;
		min-width: 0;
	}

	.goal-name {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font: 500 13px var(--font-sans);
		color: var(--fg-2);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		margin-top: 16px;
		padding-top: 14px;
		border-top: 1px solid var(--line-1);
	}

	.ok {
		display: flex;
		color: var(--success);
	}

	.added {
		font: 500 13px var(--font-sans);
		color: var(--fg-1);
	}

	.id {
		font: 500 12px var(--font-mono);
		color: var(--fg-2);
	}

	.wait {
		font: 400 12px var(--font-sans);
		color: var(--fg-3);
	}

	.link {
		padding: 0;
		border: none;
		background: none;
		font: 500 13px var(--font-sans);
		color: var(--link);
		cursor: pointer;
	}

	.link:hover {
		color: var(--link-hover);
	}

	.error {
		margin: 0;
		font: 500 13px var(--font-sans);
		color: var(--danger);
	}
</style>
