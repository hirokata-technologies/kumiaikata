<script lang="ts">
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

</style>
