<script lang="ts">
	import { Plus } from 'lucide-svelte';
	import type { KataCard, KataColumn } from '$lib/types.js';
	import KanbanCard from './KanbanCard.svelte';

	let {
		column,
		density,
		query,
		columnStyle,
		glowCardIds,
		dragging,
		onCardOpen,
		onCardDrop,
		onAddCard,
		onRenameCol
	}: {
		column: KataColumn;
		density: string;
		query: string;
		columnStyle: string;
		glowCardIds: Set<string>;
		dragging: { cardId: string; fromColumnId: string } | null;
		onCardOpen: (id: string) => void;
		onCardDrop: (toColId: string) => void;
		onAddCard: (colId: string, title: string) => void;
		onRenameCol: (colId: string, title: string) => void;
	} = $props();

	let over = $state(false);
	let drafting = $state(false);
	let editing = $state(false);
	let draft = $state('');
	let draftName = $state('');

	let sectionRef: HTMLElement;
	let renameInputRef: HTMLInputElement | null = $state(null);
	let draftTextareaRef: HTMLTextAreaElement | null = $state(null);

	function startDrafting() {
		drafting = true;
		draft = '';
		// Focus textarea after DOM update
		setTimeout(() => draftTextareaRef?.focus(), 0);
	}

	function commitDraft() {
		const t = draft.trim();
		if (t) {
			onAddCard(column.id, t);
		}
		drafting = false;
		draft = '';
	}

	function cancelDraft() {
		drafting = false;
		draft = '';
	}

	function startEditing() {
		editing = true;
		draftName = column.title; // eslint-disable-line
		setTimeout(() => {
			renameInputRef?.focus();
			renameInputRef?.select();
		}, 0);
	}

	function commitRename() {
		const t = draftName.trim();
		if (t && t !== column.title) {
			onRenameCol(column.id, t);
		}
		editing = false;
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		over = true;
	}

	function handleDragLeave(e: DragEvent) {
		// Only set over=false if leaving the section entirely
		if (!sectionRef.contains(e.relatedTarget as Node)) {
			over = false;
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		over = false;
		onCardDrop(column.id);
	}
</script>

<section
	class="kcol"
	class:kcol-flat={columnStyle === 'flat'}
	class:is-over={over}
	bind:this={sectionRef}
>
	<div class="kcol-head">
		<div class="kcol-head-l">
			{#if editing}
				<input
					class="kcol-rename"
					type="text"
					bind:value={draftName}
					bind:this={renameInputRef}
					onblur={commitRename}
					onkeydown={(e) => {
						if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
						if (e.key === 'Escape') { editing = false; }
					}}
				/>
			{:else}
				<button class="kcol-title" onclick={startEditing} type="button">
					{column.title}
				</button>
			{/if}
			<span class="kcol-count">{column.cards.length}</span>
		</div>
		<button class="kcol-add" onclick={startDrafting} aria-label="Add card">
			<Plus size={16} />
		</button>
	</div>

	<div
		class="kcol-body"
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
		role="list"
		aria-label="{column.title} cards"
	>
		{#each column.cards as card (card.id)}
			<KanbanCard
				{card}
				columnId={column.id}
				{density}
				{query}
				dragging={dragging?.cardId === card.id}
				glow={glowCardIds.has(card.id)}
				{columnStyle}
				onopen={onCardOpen}
				ondragstart={(e, c, colId) => {
					window.dispatchEvent(new CustomEvent('hk-drag-start', { detail: { cardId: c.id, fromColumnId: colId } }));
				}}
				ondragend={() => {
					window.dispatchEvent(new CustomEvent('hk-drag-end'));
				}}
			/>
		{/each}

		{#if drafting}
			<div class="kc-draft">
				<textarea
					bind:value={draft}
					bind:this={draftTextareaRef}
					placeholder="Card title…"
					rows={2}
					onkeydown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitDraft(); }
						if (e.key === 'Escape') cancelDraft();
					}}
				></textarea>
				<div class="kc-draft-hint">⏎ to add · Esc to cancel</div>
			</div>
		{:else if column.cards.length === 0}
			<button class="kcol-empty" onclick={startDrafting}>
				<Plus size={14} />
				Add a card
			</button>
		{:else}
			<button class="kcol-addmore" onclick={startDrafting}>
				<Plus size={14} />
				Add card
			</button>
		{/if}
	</div>
</section>

<style>
	.kcol {
		flex: 0 0 320px;
		display: flex;
		flex-direction: column;
		max-height: 100%;
		background: var(--paper-2);
		border: 1px solid var(--line-1);
		border-radius: 14px;
		box-shadow: var(--shadow-sm);
		transition: border-color 140ms, background 140ms;
	}

	.kcol.is-over {
		border-color: var(--accent);
		background: var(--accent-soft);
	}

	.kcol-flat {
		background: transparent;
		border-color: transparent;
		box-shadow: none;
		flex-basis: 300px;
	}

	.kcol-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px 10px;
	}

	.kcol-head-l {
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex: 1;
		min-width: 0;
	}

	.kcol-title {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 500;
		font-size: 18px;
		color: var(--fg-1);
		letter-spacing: -0.01em;
		cursor: text;
		border-radius: 4px;
		padding: 1px 3px;
		margin-left: -3px;
		background: transparent;
		border: none;
		text-align: left;
	}

	.kcol-title:hover {
		background: rgba(20, 19, 15, 0.04);
	}

	.kcol-rename {
		font-family: var(--font-display);
		font-weight: 500;
		font-size: 18px;
		color: var(--fg-1);
		background: var(--paper-0);
		border: 1px solid var(--line-3);
		border-radius: 6px;
		padding: 1px 4px;
		width: 100%;
		outline: none;
	}

	.kcol-count {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--fg-3);
		background: var(--paper-3);
		padding: 1px 7px;
		border-radius: 999px;
	}

	.kcol-flat .kcol-count {
		background: var(--paper-2);
	}

	.kcol-add {
		width: 28px;
		height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		border-radius: 6px;
		color: var(--fg-3);
		cursor: pointer;
		transition: all 140ms;
	}

	.kcol-add:hover {
		background: var(--paper-3);
		color: var(--fg-1);
	}

	.kcol-body {
		flex: 1;
		overflow-y: auto;
		padding: 4px 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.kcol-body::-webkit-scrollbar {
		width: 6px;
	}

	.kcol-body::-webkit-scrollbar-thumb {
		background: var(--line-2);
		border-radius: 999px;
	}

	.kcol-empty {
		flex: 1;
		min-height: 80px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border: 1px dashed var(--line-2);
		background: transparent;
		border-radius: 10px;
		color: var(--fg-3);
		font: 500 13px var(--font-sans);
		cursor: pointer;
		transition: all 140ms;
	}

	.kcol-empty:hover {
		border-color: var(--line-3);
		color: var(--fg-1);
		background: rgba(20, 19, 15, 0.02);
	}

	.kcol-addmore {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 10px;
		background: transparent;
		border: none;
		border-radius: 6px;
		color: var(--fg-3);
		font: 500 13px var(--font-sans);
		cursor: pointer;
		text-align: left;
		margin-top: 2px;
		transition: all 140ms;
	}

	.kcol-addmore:hover {
		background: var(--paper-3);
		color: var(--fg-1);
	}

	.kc-draft {
		background: var(--paper-0);
		border: 1px solid var(--line-3);
		border-radius: 10px;
		padding: 10px 12px;
		box-shadow: var(--shadow-sm);
	}

	.kc-draft textarea {
		width: 100%;
		border: none;
		outline: none;
		resize: none;
		font: 500 14px/1.4 var(--font-sans);
		background: transparent;
		color: var(--fg-1);
		min-height: 48px;
	}

	.kc-draft-hint {
		font: 400 11px var(--font-mono);
		color: var(--fg-3);
		margin-top: 4px;
	}
</style>
