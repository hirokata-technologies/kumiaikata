<script lang="ts">
	import { Eraser, X, ArrowUp, Check, PlusCircle, MoveRight, FileText, Sparkles } from 'lucide-svelte';
	import type { BoardState, ChatMessage, MessagePart, KataCard } from '$lib/types.js';
	import { scriptAI } from '$lib/ai.js';
	import { deepCloneColumns, QUICK_REPLIES, SLASH_COMMANDS, newCardId } from '$lib/data.js';
	import LabelChip from './LabelChip.svelte';
	import AvatarChip from './AvatarChip.svelte';
	import DueBadge from './DueBadge.svelte';

	let {
		boardState,
		selectedCardId,
		placement,
		onClose,
		onStateChange
	}: {
		boardState: BoardState;
		selectedCardId: string | null;
		placement: string;
		onClose: () => void;
		onStateChange: (s: BoardState) => void;
	} = $props();

	const GREETING: ChatMessage = {
		id: 'm-greet',
		role: 'ai',
		parts: [{ kind: 'text', streamed: true, text: "Hi — I'm here to help keep this board moving. Try one of the chips below, or type **/** for commands." }]
	};

	let messages: ChatMessage[] = $state([GREETING]);
	let input = $state('');
	let busy = $state(false);
	let scrollRef: HTMLElement | null = $state(null);
	let inputRef: HTMLTextAreaElement | null = $state(null);

	// Derived: show slash menu when input starts with '/' and no space yet
	const showSlashMenu = $derived(input.startsWith('/') && !input.includes(' ') && input.length > 0);

	// Derived: show mention menu
	const mentionMatch = $derived(input.match(/@([\w-]*)$/));
	const showMentionMenu = $derived(!!mentionMatch);

	const mentionCards = $derived(() => {
		if (!mentionMatch) return [];
		const needle = (mentionMatch[1] || '').toLowerCase();
		const results: { card: KataCard; colTitle: string }[] = [];
		for (const col of boardState.columns) {
			for (const card of col.cards) {
				if (!needle || card.title.toLowerCase().includes(needle)) {
					results.push({ card, colTitle: col.title });
				}
			}
		}
		return results.slice(0, 6);
	});

	const filteredSlashCommands = $derived(() => {
		const prefix = input.slice(1).toLowerCase();
		return SLASH_COMMANDS.filter(c => c.cmd.slice(1).startsWith(prefix));
	});

	const selectedCard = $derived(() => {
		if (!selectedCardId) return null;
		for (const col of boardState.columns) {
			const found = col.cards.find(c => c.id === selectedCardId);
			if (found) return found;
		}
		return null;
	});

	function scrollToBottom() {
		if (scrollRef) {
			setTimeout(() => {
				if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight;
			}, 10);
		}
	}

	async function send(text: string) {
		const t = text.trim();
		if (!t || busy) return;

		const userMsg: ChatMessage = {
			id: `m-${Date.now()}-u`,
			role: 'user',
			text: t
		};
		messages = [...messages, userMsg];
		input = '';
		busy = true;
		scrollToBottom();

		await new Promise(r => setTimeout(r, 280));

		const parts = scriptAI(t, boardState, { selectedCard: selectedCard() });
		const aiMsg: ChatMessage = {
			id: `m-${Date.now()}-a`,
			role: 'ai',
			parts
		};
		messages = [...messages, aiMsg];
		scrollToBottom();

		await new Promise(r => setTimeout(r, 60));
		busy = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send(input);
		}
	}

	function clearChat() {
		messages = [GREETING];
	}

	function acceptProposal(msgId: string, partIndex: number) {
		const msg = messages.find(m => m.id === msgId);
		if (!msg?.parts) return;
		const part = msg.parts[partIndex];
		if (part.kind !== 'proposal') return;
		const { proposal } = part;

		const cols = deepCloneColumns(boardState.columns);

		if (proposal.type === 'create' && proposal.card && proposal.columnId) {
			const col = cols.find(c => c.id === proposal.columnId);
			if (col) {
				col.cards.unshift({ ...proposal.card });
				onStateChange({ columns: cols });
				window.dispatchEvent(new CustomEvent('hk-glow', { detail: { ids: [proposal.card.id] } }));
			}
		} else if (proposal.type === 'move' && proposal.cardId && proposal.toColumnId) {
			let movedCard: KataCard | null = null;
			for (const col of cols) {
				const idx = col.cards.findIndex(c => c.id === proposal.cardId);
				if (idx !== -1) {
					[movedCard] = col.cards.splice(idx, 1);
					break;
				}
			}
			if (movedCard) {
				const toCol = cols.find(c => c.id === proposal.toColumnId);
				if (toCol) {
					toCol.cards.unshift(movedCard);
					onStateChange({ columns: cols });
					window.dispatchEvent(new CustomEvent('hk-glow', { detail: { ids: [movedCard.id] } }));
				}
			}
		} else if (proposal.type === 'description' && proposal.cardId && proposal.text != null) {
			for (const col of cols) {
				const card = col.cards.find(c => c.id === proposal.cardId);
				if (card) {
					card.desc = proposal.text;
					onStateChange({ columns: cols });
					window.dispatchEvent(new CustomEvent('hk-glow', { detail: { ids: [card.id] } }));
					break;
				}
			}
		}

		// Mark as accepted
		messages = messages.map(m => {
			if (m.id !== msgId || !m.parts) return m;
			return {
				...m,
				parts: m.parts.map((p, i) => {
					if (i !== partIndex || p.kind !== 'proposal') return p;
					return { ...p, accepted: true };
				})
			};
		});
	}

	function rejectProposal(msgId: string, partIndex: number) {
		messages = messages.map(m => {
			if (m.id !== msgId || !m.parts) return m;
			return {
				...m,
				parts: m.parts.map((p, i) => {
					if (i !== partIndex || p.kind !== 'proposal') return p;
					return { ...p, rejected: true };
				})
			};
		});
	}

	function applyQuickReply(value: string) {
		input = value;
		setTimeout(() => {
			if (input.startsWith('/') && !input.endsWith(' ')) {
				send(input);
			} else {
				inputRef?.focus();
			}
		}, 50);
	}

	function applySlashCmd(cmd: string) {
		input = cmd + ' ';
		inputRef?.focus();
	}

	function applyMention(cardTitle: string) {
		input = input.replace(/@[\w-]*$/, `@${cardTitle.split(' ').slice(0, 3).join('-').toLowerCase()} `);
		inputRef?.focus();
	}

	function renderMd(text: string): string {
		return text
			.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
			.replace(/\*(.+?)\*/g, '<em>$1</em>')
			.replace(/`(.+?)`/g, '<code>$1</code>')
			.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
			.replace(/\n/g, '<br/>');
	}

	function getProposalLabel(type: string) {
		if (type === 'create') return 'New card';
		if (type === 'move') return 'Move card';
		if (type === 'description') return 'Update description';
		return 'Suggestion';
	}
</script>

<!-- Streaming text sub-component handled inline via $state -->
{#snippet streamingText(text: string, streamed: boolean)}
	{#if streamed}
		{@const { shown } = (() => {
			// We use a simple approach: render full text since streaming is simulated
			return { shown: text.length };
		})()}
		<span>{@html renderMd(text.slice(0, shown))}</span>
	{:else}
		<span>{@html renderMd(text)}</span>
	{/if}
{/snippet}

<aside class="chat chat-{placement}">
	<header class="chat-head">
		<div class="chat-title">
			<span class="eyebrow">Assistant</span>
			<div class="chat-name">Kata</div>
		</div>
		<div class="chat-head-actions">
			<button class="chat-iconbtn" onclick={clearChat} title="Clear chat">
				<Eraser size={16} />
			</button>
			{#if placement !== 'side'}
				<button class="chat-iconbtn" onclick={onClose} title="Close">
					<X size={16} />
				</button>
			{/if}
		</div>
	</header>

	<div class="chat-scroll" bind:this={scrollRef}>
		{#each messages as msg (msg.id)}
			{#if msg.role === 'user'}
				<div class="msg msg-user">
					<div class="msg-bubble">{msg.text}</div>
				</div>
			{:else}
				<div class="msg">
					<div class="msg-avatar" aria-hidden="true">
						<Sparkles size={14} />
					</div>
					<div class="msg-content">
						{#if msg.parts}
							{#each msg.parts as part, partIdx (partIdx)}
								{#if part.kind === 'text'}
									<div class="msg-body">
										{@html renderMd(part.text)}
									</div>
								{:else if part.kind === 'proposal'}
									{@const proposal = part.proposal}
									{@const isAccepted = !!part.accepted}
									{@const isRejected = !!part.rejected}
									<div class="proposal" class:is-accepted={isAccepted} class:is-rejected={isRejected}>
										<div class="proposal-head">
											{#if proposal.type === 'create'}
												<PlusCircle size={14} />
											{:else if proposal.type === 'move'}
												<MoveRight size={14} />
											{:else if proposal.type === 'description'}
												<FileText size={14} />
											{:else}
												<Sparkles size={14} />
											{/if}
											<span class="proposal-kind">{getProposalLabel(proposal.type)}</span>
										</div>
										<div class="proposal-body">{@html renderMd(proposal.summary)}</div>

										{#if proposal.type === 'create' && proposal.card}
											<div class="proposal-preview-card">
												<div class="preview-title">{proposal.card.title}</div>
												<div class="preview-meta">
													{#if proposal.card.due}
														<DueBadge iso={proposal.card.due} />
													{/if}
													{#each proposal.card.labels as lid (lid)}
														<LabelChip id={lid} />
													{/each}
													{#if proposal.card.assignee}
														<AvatarChip id={proposal.card.assignee} size={18} />
													{/if}
												</div>
											</div>
										{/if}

										{#if proposal.type === 'description' && proposal.text}
											<div class="proposal-text">{proposal.text}</div>
										{/if}

										{#if !isAccepted && !isRejected}
											<div class="proposal-actions">
												<button class="btn-accept" onclick={() => acceptProposal(msg.id, partIdx)}>
													<Check size={13} />
													Accept
												</button>
												<button class="btn-dismiss" onclick={() => rejectProposal(msg.id, partIdx)}>
													Dismiss
												</button>
											</div>
										{:else if isAccepted}
											<div class="proposal-status proposal-status-ok">
												<Check size={13} />
												Applied
											</div>
										{:else}
											<div class="proposal-status">Dismissed</div>
										{/if}
									</div>
								{/if}
							{/each}
						{/if}
					</div>
				</div>
			{/if}
		{/each}

		{#if busy}
			<div class="msg">
				<div class="msg-avatar" aria-hidden="true">
					<Sparkles size={14} />
				</div>
				<div class="typing" aria-label="Thinking…">
					<span></span>
					<span></span>
					<span></span>
				</div>
			</div>
		{/if}
	</div>

	<div class="chat-input-wrap">
		{#if messages.length <= 1}
			<div class="quick-replies">
				{#each QUICK_REPLIES as qr (qr.value)}
					<button class="qr-chip" onclick={() => applyQuickReply(qr.value)}>
						{qr.label}
					</button>
				{/each}
			</div>
		{/if}

		<div class="chat-input">
			{#if showSlashMenu && filteredSlashCommands().length}
				<div class="slash-menu" role="listbox">
					{#each filteredSlashCommands() as item (item.cmd)}
						<button
							class="slash-item"
							role="option"
							aria-selected="false"
							onclick={() => applySlashCmd(item.cmd)}
						>
							<code>{item.cmd}</code>
							<span class="hint">{item.hint}</span>
						</button>
					{/each}
				</div>
			{/if}

			{#if showMentionMenu && mentionCards().length}
				<div class="slash-menu" role="listbox">
					{#each mentionCards() as { card, colTitle } (card.id)}
						<button
							class="slash-item"
							role="option"
							aria-selected="false"
							onclick={() => applyMention(card.title)}
						>
							<span>{card.title}</span>
							<span class="hint">{colTitle}</span>
						</button>
					{/each}
				</div>
			{/if}

			<textarea
				bind:value={input}
				bind:this={inputRef}
				placeholder="Ask anything about the board…"
				rows={1}
				disabled={busy}
				onkeydown={handleKeydown}
				aria-label="Chat message"
			></textarea>
			<button
				class="chat-send"
				disabled={!input.trim() || busy}
				onclick={() => send(input)}
				aria-label="Send message"
			>
				<ArrowUp size={16} />
			</button>
		</div>

		<div class="chat-hint">
			<span>⌨ / commands</span>
			<span>@ mention cards</span>
			<span>⏎ send</span>
		</div>
	</div>
</aside>

<style>
	.chat {
		display: flex;
		flex-direction: column;
		background: var(--paper-0);
		width: 400px;
		flex-shrink: 0;
		border-left: 1px solid var(--line-1);
		min-height: 0;
	}

	.chat-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 18px 12px;
		border-bottom: 1px solid var(--line-1);
	}

	.chat-title {
		display: flex;
		flex-direction: column;
		line-height: 1.15;
		gap: 1px;
	}

	.chat-name {
		font-family: var(--font-display);
		font-size: 17px;
		font-weight: 500;
		color: var(--fg-1);
		letter-spacing: -0.01em;
	}

	.chat-head-actions {
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

	.chat-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 16px 18px 6px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		scroll-behavior: smooth;
	}

	.chat-scroll::-webkit-scrollbar {
		width: 6px;
	}

	.chat-scroll::-webkit-scrollbar-thumb {
		background: var(--line-2);
		border-radius: 999px;
	}

	.msg {
		display: flex;
		gap: 10px;
		align-items: flex-start;
	}

	.msg-user {
		justify-content: flex-end;
	}

	.msg-user .msg-bubble {
		max-width: 90%;
		background: var(--ink-0);
		color: var(--paper-0);
		padding: 9px 12px;
		border-radius: 14px 14px 4px 14px;
		font-size: 14px;
		line-height: 1.45;
	}

	.msg-avatar {
		flex-shrink: 0;
		width: 26px;
		height: 26px;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent);
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.msg-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.msg-body {
		font-size: 14px;
		line-height: 1.55;
		color: var(--fg-1);
	}

	.msg-body :global(strong) {
		font-weight: 600;
	}

	.msg-body :global(code) {
		font-family: var(--font-mono);
		font-size: 0.88em;
		background: var(--paper-1);
		padding: 1px 5px;
		border-radius: 4px;
	}

	.msg-body :global(blockquote) {
		margin: 6px 0;
		padding: 4px 12px;
		border-left: 2px solid var(--line-2);
		color: var(--fg-3);
		font-style: italic;
	}

	.typing {
		display: inline-flex;
		gap: 4px;
		padding: 8px 0;
	}

	.typing span {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: var(--fg-4);
		animation: bounce 1.1s ease-in-out infinite;
	}

	.typing span:nth-child(2) {
		animation-delay: 0.18s;
	}

	.typing span:nth-child(3) {
		animation-delay: 0.36s;
	}

	@keyframes bounce {
		0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
		30% { transform: translateY(-3px); opacity: 1; }
	}

	.proposal {
		border: 1px solid var(--accent);
		background: var(--accent-soft);
		border-radius: 12px;
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.proposal.is-accepted {
		background: rgba(63, 107, 74, 0.08);
		border-color: rgba(63, 107, 74, 0.3);
	}

	.proposal.is-rejected {
		opacity: 0.5;
		background: var(--paper-1);
		border-color: var(--line-2);
	}

	.proposal-head {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--accent);
	}

	.is-accepted .proposal-head {
		color: #3F6B4A;
	}

	.is-rejected .proposal-head {
		color: var(--fg-3);
	}

	.proposal-kind {
		font: 600 11px var(--font-sans);
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.proposal-body {
		font-size: 13.5px;
		color: var(--fg-1);
		line-height: 1.45;
	}

	.proposal-preview-card {
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: 8px;
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.preview-title {
		font: 500 13.5px/1.4 var(--font-sans);
		color: var(--fg-1);
	}

	.preview-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		align-items: center;
	}

	.proposal-text {
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: 8px;
		padding: 10px 12px;
		font-size: 13px;
		color: var(--fg-2);
		line-height: 1.55;
		white-space: pre-wrap;
	}

	.proposal-actions {
		display: flex;
		gap: 8px;
	}

	.proposal-status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: 500 12px var(--font-sans);
		color: var(--fg-3);
	}

	.proposal-status-ok {
		color: #3F6B4A;
	}

	.btn-accept {
		background: var(--ink-0);
		color: var(--paper-0);
		border: none;
		border-radius: 6px;
		padding: 7px 12px;
		font: 500 13px var(--font-sans);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		transition: background 140ms;
	}

	.btn-accept:hover {
		background: var(--ink-1);
	}

	.btn-dismiss {
		background: transparent;
		color: var(--fg-1);
		border: 1px solid var(--line-3);
		border-radius: 6px;
		padding: 7px 12px;
		font: 500 13px var(--font-sans);
		cursor: pointer;
		transition: background 140ms;
	}

	.btn-dismiss:hover {
		background: var(--paper-1);
	}

	.chat-input-wrap {
		padding: 10px 14px 14px;
		border-top: 1px solid var(--line-1);
		background: var(--paper-0);
	}

	.quick-replies {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 10px;
	}

	.qr-chip {
		font: 500 12.5px var(--font-sans);
		padding: 6px 12px;
		border-radius: 999px;
		border: 1px solid var(--line-2);
		background: var(--paper-0);
		color: var(--fg-2);
		cursor: pointer;
		transition: all 140ms;
	}

	.qr-chip:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-soft);
	}

	.chat-input {
		position: relative;
		display: flex;
		align-items: flex-end;
		gap: 8px;
		padding: 8px 8px 8px 12px;
		background: var(--paper-1);
		border: 1px solid var(--line-1);
		border-radius: 12px;
		transition: border-color 140ms;
	}

	.chat-input:focus-within {
		border-color: var(--line-3);
		background: var(--paper-0);
	}

	.chat-input textarea {
		flex: 1;
		resize: none;
		border: none;
		outline: none;
		background: transparent;
		font: 400 14px/1.4 var(--font-sans);
		color: var(--fg-1);
		min-height: 22px;
		max-height: 140px;
		padding: 4px 0;
	}

	.chat-input textarea::placeholder {
		color: var(--fg-4);
	}

	.chat-send {
		width: 30px;
		height: 30px;
		border-radius: 8px;
		background: var(--ink-0);
		color: var(--paper-0);
		border: none;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: all 140ms;
		flex-shrink: 0;
	}

	.chat-send:hover:not(:disabled) {
		background: var(--accent);
	}

	.chat-send:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.chat-hint {
		margin-top: 8px;
		display: flex;
		gap: 14px;
		font: 400 11px var(--font-sans);
		color: var(--fg-4);
	}

	.slash-menu {
		position: absolute;
		bottom: calc(100% + 6px);
		left: 0;
		right: 0;
		background: var(--paper-0);
		border: 1px solid var(--line-2);
		border-radius: 10px;
		box-shadow: var(--shadow-lg);
		padding: 4px;
		display: flex;
		flex-direction: column;
		max-height: 240px;
		overflow-y: auto;
		z-index: 5;
	}

	.slash-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		background: transparent;
		border: none;
		border-radius: 6px;
		font: 500 13px var(--font-sans);
		color: var(--fg-1);
		cursor: pointer;
		text-align: left;
	}

	.slash-item:hover {
		background: var(--paper-1);
	}

	.slash-item :global(code) {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--accent);
		background: var(--accent-soft);
		padding: 1px 6px;
		border-radius: 4px;
	}

	.slash-item code {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--accent);
		background: var(--accent-soft);
		padding: 1px 6px;
		border-radius: 4px;
	}

	.slash-item .hint {
		font-weight: 400;
		color: var(--fg-3);
	}
</style>
