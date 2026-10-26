<script lang="ts">
	import type { PageProps } from './$types';
	import { invalidateAll } from '$app/navigation';
	import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
	import PageHeader from '$lib/components/kumiai/PageHeader.svelte';
	import Pill from '$lib/components/kumiai/Pill.svelte';
	import EffortNotches from '$lib/components/kumiai/EffortNotches.svelte';
	import BlockedReasonModal from '$lib/components/kumiai/BlockedReasonModal.svelte';
	import LoadError from '$lib/components/kumiai/LoadError.svelte';
	import { projectPriorityPill } from '$lib/kumiai/index.js';
	import { buildProjectViews, displayId, reqLine } from '$lib/kumiai/derive.js';
	import { saveProject, statusPatch } from '$lib/kumiai/actions.js';
	import { formatTargetWindow } from '$lib/kumiai/target-window.js';
	import type { ProjectStatus } from '$lib/kumiai/types.js';

	let { data }: PageProps = $props();

	const COLUMNS: Array<{ key: ProjectStatus; label: string; dot: string; empty: string }> = [
		{ key: 'todo', label: 'To do', dot: 'var(--ink-5)', empty: 'Nothing queued' },
		{ key: 'in-progress', label: 'In progress', dot: 'var(--success)', empty: 'Nothing running' },
		{ key: 'blocked', label: 'Blocked', dot: 'var(--danger)', empty: 'Nothing blocked' },
		{ key: 'done', label: 'Done', dot: 'var(--ink-4)', empty: 'Nothing finished yet' }
	];

	let dragId = $state<string | null>(null);
	let dragOver = $state<ProjectStatus | null>(null);
	/** Moves made here but not yet reflected in `data`, so a dropped card lands at once. */
	let moved = $state<Record<string, ProjectStatus>>({});
	let askBlocked = $state<string | null>(null);
	let saving = $state(false);
	let error = $state<string | null>(null);

	const views = $derived(
		buildProjectViews(data.workspace).map((v) => ({
			...v,
			status: moved[v.project.id] ?? v.project.status
		}))
	);
	const askedView = $derived(views.find((v) => v.project.id === askBlocked));

	async function move(id: string, status: ProjectStatus, reason?: string) {
		const current = views.find((v) => v.project.id === id);
		if (!current || current.status === status) return;
		if (status === 'blocked' && !reason) {
			askBlocked = id;
			return;
		}
		saving = true;
		error = null;
		moved[id] = status;
		const failure = await saveProject(id, statusPatch(status, reason));
		if (failure) error = failure;
		await invalidateAll();
		delete moved[id];
		saving = false;
	}

	function drop(e: DragEvent, status: ProjectStatus) {
		e.preventDefault();
		const id = dragId;
		dragId = null;
		dragOver = null;
		if (id) void move(id, status);
	}
</script>

<svelte:head>
	<title>In progress — Kata</title>
</svelte:head>

{#if data.failed}<LoadError />{/if}

<PageHeader
	eyebrow="Execution"
	title="In progress"
	sub="Drag a project between columns to move it. The backlog has its own view."
/>

{#if error}<p class="error" role="alert">{error}</p>{/if}

<div class="board">
	{#each COLUMNS as col (col.key)}
		{@const cards = views.filter((v) => v.status === col.key)}
		<section
			class="column"
			class:is-over={dragOver === col.key}
			aria-label={col.label}
			ondragover={(e) => {
				e.preventDefault();
				dragOver = col.key;
			}}
			ondragleave={() => {
				if (dragOver === col.key) dragOver = null;
			}}
			ondrop={(e) => drop(e, col.key)}
		>
			<div class="col-head">
				<span class="dot" style:background={col.dot}></span>
				<span class="col-label">{col.label}</span>
				<span class="col-count">{cards.length}</span>
			</div>
			<div class="col-cards">
				{#each cards as view (view.project.id)}
					{@const p = view.project}
					<a
						class="card"
						class:is-dragging={dragId === p.id}
						href="/projects/{p.id}"
						draggable="true"
						ondragstart={(e) => {
							if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
							dragId = p.id;
						}}
						ondragend={() => {
							dragId = null;
							dragOver = null;
						}}
					>
						<div class="top">
							<span class="id" title={p.id}>{displayId(p.id)}</span>
							<Pill variant="priority" pill={projectPriorityPill(p.priority)} />
						</div>
						<div class="title">{p.title}</div>
						<div class="goal">{view.goal?.title ?? ''}</div>
						{#if view.status === 'blocked' && p.blockedReason}
							<div class="note">
								<AlertTriangle size={13} />
								<span>{p.blockedReason}</span>
							</div>
						{/if}
						<div class="scores">
							<EffortNotches effort={p.effort} width={4} height={10} />
						</div>
						<div class="foot">
							<span>{reqLine(view)}</span>
							<span>{p.targetWindow ? formatTargetWindow(p.targetWindow) : 'no target'}</span>
						</div>
					</a>
				{/each}
				{#if cards.length === 0}
					<div class="col-empty">{col.empty}</div>
				{/if}
			</div>
		</section>
	{/each}
</div>

{#if askedView}
	<BlockedReasonModal
		projectTitle={askedView.project.title}
		busy={saving}
		oncancel={() => (askBlocked = null)}
		onsubmit={(reason) => {
			const id = askBlocked;
			askBlocked = null;
			if (id) void move(id, 'blocked', reason);
		}}
	/>
{/if}

<style>
	.error {
		margin: 0 0 var(--space-4);
		font: 500 13px var(--font-sans);
		color: var(--danger);
	}

	.board {
		display: grid;
		grid-template-columns: repeat(4, minmax(240px, 1fr));
		gap: var(--space-4);
		align-items: start;
		overflow-x: auto;
	}

	/* Phones: one column per screen, swiped sideways. */
	@media (max-width: 768px) {
		.board {
			grid-template-columns: repeat(4, 82vw);
			gap: var(--space-3);
			overflow-x: auto;
			scroll-snap-type: x mandatory;
			margin: 0 calc(-1 * var(--space-4));
			padding: 0 var(--space-4) var(--space-2);
			scroll-padding: 0 var(--space-4);
		}

		.column {
			scroll-snap-align: start;
		}
	}

	.column {
		min-height: 320px;
		padding: var(--space-3);
		background: var(--paper-1);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-lg);
	}

	.column.is-over {
		background: var(--paper-2);
		border-color: var(--line-3);
	}

	.col-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 2px 6px 12px;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	.col-label {
		font: 600 13px var(--font-sans);
		color: var(--fg-1);
	}

	.col-count {
		font: 500 12px var(--font-mono);
		color: var(--fg-4);
	}

	.col-cards {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.card {
		display: block;
		padding: 14px;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: 10px;
		box-shadow: var(--shadow-sm);
		color: inherit;
		text-decoration: none;
		cursor: grab;
	}

	.card:hover {
		box-shadow: var(--shadow-md);
	}

	.card.is-dragging {
		opacity: 0.4;
	}

	.top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.id,
	.foot {
		font: 400 11px var(--font-mono);
		color: var(--fg-4);
	}

	.id {
		font-weight: 500;
	}

	.title {
		margin-top: 9px;
		font: 600 14px var(--font-sans);
		color: var(--fg-1);
		text-wrap: pretty;
	}

	.goal {
		margin-top: 4px;
		font: 400 12px var(--font-sans);
		color: var(--fg-3);
	}

	.note {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		margin-top: 10px;
		padding: 8px 10px;
		border-radius: var(--radius-md);
		background: var(--danger-soft);
		color: var(--danger);
		font: 400 12px var(--font-sans);
	}

	.note span {
		color: var(--fg-2);
		text-wrap: pretty;
	}

	.scores {
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid var(--line-1);
	}

	.foot {
		display: flex;
		justify-content: space-between;
		margin-top: 9px;
	}

	.col-empty {
		padding: 20px;
		border: 1px dashed var(--line-2);
		border-radius: 10px;
		text-align: center;
		font: 400 12px var(--font-sans);
		color: var(--fg-4);
	}
</style>
