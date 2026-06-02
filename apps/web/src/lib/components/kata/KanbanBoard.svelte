<script lang="ts">
	import { Filter } from '@lucide/svelte';
	import type { BoardState, KataCard, KataLabel, KataProject, DisplayColumn, GroupBy, MemberInfo } from '$lib/types.js';
	import { deepCloneColumns } from '$lib/data.js';
	import {
		createCard,
		moveCard,
		reorderCards,
		updateCard,
		markClientOp,
		ApiError,
	} from '$lib/api';
	import KanbanColumn from './KanbanColumn.svelte';

	let {
		boardId,
		state: boardState,
		density,
		query,
		columnStyle,
		showMist,
		glowCardIds,
		boardLabels,
		boardProjects,
		boardMembers,
		groupBy = 'status',
		activeProjectId = null,
		onCardOpen,
		onStateChange,
		onclearfilter = () => {},
	}: {
		boardId: string;
		state: BoardState;
		density: string;
		query: string;
		columnStyle: string;
		showMist: boolean;
		glowCardIds: Set<string>;
		boardLabels: KataLabel[];
		boardProjects: KataProject[];
		boardMembers: MemberInfo[];
		groupBy?: GroupBy;
		activeProjectId?: string | null;
		onCardOpen: (id: string) => void;
		onStateChange: (newState: BoardState) => void;
		onclearfilter?: () => void;
	} = $props();

	let dragging: { cardId: string; fromColumnId: string } | null = $state(null);
	let mutationError: string | null = $state(null);

	$effect(() => {
		function onDragStart(e: Event) {
			const ce = e as CustomEvent<{ cardId: string; fromColumnId: string }>;
			dragging = { cardId: ce.detail.cardId, fromColumnId: ce.detail.fromColumnId };
		}
		function onDragEnd() {
			dragging = null;
		}
		window.addEventListener('hk-drag-start', onDragStart);
		window.addEventListener('hk-drag-end', onDragEnd);
		return () => {
			window.removeEventListener('hk-drag-start', onDragStart);
			window.removeEventListener('hk-drag-end', onDragEnd);
		};
	});

	/** Maps card id → status column id (always uses real boardState columns, not virtual) */
	const statusLookup = $derived(
		new Map(boardState.columns.flatMap(col => col.cards.map(card => [card.id, col.id] as [string, string])))
	);

	/** Maps status column id → column title */
	const statusTitles = $derived(
		new Map(boardState.columns.map(col => [col.id, col.title] as [string, string]))
	);

	/** Columns as displayed — varies by groupBy + activeProjectId */
	const displayColumns = $derived.by((): DisplayColumn[] => {
		if (groupBy === 'project') {
			const allCards = boardState.columns.flatMap(c => c.cards);

			const cols: DisplayColumn[] = boardState.projects.map(p => {
				const cards = allCards.filter(c => c.projectId === p.id);
				const done = cards.filter(c => statusLookup.get(c.id) === 'done').length;
				return {
					id: `proj-${p.id}`,
					title: p.name,
					cards,
					projectId: p.id,
					isOrphan: false,
					project: p,
					activeCount: cards.length - done,
					doneCount: done,
				};
			});

			// "No project" bucket
			const orphans = allCards.filter(c => !c.projectId);
			if (orphans.length > 0) {
				const done = orphans.filter(c => statusLookup.get(c.id) === 'done').length;
				cols.push({
					id: 'proj-__none',
					title: 'No project',
					cards: orphans,
					projectId: '__none',
					isOrphan: true,
					project: null,
					activeCount: orphans.length - done,
					doneCount: done,
				});
			}

			if (activeProjectId) {
				return cols.filter(c => c.projectId === activeProjectId);
			}
			return cols;
		}

		// Status mode — optionally filtered by project
		const filtered = activeProjectId
			? boardState.columns.map(c => ({
					...c,
					cards: activeProjectId === '__none'
						? c.cards.filter(card => !card.projectId)
						: c.cards.filter(card => card.projectId === activeProjectId),
				}))
			: boardState.columns;

		return filtered.map(c => ({ ...c, projectId: undefined }));
	});

	/** Active project name for the filter banner */
	const activeProjectName = $derived.by(() => {
		if (!activeProjectId) return null;
		if (activeProjectId === '__none') return 'unassigned';
		return boardState.projects.find(p => p.id === activeProjectId)?.name ?? null;
	});

	async function onCardDrop(toColId: string, dropIndex: number) {
		if (!dragging) return;
		const { cardId, fromColumnId } = dragging;
		dragging = null;

		// ── Project-group mode: drag changes the card's project ──────────
		if (groupBy === 'project') {
			const targetPid = toColId.startsWith('proj-') ? toColId.slice(5) : null;
			const normalizedTarget = targetPid === '__none' ? null : targetPid;

			const card = boardState.columns.flatMap(c => c.cards).find(c => c.id === cardId);
			if (!card) return;
			const currentProject = card.projectId ?? null;
			if (currentProject === normalizedTarget) return;

			const previous = boardState;
			const newCols = deepCloneColumns(boardState.columns).map(c => ({
				...c,
				cards: c.cards.map(x =>
					x.id === cardId ? { ...x, projectId: normalizedTarget } : x
				),
			}));
			onStateChange({ ...boardState, columns: newCols });

			mutationError = null;
			try {
				markClientOp(`update:${cardId}`);
				await updateCard(boardId, cardId, { projectId: normalizedTarget });
			} catch (err) {
				onStateChange(previous);
				mutationError = err instanceof ApiError ? err.message : 'Failed to update project';
				console.warn('[KanbanBoard] project drop error:', err);
			}
			return;
		}

		// ── Status mode: drag moves card between status columns ───────────
		const cols = boardState.columns;
		const fromCol = cols.find(c => c.id === fromColumnId);
		const toCol = cols.find(c => c.id === toColId);
		if (!fromCol || !toCol) return;

		const fromIdx = fromCol.cards.findIndex(c => c.id === cardId);
		if (fromIdx === -1) return;

		const sameColumn = fromColumnId === toColId;
		let targetIdx = dropIndex;
		if (sameColumn && targetIdx > fromIdx) targetIdx -= 1;
		if (sameColumn && targetIdx === fromIdx) return;

		const previous = boardState;
		const newCols = deepCloneColumns(cols);
		const newFrom = newCols.find(c => c.id === fromColumnId)!;
		const newTo = newCols.find(c => c.id === toColId)!;
		const [card] = newFrom.cards.splice(fromIdx, 1);
		newTo.cards.splice(targetIdx, 0, card!);
		onStateChange({ ...boardState, columns: newCols });

		mutationError = null;
		try {
			markClientOp(`move:${cardId}`);
			if (sameColumn) {
				await reorderCards(boardId, toColId, newTo.cards.map(c => c.id));
			} else {
				await moveCard(boardId, cardId, toColId, targetIdx);
			}
		} catch (err) {
			onStateChange(previous);
			mutationError = err instanceof ApiError ? err.message : 'Failed to move card';
			console.warn('[KanbanBoard] onCardDrop error:', err);
		}
	}

	async function onAddCard(colId: string, title: string) {
		// In project mode, derive the status column (default to 'todo') and project from the virtual column
		let statusColId = colId;
		let projectId: string | null | undefined;

		if (groupBy === 'project') {
			const virtualCol = displayColumns.find(c => c.id === colId);
			projectId = virtualCol?.projectId === '__none' ? null : virtualCol?.projectId;
			// Add to the first status column (backlog) if it exists, else first column
			statusColId = boardState.columns[0]?.id ?? colId;
		}

		const previous = boardState;
		const tempId = `temp-${crypto.randomUUID()}`;
		const newCols = deepCloneColumns(boardState.columns);
		const col = newCols.find(c => c.id === statusColId);
		if (!col) return;
		const tempCard: KataCard = { id: tempId, title, desc: '', labels: [], assignees: [], projectId };
		col.cards.push(tempCard);
		onStateChange({ ...boardState, columns: newCols });

		mutationError = null;
		try {
			const created = await createCard(boardId, statusColId, title);
			markClientOp(`create:${created.id}`);
			const finalCols = deepCloneColumns(boardState.columns);
			const finalCol = finalCols.find(c => c.id === statusColId);
			if (finalCol) {
				const tempIdx = finalCol.cards.findIndex(c => c.id === tempId);
				const realIdx = finalCol.cards.findIndex(c => c.id === created.id);
				if (tempIdx !== -1) {
					if (realIdx !== -1) {
						// SSE already added the real card before we resolved — drop the temp
						finalCol.cards.splice(tempIdx, 1);
					} else {
						finalCol.cards[tempIdx] = { ...finalCol.cards[tempIdx]!, id: created.id };
					}
					onStateChange({ ...boardState, columns: finalCols });
				}
			}
		} catch (err) {
			onStateChange(previous);
			mutationError = err instanceof ApiError ? err.message : 'Failed to add card';
			console.warn('[KanbanBoard] onAddCard error:', err);
		}
	}
</script>

<div class="board-wrap">
	{#if showMist}
		<div class="board-mist" aria-hidden="true"></div>
	{/if}

	{#if mutationError}
		<div class="board-error" role="alert">
			{mutationError}
			<button class="board-error-close" onclick={() => (mutationError = null)} aria-label="Dismiss error">×</button>
		</div>
	{/if}

	<!-- Filter banner: shown when a project filter is active in status-group mode -->
	{#if activeProjectId && groupBy === 'status'}
		<div class="board-filter-banner">
			<span class="board-filter-icon">
				<Filter size={13} />
			</span>
			<span>Showing only <strong>{activeProjectName}</strong></span>
			<button class="board-filter-clear" onclick={onclearfilter}>Clear</button>
		</div>
	{/if}

	<div class="board" class:board-project={groupBy === 'project'}>
		{#each displayColumns as column (column.id)}
			<KanbanColumn
				{column}
				{density}
				{query}
				{columnStyle}
				{glowCardIds}
				{dragging}
				{boardLabels}
				{boardProjects}
				{boardMembers}
				statusLookup={groupBy === 'project' ? statusLookup : undefined}
				statusTitles={groupBy === 'project' ? statusTitles : undefined}
				onCardOpen={onCardOpen}
				onCardDrop={onCardDrop}
				onAddCard={onAddCard}
			/>
		{/each}
	</div>
</div>

<style>
	.board-wrap {
		flex: 1;
		min-width: 0;
		position: relative;
		overflow: hidden;
		background: var(--paper-1);
	}

	.board {
		position: relative;
		z-index: 1;
		display: flex;
		gap: 14px;
		padding: 22px 24px 36px;
		height: 100%;
		overflow-x: auto;
		overflow-y: hidden;
		align-items: flex-start;
	}

	.board-project {
		gap: 16px;
	}

	.board-mist {
		position: absolute;
		inset: 0;
		background-image: url('/mist.svg');
		background-repeat: repeat-x;
		background-position: center 60%;
		background-size: 1100px auto;
		opacity: 0.055;
		pointer-events: none;
	}

	:global([data-theme="dark"]) .board-mist {
		opacity: 0.045;
		filter: invert(1);
	}

	/* Filter banner */
	.board-filter-banner {
		position: absolute;
		top: 14px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 3;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 6px 6px 12px;
		background: var(--paper-0);
		border: 1px solid var(--line-2);
		border-radius: 999px;
		box-shadow: var(--shadow-sm);
		font: 500 12px var(--font-sans);
		color: var(--fg-2);
		letter-spacing: -0.005em;
		white-space: nowrap;
	}

	.board-filter-banner :global(strong) {
		color: var(--fg-1);
		font-weight: 600;
	}

	.board-filter-icon {
		display: inline-flex;
		width: 18px;
		height: 18px;
		align-items: center;
		justify-content: center;
		color: var(--accent);
	}

	.board-filter-clear {
		font: 500 11.5px var(--font-sans);
		color: var(--fg-3);
		background: var(--paper-2);
		border: none;
		padding: 4px 10px;
		border-radius: 999px;
		cursor: pointer;
		transition: all 140ms;
	}

	.board-filter-clear:hover {
		background: var(--paper-3);
		color: var(--fg-1);
	}

	/* Error toast */
	.board-error {
		position: absolute;
		top: 12px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 10px;
		background: #fff0ee;
		border: 1px solid rgba(155, 59, 46, 0.3);
		color: #9B3B2E;
		font: 500 13px var(--font-sans);
		padding: 8px 14px;
		border-radius: 8px;
		box-shadow: var(--shadow-sm);
		max-width: 480px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.board-error-close {
		background: transparent;
		border: none;
		cursor: pointer;
		color: inherit;
		font-size: 16px;
		line-height: 1;
		padding: 0 2px;
		flex-shrink: 0;
	}
</style>
