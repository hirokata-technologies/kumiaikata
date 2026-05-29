<script lang="ts">
	import { Sparkles, X, Trash2 } from '@lucide/svelte';
	import type { BoardState, KataCard, AvatarId } from '$lib/types.js';
	import { AVATARS, deepCloneColumns, getPresetDate } from '$lib/data.js';
	import {
		updateCard as apiUpdateCard,
		moveCard as apiMoveCard,
		deleteCard as apiDeleteCard,
		addLabelToCard,
		removeLabelFromCard,
		assignUser,
		unassignUser,
		getCard,
		createLabel,
		createProject,
		markClientOp,
		ApiError,
	} from '$lib/api';
	import AvatarChip from './AvatarChip.svelte';
	import DueBadge from './DueBadge.svelte';

	let {
		boardId,
		cardId,
		state: boardState,
		onClose,
		onAsk,
		onStateChange
	}: {
		boardId: string;
		cardId: string;
		state: BoardState;
		onClose: () => void;
		onAsk: (prefix: string) => void;
		onStateChange: (s: BoardState) => void;
	} = $props();

	// Find card and column
	const found = $derived.by(() => {
		for (const col of boardState.columns) {
			const card = col.cards.find(c => c.id === cardId);
			if (card) return { card, col };
		}
		return null;
	});

	const card = $derived(found?.card ?? null);
	const col = $derived(found?.col ?? null);

	let modalError: string | null = $state(null);

	// Fetch card detail (description etc.) on open
	$effect(() => {
		if (!cardId || !boardId) return;
		modalError = null;
		getCard(boardId, cardId)
			.then(detail => {
				if (!detail.description) return;
				// Patch the desc into boardState so the modal textarea shows it
				const cols = deepCloneColumns(boardState.columns);
				for (const c of cols) {
					const idx = c.cards.findIndex(ca => ca.id === cardId);
					if (idx !== -1) {
						cols[cols.indexOf(c)]!.cards[idx] = { ...c.cards[idx]!, desc: detail.description ?? '' };
						break;
					}
				}
				onStateChange({ ...boardState, columns: cols });
			})
			.catch(err => {
				// Non-fatal: description just won't be pre-filled
				console.warn('[CardModal] getCard error:', err);
			});
	});

	async function updateCardField(patch: Partial<KataCard>) {
		if (!card) return;
		const previous = boardState;
		// Optimistic update
		const cols = deepCloneColumns(boardState.columns);
		for (const c of cols) {
			const idx = c.cards.findIndex(ca => ca.id === cardId);
			if (idx !== -1) {
				c.cards[idx] = { ...c.cards[idx]!, ...patch };
				break;
			}
		}
		onStateChange({ ...boardState, columns: cols });

		modalError = null;
		try {
			markClientOp(`update:${cardId}`);
			await apiUpdateCard(boardId, cardId, {
				...(patch.title !== undefined && { title: patch.title }),
				...(patch.desc !== undefined && { description: patch.desc }),
				...(patch.due !== undefined && { dueDate: patch.due ? new Date(patch.due).toISOString() : null }),
			});
		} catch (err) {
			onStateChange(previous);
			modalError = err instanceof ApiError ? err.message : 'Failed to update card';
			console.warn('[CardModal] updateCardField error:', err);
		}
	}

	async function moveTo(toColId: string) {
		if (!card || !col) return;
		if (col.id === toColId) return;

		const previous = boardState;
		const cols = deepCloneColumns(boardState.columns);
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
				onStateChange({ ...boardState, columns: cols });
			}
		}

		modalError = null;
		try {
			markClientOp(`move:${cardId}`);
			await apiMoveCard(boardId, cardId, toColId, 0);
		} catch (err) {
			onStateChange(previous);
			modalError = err instanceof ApiError ? err.message : 'Failed to move card';
			console.warn('[CardModal] moveTo error:', err);
		}
	}

	async function deleteCard() {
		const previous = boardState;
		const cols = deepCloneColumns(boardState.columns);
		for (const c of cols) {
			const idx = c.cards.findIndex(ca => ca.id === cardId);
			if (idx !== -1) {
				c.cards.splice(idx, 1);
				break;
			}
		}
		onStateChange({ ...boardState, columns: cols });
		onClose();

		try {
			markClientOp(`delete:${cardId}`);
			await apiDeleteCard(boardId, cardId);
		} catch (err) {
			onStateChange(previous);
			// Modal is already closed; log the error
			console.warn('[CardModal] deleteCard error:', err);
		}
	}

	// Label creation state
	let creatingLabel = $state(false);
	let newLabelName = $state('');
	let newLabelColor = $state('#2E3A6B');
	let newLabelRef: HTMLInputElement | null = $state(null);

	const LABEL_COLORS = ['#2E3A6B','#9B3B2E','#3F6B4A','#B07A2A','#76716A','#4A463E','#7C3AED','#0891B2','#BE185D','#065F46'];

	// Project creation state
	let creatingProject = $state(false);
	let newProjectName = $state('');
	let newProjectColor = $state('#2E3A6B');
	let newProjectRef: HTMLInputElement | null = $state(null);

	const PROJECT_COLORS = ['#2E3A6B','#9B3B2E','#3F6B4A','#B07A2A','#76716A','#4A463E','#7C3AED','#0891B2','#BE185D','#065F46'];

	async function setCardProject(projectId: string | null) {
		if (!card) return;
		const previous = boardState;
		const cols = deepCloneColumns(boardState.columns);
		for (const c of cols) {
			const idx = c.cards.findIndex(ca => ca.id === cardId);
			if (idx !== -1) { c.cards[idx] = { ...c.cards[idx]!, projectId }; break; }
		}
		onStateChange({ ...boardState, columns: cols });
		try {
			markClientOp(`update:${cardId}`);
			await apiUpdateCard(boardId, cardId, { projectId });
		} catch (err) {
			onStateChange(previous);
			modalError = err instanceof ApiError ? err.message : 'Failed to update project';
		}
	}

	async function addNewProject() {
		const name = newProjectName.trim();
		if (!name) return;
		creatingProject = false;
		newProjectName = '';
		try {
			const proj = await createProject(boardId, name, newProjectColor);
			// Optimistically add to boardState so it shows immediately without waiting for SSE
			onStateChange({ ...boardState, projects: [...boardState.projects, { id: proj.id, name: proj.name, color: proj.color }] });
			await setCardProject(proj.id);
		} catch (err) {
			modalError = err instanceof ApiError ? err.message : 'Failed to create project';
		}
	}

	async function addNewLabel() {
		const name = newLabelName.trim();
		if (!name) return;
		creatingLabel = false;
		newLabelName = '';
		try {
			const label = await createLabel(boardId, name, newLabelColor);
			// Optimistically add to boardState so it shows immediately without waiting for SSE
			onStateChange({ ...boardState, labels: [...boardState.labels, { id: label.id, name: label.name, color: label.color }] });
			await toggleLabel(label.id);
		} catch (err) {
			modalError = err instanceof ApiError ? err.message : 'Failed to create label';
		}
	}

	async function toggleLabel(labelId: string) {
		if (!card) return;
		const isOn = card.labels.includes(labelId);
		const previous = boardState;
		// Optimistic
		const labels = isOn
			? card.labels.filter(l => l !== labelId)
			: [...card.labels, labelId];
		const cols = deepCloneColumns(boardState.columns);
		for (const c of cols) {
			const idx = c.cards.findIndex(ca => ca.id === cardId);
			if (idx !== -1) {
				c.cards[idx] = { ...c.cards[idx]!, labels };
				break;
			}
		}
		onStateChange({ ...boardState, columns: cols });

		modalError = null;
		try {
			markClientOp(`label:${cardId}:${labelId}`);
			if (isOn) {
				await removeLabelFromCard(boardId, cardId, labelId);
			} else {
				await addLabelToCard(boardId, cardId, labelId);
			}
		} catch (err) {
			onStateChange(previous);
			modalError = err instanceof ApiError ? err.message : 'Failed to toggle label';
			console.warn('[CardModal] toggleLabel error:', err);
		}
	}

	async function setAssignee(avatarId: AvatarId) {
		if (!card) return;
		const previous = boardState;
		const prevAssignee = card.assignee;
		// Optimistic
		const cols = deepCloneColumns(boardState.columns);
		for (const c of cols) {
			const idx = c.cards.findIndex(ca => ca.id === cardId);
			if (idx !== -1) {
				c.cards[idx] = { ...c.cards[idx]!, assignee: avatarId };
				break;
			}
		}
		onStateChange({ ...boardState, columns: cols });

		modalError = null;
		try {
			markClientOp(`assignee:${cardId}`);
			// Unassign previous if different
			if (prevAssignee && prevAssignee !== avatarId && prevAssignee !== 'me') {
				await unassignUser(boardId, cardId, prevAssignee);
			}
			await assignUser(boardId, cardId, avatarId);
		} catch (err) {
			onStateChange(previous);
			modalError = err instanceof ApiError ? err.message : 'Failed to update assignee';
			console.warn('[CardModal] setAssignee error:', err);
		}
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

			{#if modalError}
				<div class="modal-error" role="alert">{modalError}</div>
			{/if}

			<div class="modal-body">
				<div class="modal-main">
					<input
						class="modal-title"
						type="text"
						value={card.title}
						onchange={(e) => updateCardField({ title: (e.currentTarget as HTMLInputElement).value })}
						aria-label="Card title"
					/>

					<div class="modal-sec">
						<span class="eyebrow">Description</span>
						<textarea
							class="modal-desc"
							value={card.desc}
							placeholder="Add a description…"
							onchange={(e) => updateCardField({ desc: (e.currentTarget as HTMLTextAreaElement).value })}
							aria-label="Card description"
						></textarea>
					</div>
				</div>

				<aside class="modal-side">
					<!-- Column picker -->
					<div class="modal-side-sec">
						<span class="eyebrow">Status</span>
						<div class="modal-pill-row">
							{#each boardState.columns as c (c.id)}
								<button
									class="modal-pill"
									class:is-on={c.id === col.id}
									onclick={() => moveTo(c.id)}
								>{c.title}</button>
							{/each}
						</div>
					</div>

					<!-- Project -->
					<div class="modal-side-sec">
						<span class="eyebrow">Project</span>
						<div class="modal-projects">
							{#each boardState.projects as proj (proj.id)}
								{@const isOn = card.projectId === proj.id}
								<button
									class="proj-toggle"
									class:is-on={isOn}
									style="--proj-color: {proj.color};"
									onclick={() => setCardProject(isOn ? null : proj.id)}
									aria-pressed={isOn}
								>
									<span class="proj-dot" style="background: {proj.color};"></span>
									{proj.name}
								</button>
							{/each}

							{#if creatingProject}
								<div class="lbl-new-form">
									<input
										bind:this={newProjectRef}
										bind:value={newProjectName}
										class="lbl-new-input"
										placeholder="Project name…"
										onkeydown={(e) => {
											if (e.key === 'Enter') { e.preventDefault(); addNewProject(); }
											if (e.key === 'Escape') { creatingProject = false; newProjectName = ''; }
										}}
									/>
									<div class="lbl-color-row">
										{#each PROJECT_COLORS as c (c)}
											<button
												class="lbl-color-swatch"
												class:is-active={newProjectColor === c}
												style="background: {c};"
												onclick={() => (newProjectColor = c)}
												aria-label="Pick color {c}"
											></button>
										{/each}
									</div>
									<div class="lbl-new-actions">
										<button class="lbl-new-add" onclick={addNewProject} disabled={!newProjectName.trim()}>Add</button>
										<button class="lbl-new-cancel" onclick={() => { creatingProject = false; newProjectName = ''; }}>Cancel</button>
									</div>
								</div>
							{:else}
								<button class="lbl-new-btn" onclick={() => { creatingProject = true; setTimeout(() => newProjectRef?.focus(), 0); }}>
									+ New project
								</button>
							{/if}
						</div>
					</div>

					<!-- Labels -->
					<div class="modal-side-sec">
						<span class="eyebrow">Labels</span>
						<div class="modal-labels">
							{#each boardState.labels as label (label.id)}
								{@const isOn = card.labels.includes(label.id)}
								<button
									class="lbl-toggle"
									class:is-on={isOn}
									style="color: {label.color}; background: {isOn ? label.color + '1a' : 'transparent'}; border: 1px solid {isOn ? label.color + '55' : 'transparent'};"
									onclick={() => toggleLabel(label.id)}
									aria-pressed={isOn}
								>
									<span class="lbl-dot" style="background: {label.color};"></span>
									{label.name}
								</button>
							{/each}

							{#if creatingLabel}
								<div class="lbl-new-form">
									<input
										bind:this={newLabelRef}
										bind:value={newLabelName}
										class="lbl-new-input"
										placeholder="Label name…"
										onkeydown={(e) => {
											if (e.key === 'Enter') { e.preventDefault(); addNewLabel(); }
											if (e.key === 'Escape') { creatingLabel = false; newLabelName = ''; }
										}}
									/>
									<div class="lbl-color-row">
										{#each LABEL_COLORS as c (c)}
											<button
												class="lbl-color-swatch"
												class:is-active={newLabelColor === c}
												style="background: {c};"
												onclick={() => (newLabelColor = c)}
												aria-label="Pick color {c}"
											></button>
										{/each}
									</div>
									<div class="lbl-new-actions">
										<button class="lbl-new-add" onclick={addNewLabel} disabled={!newLabelName.trim()}>Add</button>
										<button class="lbl-new-cancel" onclick={() => { creatingLabel = false; newLabelName = ''; }}>Cancel</button>
									</div>
								</div>
							{:else}
								<button class="lbl-new-btn" onclick={() => { creatingLabel = true; setTimeout(() => newLabelRef?.focus(), 0); }}>
									+ New label
								</button>
							{/if}
						</div>
					</div>

					<!-- Due date -->
					<div class="modal-side-sec">
						<span class="eyebrow">Due date</span>
						<div class="datepicker">
							<div class="datepicker-current">
								{#if card.due}
									<DueBadge iso={card.due} />
									<button class="datepicker-clear" onclick={() => updateCardField({ due: undefined })} title="Clear date" aria-label="Clear due date">
										<X size={12} />
									</button>
								{:else}
									<span class="datepicker-empty">No due date</span>
								{/if}
							</div>
							<div class="datepicker-presets">
								<button class="datepicker-preset" class:is-on={isPresetActive('today')} onclick={() => updateCardField({ due: getPresetDate('today') })}>Today</button>
								<button class="datepicker-preset" class:is-on={isPresetActive('tomorrow')} onclick={() => updateCardField({ due: getPresetDate('tomorrow') })}>Tomorrow</button>
								<button class="datepicker-preset" class:is-on={isPresetActive('weekend')} onclick={() => updateCardField({ due: getPresetDate('weekend') })}>This wknd</button>
								<button class="datepicker-preset" class:is-on={isPresetActive('nextweek')} onclick={() => updateCardField({ due: getPresetDate('nextweek') })}>Next week</button>
							</div>
							<div class="datepicker-input">
								<input
									type="date"
									value={card.due ?? ''}
									onchange={(e) => {
										const v = (e.currentTarget as HTMLInputElement).value;
										updateCardField({ due: v || undefined });
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

	.modal-error {
		padding: 8px 20px;
		background: #fff0ee;
		border-bottom: 1px solid rgba(155, 59, 46, 0.2);
		color: #9B3B2E;
		font: 500 12px var(--font-sans);
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

	.lbl-new-form {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 4px;
		padding: 10px 12px;
		background: var(--paper-1);
		border: 1px solid var(--line-2);
		border-radius: 8px;
		width: 100%;
	}

	.lbl-new-input {
		width: 100%;
		border: 1px solid var(--line-2);
		border-radius: 6px;
		padding: 5px 8px;
		font: 500 13px var(--font-sans);
		background: var(--paper-0);
		color: var(--fg-1);
		outline: none;
	}

	.lbl-new-input:focus {
		border-color: var(--accent);
	}

	.lbl-color-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.lbl-color-swatch {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 2px solid transparent;
		cursor: pointer;
		transition: transform 100ms;
	}

	.lbl-color-swatch:hover {
		transform: scale(1.15);
	}

	.lbl-color-swatch.is-active {
		border-color: var(--fg-1);
		transform: scale(1.15);
	}

	.lbl-new-actions {
		display: flex;
		gap: 6px;
	}

	.lbl-new-add {
		flex: 1;
		padding: 4px 10px;
		background: var(--accent);
		color: #fff;
		border: none;
		border-radius: 6px;
		font: 500 12px var(--font-sans);
		cursor: pointer;
	}

	.lbl-new-add:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.lbl-new-cancel {
		padding: 4px 10px;
		background: transparent;
		border: 1px solid var(--line-2);
		border-radius: 6px;
		font: 500 12px var(--font-sans);
		cursor: pointer;
		color: var(--fg-2);
	}

	.lbl-new-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 10px;
		background: transparent;
		border: 1px dashed var(--line-2);
		border-radius: 6px;
		font: 500 12px var(--font-sans);
		color: var(--fg-3);
		cursor: pointer;
		transition: all 140ms;
		margin-top: 2px;
	}

	.lbl-new-btn:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.modal-projects {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.proj-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		border-radius: 8px;
		border: 1px solid transparent;
		background: transparent;
		font: 500 13px var(--font-sans);
		color: var(--fg-2);
		cursor: pointer;
		text-align: left;
		transition: all 140ms;
		width: 100%;
	}

	.proj-toggle:hover {
		background: var(--paper-1);
		color: var(--fg-1);
	}

	.proj-toggle.is-on {
		background: color-mix(in srgb, var(--proj-color) 12%, transparent);
		border-color: color-mix(in srgb, var(--proj-color) 40%, transparent);
		color: var(--proj-color);
	}

	.proj-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}
</style>
