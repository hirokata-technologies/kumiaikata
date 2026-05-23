<script lang="ts">
	import { Plus } from 'lucide-svelte';
	import type { BoardState, KataCard } from '$lib/types.js';
	import { newCardId, deepCloneColumns } from '$lib/data.js';
	import KanbanColumn from './KanbanColumn.svelte';

	let {
		state: boardState,
		density,
		query,
		columnStyle,
		showMist,
		glowCardIds,
		onCardOpen,
		onStateChange
	}: {
		state: BoardState;
		density: string;
		query: string;
		columnStyle: string;
		showMist: boolean;
		glowCardIds: Set<string>;
		onCardOpen: (id: string) => void;
		onStateChange: (newState: BoardState) => void;
	} = $props();

	let dragging: { cardId: string; fromColumnId: string } | null = $state(null);
	let addingCol = $state(false);
	let newColName = $state('');
	let newColInputRef: HTMLInputElement | null = $state(null);

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

	function onCardDrop(toColumnId: string) {
		if (!dragging) return;
		const { cardId, fromColumnId } = dragging;
		if (fromColumnId === toColumnId) return;

		const cols = deepCloneColumns(boardState.columns);
		const fromCol = cols.find(c => c.id === fromColumnId);
		const toCol = cols.find(c => c.id === toColumnId);
		if (!fromCol || !toCol) return;

		const cardIndex = fromCol.cards.findIndex(c => c.id === cardId);
		if (cardIndex === -1) return;

		const [card] = fromCol.cards.splice(cardIndex, 1);
		toCol.cards.unshift(card);

		onStateChange({ columns: cols });
		dragging = null;
	}

	function onAddCard(colId: string, title: string) {
		const cols = deepCloneColumns(boardState.columns);
		const col = cols.find(c => c.id === colId);
		if (!col) return;
		const card: KataCard = {
			id: newCardId(),
			title,
			desc: '',
			labels: [],
			assignee: 'me'
		};
		col.cards.unshift(card);
		onStateChange({ columns: cols });
	}

	function onRenameCol(colId: string, title: string) {
		const cols = deepCloneColumns(boardState.columns);
		const col = cols.find(c => c.id === colId);
		if (!col) return;
		col.title = title;
		onStateChange({ columns: cols });
	}

	function onAddColumn(title: string) {
		const t = title.trim();
		if (!t) return;
		const cols = deepCloneColumns(boardState.columns);
		cols.push({ id: `col-${Date.now()}`, title: t, cards: [] });
		onStateChange({ columns: cols });
		addingCol = false;
		newColName = '';
	}

	function startAddCol() {
		addingCol = true;
		newColName = '';
		setTimeout(() => newColInputRef?.focus(), 0);
	}
</script>

<div class="board-wrap">
	{#if showMist}
		<div class="board-mist" aria-hidden="true"></div>
	{/if}

	<div class="board">
		{#each boardState.columns as column (column.id)}
			<KanbanColumn
				{column}
				{density}
				{query}
				{columnStyle}
				{glowCardIds}
				{dragging}
				onCardOpen={onCardOpen}
				onCardDrop={onCardDrop}
				onAddCard={onAddCard}
				onRenameCol={onRenameCol}
			/>
		{/each}

		{#if addingCol}
			<div class="kcol-new-editing">
				<input
					type="text"
					bind:value={newColName}
					bind:this={newColInputRef}
					placeholder="Column name…"
					onkeydown={(e) => {
						if (e.key === 'Enter') { e.preventDefault(); onAddColumn(newColName); }
						if (e.key === 'Escape') { addingCol = false; }
					}}
					onblur={() => { if (newColName.trim()) onAddColumn(newColName); else addingCol = false; }}
				/>
			</div>
		{:else}
			<button class="kcol-new" onclick={startAddCol}>
				<Plus size={16} />
				Add column
			</button>
		{/if}
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

	.kcol-new {
		flex: 0 0 280px;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 14px 16px;
		background: transparent;
		border: 1px dashed var(--line-2);
		border-radius: 14px;
		color: var(--fg-3);
		font: 500 14px var(--font-sans);
		cursor: pointer;
		transition: all 140ms;
		height: 56px;
	}

	.kcol-new:hover {
		border-color: var(--line-3);
		color: var(--fg-1);
		background: rgba(20, 19, 15, 0.02);
	}

	.kcol-new-editing {
		padding: 8px 14px;
		border: 1px dashed var(--line-2);
		border-radius: 14px;
		flex: 0 0 280px;
		display: flex;
	}

	.kcol-new-editing input {
		width: 100%;
		border: none;
		outline: none;
		background: var(--paper-0);
		font: 500 16px var(--font-display);
		color: var(--fg-1);
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid var(--line-3);
	}
</style>
