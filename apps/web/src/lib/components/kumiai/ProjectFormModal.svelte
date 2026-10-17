<script lang="ts" module>
	import type { ProjectPriority } from '$lib/kumiai/types.js';

	export interface NewItemValues {
		title: string;
		priority: ProjectPriority;
		impact: number;
		effort: number;
	}
</script>

<script lang="ts">
	import ModalShell from './ModalShell.svelte';
	import FilterChips from './FilterChips.svelte';
	import BarSlider from './BarSlider.svelte';

	let {
		kind,
		goalTitle = '',
		busy = false,
		error = null,
		onsubmit,
		oncancel
	}: {
		kind: 'goal' | 'project';
		/** The goal a new project hangs off, named in the dialog's blurb. */
		goalTitle?: string;
		busy?: boolean;
		error?: string | null;
		onsubmit: (values: NewItemValues) => void;
		oncancel: () => void;
	} = $props();

	let title = $state('');
	let priority = $state<ProjectPriority>('medium');
	let impact = $state(50);
	let effort = $state(5);

	const isProject = $derived(kind === 'project');
	const canSubmit = $derived(title.trim().length > 0 && !busy);

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!canSubmit) return;
		onsubmit({ title: title.trim(), priority, impact, effort });
	}
</script>

<ModalShell label={isProject ? 'New project' : 'New goal'} onclose={oncancel}>
	<form onsubmit={submit}>
		<h2>{isProject ? 'New project' : 'New goal'}</h2>
		<p class="blurb">
			{isProject
				? `A named group of work under ${goalTitle}. It starts in the backlog.`
				: 'A high-level target. Projects hang off it.'}
		</p>

		<label for="new-item-title">{isProject ? 'Project name' : 'Goal name'}</label>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			id="new-item-title"
			bind:value={title}
			maxlength={200}
			autofocus
			placeholder={isProject
				? 'e.g. Ward handover summaries'
				: 'e.g. Clinical documentation without typing'}
		/>

		<div class="field-label">Priority</div>
		<FilterChips
			label="Priority"
			value={priority}
			options={[
				{ value: 'urgent', label: 'Urgent' },
				{ value: 'high', label: 'High' },
				{ value: 'medium', label: 'Medium' },
				{ value: 'low', label: 'Low' }
			]}
			onselect={(p) => (priority = p)}
		/>

		{#if isProject}
			<div class="field-row">
				<span class="field-label">Impact</span>
				<span class="value">{impact}</span>
			</div>
			<BarSlider
				kind="impact"
				label="Impact"
				value={impact}
				onchange={(v) => (impact = v)}
				oncommit={(v) => (impact = v)}
			/>
			<div class="field-row">
				<span class="field-label">Effort</span>
				<span class="value">{effort} / 10</span>
			</div>
			<BarSlider
				kind="effort"
				label="Effort"
				value={effort}
				onchange={(v) => (effort = v)}
				oncommit={(v) => (effort = v)}
			/>
		{/if}

		{#if error}<p class="error" role="alert">{error}</p>{/if}

		<div class="actions">
			<button type="button" class="k-btn k-btn-secondary" onclick={oncancel}>Cancel</button>
			<button type="submit" class="k-btn k-btn-primary" disabled={!canSubmit}>
				{busy ? 'Creating…' : isProject ? 'Create project' : 'Create goal'}
			</button>
		</div>
	</form>
</ModalShell>

<style>
	h2 {
		margin: 0;
		font: 400 28px var(--font-display);
		letter-spacing: -0.01em;
		color: var(--fg-1);
	}

	.blurb {
		margin: 6px 0 20px;
		font: 400 13px var(--font-sans);
		color: var(--fg-3);
	}

	label,
	.field-label {
		display: block;
		font: 500 13px var(--font-sans);
		color: var(--fg-2);
	}

	label {
		margin-bottom: 6px;
	}

	input {
		width: 100%;
		margin-bottom: 18px;
		padding: 10px 12px;
		border: 1px solid var(--line-3);
		border-radius: var(--radius-md);
		background: var(--paper-0);
		color: var(--fg-1);
		font: 400 14px var(--font-sans);
		outline: none;
	}

	input:focus-visible {
		border-color: var(--accent);
	}

	.field-label {
		margin-bottom: 8px;
	}

	.field-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin: 20px 0 8px;
	}

	.field-row .field-label {
		margin: 0;
	}

	.value {
		font: 400 18px var(--font-display);
		color: var(--ink-0);
	}

	.error {
		margin: 16px 0 0;
		font: 400 13px var(--font-sans);
		color: var(--danger);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 26px;
	}
</style>
