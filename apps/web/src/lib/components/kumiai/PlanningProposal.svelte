<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import { createLabel, draftCounts, type Draft } from '$lib/kumiai/planning.js';
	import type { ProjectPriority } from '$lib/kumiai/types.js';

	let {
		draft = $bindable(),
		version,
		goalTitle = '',
		creating = false,
		error = null,
		oncreate
	}: {
		/** The conversation's draft; edits here change it in place. */
		draft: Draft;
		version: number;
		/** The existing goal's name, when the draft adds projects to it. */
		goalTitle?: string;
		creating?: boolean;
		error?: string | null;
		oncreate: () => void;
	} = $props();

	const PRIORITIES: { value: ProjectPriority; label: string }[] = [
		{ value: 'urgent', label: 'Urgent' },
		{ value: 'high', label: 'High' },
		{ value: 'medium', label: 'Medium' },
		{ value: 'low', label: 'Low' }
	];

	const counts = $derived(draftCounts(draft));
	const canCreate = $derived(
		!creating && (counts.goal ? !!draft.goal?.value.title.trim() : counts.projects > 0)
	);
</script>

<section class="proposal" aria-label="Proposed roadmap">
	<header>
		<span class="eyebrow">Draft{version > 1 ? ` · revision ${version}` : ''}</span>
		<p>Review and edit it. Nothing is created until you press Create.</p>
	</header>

	{#if draft.goal}
		{@const goal = draft.goal}
		<div class="item goal" class:done={goal.createdId}>
			<div class="row">
				<span class="kind">Goal</span>
				{#if goal.createdId}<span class="created"><Check size={13} /> Created</span>{/if}
			</div>
			<input
				class="title"
				aria-label="Goal name"
				bind:value={goal.value.title}
				maxlength={200}
				disabled={!!goal.createdId}
			/>
			{#if goal.value.body}<p class="body">{goal.value.body}</p>{/if}
			<label class="inline">
				Priority
				<select bind:value={goal.value.priority} disabled={!!goal.createdId} aria-label="Goal priority">
					{#each [1, 2, 3, 4, 5] as level (level)}
						<option value={level}>P{level}{level === 1 ? ' · highest' : level === 5 ? ' · lowest' : ''}</option>
					{/each}
				</select>
			</label>
		</div>
	{:else if goalTitle}
		<div class="item goal existing">
			<span class="kind">Adds to</span>
			<span class="title-static">{goalTitle}</span>
		</div>
	{/if}

	{#if draft.projects.length}
		<ol class="projects">
			{#each draft.projects as project, i (i)}
				<li class="item" class:excluded={!project.include} class:done={project.createdId}>
					<div class="row">
						<label class="include">
							<input
								type="checkbox"
								bind:checked={project.include}
								disabled={!!project.createdId}
								aria-label="Include {project.value.title || `project ${i + 1}`}"
							/>
							<span class="kind">Project {i + 1}</span>
						</label>
						{#if project.createdId}<span class="created"><Check size={13} /> Created</span>{/if}
					</div>
					<input
						class="title"
						aria-label="Project {i + 1} name"
						bind:value={project.value.title}
						maxlength={200}
						disabled={!!project.createdId || !project.include}
					/>
					{#if project.value.body}<p class="body">{project.value.body}</p>{/if}
					<div class="fields">
						<label class="inline">
							Priority
							<select
								bind:value={project.value.priority}
								disabled={!!project.createdId || !project.include}
								aria-label="Project {i + 1} priority"
							>
								{#each PRIORITIES as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
							</select>
						</label>
						<label class="inline">
							Impact
							<input
								type="number"
								min="1"
								max="100"
								bind:value={project.value.impact}
								disabled={!!project.createdId || !project.include}
								aria-label="Project {i + 1} impact"
							/>
						</label>
						<label class="inline">
							Effort
							<input
								type="number"
								min="1"
								max="10"
								bind:value={project.value.effort}
								disabled={!!project.createdId || !project.include}
								aria-label="Project {i + 1} effort"
							/>
						</label>
					</div>
				</li>
			{/each}
		</ol>
	{/if}

	<footer>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<button type="button" class="k-btn k-btn-primary" disabled={!canCreate} onclick={oncreate}>
			{creating ? 'Creating…' : createLabel(draft)}
		</button>
	</footer>
</section>

<style>
	.proposal {
		margin: var(--space-2) 0;
		background: var(--paper-0);
		border: 1px solid var(--line-2);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
		overflow: hidden;
	}

	header {
		padding: 14px 16px 12px;
		background: var(--accent-soft);
		border-bottom: 1px solid var(--line-1);
	}

	.eyebrow {
		font: 600 11px var(--font-mono);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--accent);
	}

	header p {
		margin: 4px 0 0;
		font: 400 13px var(--font-sans);
		color: var(--fg-2);
	}

	.item {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--line-1);
	}

	.item.excluded {
		opacity: 0.5;
	}

	.item.done {
		background: var(--success-soft);
	}

	.goal .title {
		font: 400 19px var(--font-display);
	}

	.existing {
		flex-direction: row;
		align-items: baseline;
		gap: var(--space-3);
	}

	.title-static {
		font: 400 17px var(--font-display);
		color: var(--ink-1);
	}

	.projects {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.kind {
		font: 500 11px var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--fg-3);
	}

	.include {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		cursor: pointer;
	}

	.created {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font: 600 12px var(--font-sans);
		color: var(--success);
	}

	.title {
		width: 100%;
		padding: 4px 6px;
		margin-left: -6px;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		font: 600 14px var(--font-sans);
		color: var(--fg-1);
	}

	.title:hover:not(:disabled),
	.title:focus {
		border-color: var(--line-3);
		background: var(--paper-0);
		outline: none;
	}

	.body {
		margin: 0;
		font: 400 13px/1.5 var(--font-sans);
		color: var(--fg-2);
		white-space: pre-line;
	}

	.fields {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
	}

	.inline {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: 500 12px var(--font-sans);
		color: var(--fg-3);
	}

	select,
	input[type='number'] {
		padding: 3px 6px;
		border: 1px solid var(--line-2);
		border-radius: var(--radius-sm);
		background: var(--paper-0);
		font: 500 12px var(--font-sans);
		color: var(--fg-1);
	}

	input[type='number'] {
		width: 56px;
	}

	footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-3);
		padding: 12px 16px;
		background: var(--paper-1);
	}

	.error {
		flex: 1;
		margin: 0;
		font: 500 13px var(--font-sans);
		color: var(--danger);
	}
</style>
