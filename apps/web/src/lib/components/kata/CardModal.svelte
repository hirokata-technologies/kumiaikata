<script lang="ts">
	import { Sparkles, X, Trash2 } from 'lucide-svelte';
	import type { BoardState, KataCard, KataColumn, LabelId, AvatarId } from '$lib/types.js';
	import { LABELS, AVATARS, deepCloneColumns, getPresetDate } from '$lib/data.js';
	import LabelChip from './LabelChip.svelte';
	import AvatarChip from './AvatarChip.svelte';
	import DueBadge from './DueBadge.svelte';

	let {
		cardId,
		state,
		onClose,
		onAsk,
		onStateChange
	}: {
		cardId: string;
		state: BoardState;
		onClose: () => void;
		onAsk: (prefix: string) => void;
		onStateChange: (s: BoardState) => void;
	} = $props();

	// Find card and column
	const found = $derived(() => {
		for (const col of state.columns) {
			const card = col.cards.find(c => c.id === cardId);
			if (card) return { card, col };
		}
		return null;
	});

	const card = $derived(found()?.card ?? null);
	const col = $derived(found()?.col ?? null);

	function updateCard(patch: Partial<KataCard>) {
		if (!card) return;
		const cols = deepCloneColumns(state.columns);
		for (const c of cols) {
			const idx = c.cards.findIndex(ca => ca.id === cardId);
			if (idx !== -1) {
				c.cards[idx] = { ...c.cards[idx], ...patch };
				break;
			}
		}
		onStateChange({ columns: cols });
	}

	function moveTo(toColId: string) {
		if (!card || !col) return;
		if (col.id === toColId) return;
		const cols = deepCloneColumns(state.columns);
		let movedCard: KataCard | null = null;
		for (const c of cols) {
			const idx = c.cards.findIndex(ca => ca.id === cardId);
			if (idx !== -1) {
				[movedCard] = c.cards.splice(idx, 1);
				break;
			}
		}
		if (movedCard) {
			const toCol = cols.find(c => c.id === toColId);
			if (toCol) {
				toCol.cards.unshift(movedCard);
				onStateChange({ columns: cols });
			}
		}
	}

	function deleteCard() {
		const cols = deepCloneColumns(state.columns);
		for (const c of cols) {
			const idx = c.cards.findIndex(ca => ca.id === cardId);
			if (idx !== -1) {
				c.cards.splice(idx, 1);
				break;
			}
		}
		onStateChange({ columns: cols });
		onClose();
	}

	function toggleLabel(labelId: LabelId) {
		if (!card) return;
		const labels = card.labels.includes(labelId)
			? card.labels.filter(l => l !== labelId)
			: [...card.labels, labelId];
		updateCard({ labels });
	}

	function setAssignee(avatarId: AvatarId) {
		updateCard({ assignee: avatarId });
	}

	function isPresetActive(preset: string): boolean {
		if (!card?.due) return false;
		return card.due === getPresetDate(preset);
	}

	// Keyboard: close on Escape
	$effect(() => {
		function onKeydown(e: KeyboardEvent) {
			if (e.key === 'Escape') onClose();
		}
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});
</script>

{#if card && col}
	<div
		class="modal-scrim"
		onclick={onClose}
		onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
		role="dialog"
		aria-modal="true"
		aria-label={card.title}
		tabindex="-1"
	>
		<div class="modal" onclick={(e) => e.stopPropagation()} role="presentation">
			<header class="modal-head">
				<div class="modal-bread">
					<span class="eyebrow">{col.title}</span>
					<span class="bread-sep">›</span>
					<span class="modal-id">#{card.id}</span>
				</div>
				<div class="modal-head-actions">
					<button class="chat-iconbtn" onclick={() => onAsk(`/draft @${card.title.split(' ').slice(0,3).join('-').toLowerCase()}`)} title="Ask AI about this card">
						<Sparkles size={16} />
					</button>
					<button class="chat-iconbtn" onclick={onClose} title="Close">
						<X size={16} />
					</button>
				</div>
			</header>

			<div class="modal-body">
				<div class="modal-main">
					<input
						class="modal-title"
						type="text"
						value={card.title}
						onchange={(e) => updateCard({ title: (e.currentTarget as HTMLInputElement).value })}
						aria-label="Card title"
					/>

					<div class="modal-sec">
						<span class="eyebrow">Description</span>
						<textarea
							class="modal-desc"
							value={card.desc}
							placeholder="Add a description…"
							onchange={(e) => updateCard({ desc: (e.currentTarget as HTMLTextAreaElement).value })}
							aria-label="Card description"
						></textarea>
					</div>
				</div>

				<aside class="modal-side">
					<!-- Column picker -->
					<div class="modal-side-sec">
						<span class="eyebrow">Column</span>
						<div class="modal-pill-row">
							{#each state.columns as c (c.id)}
								<button
									class="modal-pill"
									class:is-on={c.id === col.id}
									onclick={() => moveTo(c.id)}
								>{c.title}</button>
							{/each}
						</div>
					</div>

					<!-- Labels -->
					<div class="modal-side-sec">
						<span class="eyebrow">Labels</span>
						<div class="modal-labels">
							{#each Object.entries(LABELS) as [labelId, labelDef] (labelId)}
								{@const isOn = card.labels.includes(labelId as LabelId)}
								<button
									class="lbl-toggle"
									class:is-on={isOn}
									style="color: {labelDef.fg}; background: {isOn ? labelDef.bg : 'transparent'}; border: 1px solid {isOn ? labelDef.fg + '55' : 'transparent'};"
									onclick={() => toggleLabel(labelId as LabelId)}
									aria-pressed={isOn}
								>
									<span class="lbl-dot" style="background: {labelDef.fg};"></span>
									{labelDef.name}
								</button>
							{/each}
						</div>
					</div>

					<!-- Due date -->
					<div class="modal-side-sec">
						<span class="eyebrow">Due date</span>
						<div class="datepicker">
							<div class="datepicker-current">
								{#if card.due}
									<DueBadge iso={card.due} />
									<button class="datepicker-clear" onclick={() => updateCard({ due: undefined })} title="Clear date" aria-label="Clear due date">
										<X size={12} />
									</button>
								{:else}
									<span class="datepicker-empty">No due date</span>
								{/if}
							</div>
							<div class="datepicker-presets">
								<button class="datepicker-preset" class:is-on={isPresetActive('today')} onclick={() => updateCard({ due: getPresetDate('today') })}>Today</button>
								<button class="datepicker-preset" class:is-on={isPresetActive('tomorrow')} onclick={() => updateCard({ due: getPresetDate('tomorrow') })}>Tomorrow</button>
								<button class="datepicker-preset" class:is-on={isPresetActive('weekend')} onclick={() => updateCard({ due: getPresetDate('weekend') })}>This wknd</button>
								<button class="datepicker-preset" class:is-on={isPresetActive('nextweek')} onclick={() => updateCard({ due: getPresetDate('nextweek') })}>Next week</button>
							</div>
							<div class="datepicker-input">
								<input
									type="date"
									value={card.due ?? ''}
									onchange={(e) => {
										const v = (e.currentTarget as HTMLInputElement).value;
										updateCard({ due: v || undefined });
									}}
									aria-label="Pick a due date"
								/>
							</div>
						</div>
					</div>

					<!-- Assignee -->
					<div class="modal-side-sec">
						<span class="eyebrow">Assignee</span>
						<div class="modal-assignees">
							{#each Object.entries(AVATARS) as [avatarId, avatarDef] (avatarId)}
								<button
									class="modal-assignee"
									class:is-on={card.assignee === avatarId}
									onclick={() => setAssignee(avatarId as AvatarId)}
									aria-pressed={card.assignee === avatarId}
								>
									<AvatarChip id={avatarId as AvatarId} size={22} />
									{avatarDef.name}
								</button>
							{/each}
						</div>
					</div>

					<!-- Delete -->
					<div class="modal-side-sec">
						<button class="btn-danger" onclick={deleteCard}>
							<Trash2 size={14} />
							Delete card
						</button>
					</div>
				</aside>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-scrim {
		position: fixed;
		inset: 0;
		background: rgba(20, 19, 15, 0.45);
		backdrop-filter: blur(6px);
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 32px;
		animation: scrim-in 180ms ease-out;
	}

	@keyframes scrim-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.modal {
		width: min(880px, 100%);
		max-height: 92vh;
		background: var(--paper-0);
		border-radius: 18px;
		box-shadow: var(--shadow-lg);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		animation: modal-in 220ms ease-out;
	}

	@keyframes modal-in {
		from { transform: translateY(12px) scale(0.98); opacity: 0; }
		to { transform: none; opacity: 1; }
	}

	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 20px;
		border-bottom: 1px solid var(--line-1);
	}

	.modal-bread {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.bread-sep {
		color: var(--fg-4);
		font-size: 13px;
	}

	.modal-id {
		font: 400 12px var(--font-mono);
		color: var(--fg-4);
	}

	.modal-head-actions {
		display: flex;
		gap: 4px;
	}

	.chat-iconbtn {
		width: 30px;
		height: 30px;
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

	.chat-iconbtn:hover {
		background: var(--paper-1);
		color: var(--fg-1);
	}

	.modal-body {
		display: grid;
		grid-template-columns: 1fr 280px;
		gap: 0;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.modal-main {
		padding: 24px 28px 28px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.modal-side {
		padding: 24px 22px 28px;
		border-left: 1px solid var(--line-1);
		background: var(--paper-1);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 22px;
	}

	.modal-title {
		font: 500 28px/1.18 var(--font-display);
		color: var(--fg-1);
		letter-spacing: -0.015em;
		background: transparent;
		border: none;
		outline: none;
		padding: 4px 6px;
		margin: -4px -6px;
		border-radius: 6px;
		width: 100%;
	}

	.modal-title:hover,
	.modal-title:focus {
		background: var(--paper-1);
	}

	.modal-sec {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.modal-desc {
		font: 400 14.5px/1.6 var(--font-sans);
		color: var(--fg-2);
		background: var(--paper-1);
		border: 1px solid var(--line-1);
		border-radius: 10px;
		padding: 14px 16px;
		outline: none;
		resize: vertical;
		min-height: 120px;
		font-family: var(--font-sans);
		width: 100%;
	}

	.modal-desc:focus {
		border-color: var(--line-3);
		background: var(--paper-0);
	}

	.modal-side-sec {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.modal-pill-row {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.modal-pill {
		font: 500 12px var(--font-sans);
		padding: 5px 10px;
		border-radius: 999px;
		background: var(--paper-0);
		border: 1px solid var(--line-2);
		color: var(--fg-2);
		cursor: pointer;
		transition: all 140ms;
	}

	.modal-pill:hover {
		border-color: var(--line-3);
	}

	.modal-pill.is-on {
		background: var(--ink-0);
		color: var(--paper-0);
		border-color: var(--ink-0);
	}

	.modal-labels {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}

	.lbl-toggle {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 8px;
		border-radius: 999px;
		font: 500 11px var(--font-sans);
		cursor: pointer;
		transition: all 140ms;
		opacity: 0.5;
	}

	.lbl-toggle.is-on {
		opacity: 1;
	}

	.lbl-toggle:hover {
		opacity: 1;
	}

	.lbl-dot {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		flex-shrink: 0;
	}

	.modal-assignees {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.modal-assignee {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 5px 8px;
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		font: 500 13px var(--font-sans);
		color: var(--fg-2);
		text-align: left;
		transition: all 140ms;
	}

	.modal-assignee:hover {
		background: var(--paper-0);
		color: var(--fg-1);
	}

	.modal-assignee.is-on {
		background: var(--paper-0);
		color: var(--fg-1);
		outline: 1px solid var(--line-2);
	}

	.btn-danger {
		background: transparent;
		color: #9B3B2E;
		border: 1px solid rgba(155, 59, 46, 0.3);
		border-radius: 6px;
		padding: 7px 12px;
		font: 500 13px var(--font-sans);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		transition: background 140ms;
	}

	.btn-danger:hover {
		background: rgba(155, 59, 46, 0.06);
	}

	/* Date picker */
	.datepicker {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.datepicker-current {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 24px;
	}

	.datepicker-empty {
		font: 400 13px var(--font-sans);
		color: var(--fg-4);
		font-style: italic;
	}

	.datepicker-clear {
		width: 18px;
		height: 18px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--fg-4);
		border-radius: 4px;
	}

	.datepicker-clear:hover {
		background: var(--paper-3);
		color: var(--fg-1);
	}

	.datepicker-presets {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
	}

	.datepicker-preset {
		font: 500 12px var(--font-sans);
		padding: 6px 8px;
		background: var(--paper-0);
		border: 1px solid var(--line-2);
		border-radius: 6px;
		color: var(--fg-2);
		cursor: pointer;
		text-align: left;
		transition: all 140ms;
	}

	.datepicker-preset:hover {
		border-color: var(--line-3);
		color: var(--fg-1);
	}

	.datepicker-preset.is-on {
		background: var(--ink-0);
		color: var(--paper-0);
		border-color: var(--ink-0);
	}

	.datepicker-input {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.datepicker-input input {
		font: 500 13px var(--font-sans);
		padding: 6px 8px;
		background: var(--paper-0);
		border: 1px solid var(--line-2);
		border-radius: 6px;
		color: var(--fg-1);
		outline: none;
		cursor: pointer;
		width: 100%;
		color-scheme: light;
	}

	.datepicker-input input:focus {
		border-color: var(--accent);
	}
</style>
