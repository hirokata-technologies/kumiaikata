<script lang="ts">
	import { Plus, FolderMinus } from '@lucide/svelte';
	import type { DisplayColumn, KataLabel, KataProject, MemberInfo } from '$lib/types.js';
	import KanbanCard from './KanbanCard.svelte';

	let {
		column,
		density,
		query,
		columnStyle,
		glowCardIds,
		dragging,
		boardLabels,
		boardProjects,
		boardMembers,
		/** In project-group mode: maps card id → status column id */
		statusLookup,
		/** In project-group mode: maps status column id → column title */
		statusTitles,
		onCardOpen,
		onCardDrop,
		onAddCard,
	}: {
		column: DisplayColumn;
		density: string;
		query: string;
		columnStyle: string;
		glowCardIds: Set<string>;
		dragging: { cardId: string; fromColumnId: string } | null;
		boardLabels: KataLabel[];
		boardProjects: KataProject[];
		boardMembers: MemberInfo[];
		statusLookup?: Map<string, string>;
		statusTitles?: Map<string, string>;
		onCardOpen: (id: string) => void;
		onCardDrop: (toColId: string, dropIndex: number) => void;
		onAddCard: (colId: string, title: string) => void;
	} = $props();

	let over = $state(false);
	let drafting = $state(false);
	let draft = $state('');

	let sectionRef: HTMLElement;
	let draftTextareaRef: HTMLTextAreaElement | null = $state(null);

	const isProjectMode = $derived(column.projectId !== undefined);

	function startDrafting() {
		drafting = true;
		draft = '';
		setTimeout(() => draftTextareaRef?.focus(), 0);
	}

	function commitDraft() {
		const t = draft.trim();
		if (t) onAddCard(column.id, t);
		drafting = false;
		draft = '';
	}

	function cancelDraft() {
		drafting = false;
		draft = '';
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		over = true;
	}

	function handleDragLeave(e: DragEvent) {
		if (!sectionRef.contains(e.relatedTarget as Node)) {
			over = false;
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		over = false;
		const bodyEl = sectionRef.querySelector('.kcol-body') as HTMLElement | null;
		let dropIndex = column.cards.length;
		if (bodyEl) {
			const children = Array.from(bodyEl.querySelectorAll('.kc')) as HTMLElement[];
			for (let i = 0; i < children.length; i++) {
				const rect = children[i]!.getBoundingClientRect();
				if (e.clientY < rect.top + rect.height / 2) {
					dropIndex = i;
					break;
				}
			}
		}
		onCardDrop(column.id, dropIndex);
	}
</script>

<section
	class="kcol"
	class:kcol-flat={columnStyle === 'flat'}
	class:is-over={over}
	class:kcol-project={isProjectMode}
	class:kcol-orphan={column.isOrphan}
	style={isProjectMode && column.project ? `--pc: ${column.project.color}` : undefined}
	bind:this={sectionRef}
>
	{#if isProjectMode}
		<!-- Project-mode column header -->
		<div class="kcol-head kcol-head-project">
			<div class="kcol-head-l">
				<div class="kproj-icon" class:kproj-icon-orphan={column.isOrphan}>
					{#if column.isOrphan}
						<FolderMinus size={18} />
					{:else}
						<!-- Coloured block — API doesn't carry per-project icons -->
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
						</svg>
					{/if}
				</div>
				<div class="kproj-titles">
					<h3 class="kcol-title kproj-title">{column.title}</h3>
					<div class="kproj-sub">
						<span>{column.cards.length} {column.cards.length === 1 ? 'card' : 'cards'}</span>
						{#if (column.activeCount ?? 0) > 0 || (column.doneCount ?? 0) > 0}
							<span class="kproj-sep">·</span>
							{#if (column.activeCount ?? 0) > 0}
								<span class="kproj-mini kproj-mini-active">
									<span class="kproj-mini-dot"></span>
									{column.activeCount} active
								</span>
							{/if}
							{#if (column.doneCount ?? 0) > 0}
								{#if (column.activeCount ?? 0) > 0}
									<span class="kproj-sep">·</span>
								{/if}
								<span class="kproj-mini kproj-mini-done">
									<span class="kproj-mini-dot"></span>
									{column.doneCount} done
								</span>
							{/if}
						{/if}
					</div>
				</div>
			</div>
			<button class="kcol-add" onclick={startDrafting} aria-label="Add card to project">
				<Plus size={16} />
			</button>
		</div>
	{:else}
		<!-- Status-mode column header -->
		<div class="kcol-head">
			<div class="kcol-head-l">
				<span class="kcol-title">{column.title}</span>
				<span class="kcol-count">{column.cards.length}</span>
			</div>
			<button class="kcol-add" onclick={startDrafting} aria-label="Add card">
				<Plus size={16} />
			</button>
		</div>
	{/if}

	<div
		class="kcol-body"
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
		role="list"
		aria-label="{column.title} cards"
	>
		{#each column.cards as card (card.id)}
			{@const cardStatusId = statusLookup?.get(card.id)}
			{@const cardStatusTitle = cardStatusId ? (statusTitles?.get(cardStatusId) ?? cardStatusId) : undefined}
			<KanbanCard
				{card}
				columnId={column.id}
				{density}
				{query}
				dragging={dragging?.cardId === card.id}
				glow={glowCardIds.has(card.id)}
				{columnStyle}
				{boardLabels}
				{boardProjects}
				{boardMembers}
				statusId={cardStatusId}
				statusTitle={cardStatusTitle}
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

	/* Project-mode column */
	.kcol-project {
		--pc: var(--fg-3);
		flex-basis: 360px;
		background: var(--paper-0);
	}

	.kcol-project.kcol-flat {
		background: transparent;
	}

	.kcol-orphan {
		background: transparent;
		border: 1px dashed var(--line-2);
		box-shadow: none;
	}

	.kcol-project.is-over {
		border-color: var(--pc);
		background: color-mix(in srgb, var(--pc) 7%, var(--paper-0));
	}

	:global([data-theme="dark"]) .kcol-project.is-over {
		background: color-mix(in srgb, var(--pc) 18%, var(--paper-0));
	}

	/* Status-mode header */
	.kcol-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px 10px;
	}

	/* Project-mode header */
	.kcol-head-project {
		padding: 18px 18px 14px;
		border-bottom: 1px solid var(--line-1);
		align-items: flex-start;
		gap: 12px;
	}

	.kcol-head-l {
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex: 1;
		min-width: 0;
	}

	.kcol-head-project .kcol-head-l {
		align-items: flex-start;
		gap: 12px;
	}

	.kproj-icon {
		width: 34px;
		height: 34px;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 10px;
		background: var(--pc);
		color: var(--paper-0);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15);
	}

	.kproj-icon-orphan {
		background: transparent;
		border: 1px dashed var(--line-3);
		color: var(--fg-3);
		box-shadow: none;
	}

	.kproj-titles {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		margin-top: -1px;
	}

	.kproj-title {
		font: 500 19px var(--font-display);
		cursor: default;
		padding: 0;
		margin: 0;
		letter-spacing: -0.015em;
		color: var(--fg-1);
	}

	.kproj-sub {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 5px;
		font: 500 11.5px var(--font-sans);
		color: var(--fg-3);
		font-variant-numeric: tabular-nums;
	}

	.kproj-sep { color: var(--fg-4); }

	.kproj-mini {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.kproj-mini-dot {
		width: 5px;
		height: 5px;
		border-radius: 999px;
		background: var(--fg-4);
	}

	.kproj-mini-active .kproj-mini-dot { background: var(--warning); }
	.kproj-mini-done .kproj-mini-dot { background: var(--success); }
	.kproj-mini-done { color: var(--success); }

	.kcol-title {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 500;
		font-size: 18px;
		color: var(--fg-1);
		letter-spacing: -0.01em;
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
		flex-shrink: 0;
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

	.kcol-body::-webkit-scrollbar { width: 6px; }
	.kcol-body::-webkit-scrollbar-thumb { background: var(--line-2); border-radius: 999px; }

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
