<script lang="ts">
	import Pill from './Pill.svelte';
	import ImpactBar from './ImpactBar.svelte';
	import EffortNotches from './EffortNotches.svelte';
	import { projectPriorityPill, statusPill } from '$lib/kumiai/index.js';
	import { formatTargetWindow } from '$lib/kumiai/target-window.js';
	import { displayId, reqLine, type ProjectView } from '$lib/kumiai/derive.js';

	let { view }: { view: ProjectView } = $props();

	const project = $derived(view.project);
</script>

<a class="card" href="/projects/{project.id}">
	<div class="top">
		<span class="id" title={project.id}>{displayId(project.id)}</span>
		<Pill variant="priority" pill={projectPriorityPill(project.priority)} />
	</div>
	<div class="title">{project.title}</div>
	<div class="meta">
		<Pill pill={statusPill(project.status)} />
		<span class="mono">{reqLine(view)}</span>
		{#if project.targetWindow}
			<span class="mono target">{formatTargetWindow(project.targetWindow)}</span>
		{/if}
	</div>
	<div class="scores">
		<div>
			<div class="cap">Impact {project.impact}</div>
			<ImpactBar impact={project.impact} width={84} />
		</div>
		<div>
			<div class="cap">Effort {project.effort}</div>
			<EffortNotches effort={project.effort} />
		</div>
	</div>
</a>

<style>
	.card {
		display: block;
		padding: 18px;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
		color: inherit;
		text-decoration: none;
		transition: box-shadow var(--dur-base) var(--ease-out);
	}

	.card:hover {
		box-shadow: var(--shadow-md);
	}

	.top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
	}

	.id {
		font: 500 11px var(--font-mono);
		color: var(--fg-4);
	}

	.title {
		margin-top: 10px;
		font: 600 15px var(--font-sans);
		color: var(--fg-1);
		text-wrap: pretty;
	}

	.meta {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: 12px;
	}

	.mono {
		font: 400 12px var(--font-mono);
		color: var(--fg-3);
	}

	.target {
		margin-left: auto;
	}

	.scores {
		display: flex;
		align-items: flex-end;
		gap: 14px;
		margin-top: 14px;
		padding-top: 14px;
		border-top: 1px solid var(--line-1);
	}

	.cap {
		margin-bottom: 5px;
		font: 600 10px var(--font-sans);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg-4);
	}
</style>
