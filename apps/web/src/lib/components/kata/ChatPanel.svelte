<script lang="ts">
	import { tick } from 'svelte';
	import { Eraser, X, ArrowUp, Sparkles, Maximize2, Minimize2 } from '@lucide/svelte';
	import type { BoardState, ChatMessage, MessagePart } from '$lib/types.js';
	import { QUICK_REPLIES } from '$lib/data.js';
	import { serializeBoardContext, countCards } from '$lib/ai/board-context.js';

	let {
		boardState,
		placement,
		chatInput,
		onChatInputChange,
		onClose,
		onTogglePlacement,
		boardId,
		boardType
	}: {
		boardState: BoardState;
		placement: string;
		chatInput?: string;
		onChatInputChange?: (v: string) => void;
		onClose: () => void;
		onTogglePlacement?: () => void;
		boardId: string;
		boardType: 'personal' | 'team';
	} = $props();

	const GREETING: ChatMessage = {
		id: 'm-greet',
		role: 'ai',
		parts: [{ kind: 'text', streamed: true, text: "Hi — I'm here to help keep this board moving. Click **Analyze all Tasks** below to get AI-powered insights about your board." }]
	};

	let messages: ChatMessage[] = $state([GREETING]);
	let internalInput = $state('');
	let busy = $state(false);
	let scrollRef: HTMLElement | null = $state(null);
	let inputRef: HTMLTextAreaElement | null = $state(null);
	let streamingAiId = $state<string | null>(null);
	let charQueue = '';
	let charDisplayed = '';
	let flushTimerId: ReturnType<typeof setInterval> | null = null;

	// When both chatInput and onChatInputChange are provided the textarea is controlled externally.
	const controlled = $derived(chatInput !== undefined && onChatInputChange !== undefined);
	// The effective input value — either the external prop or the internal state.
	const input = $derived(controlled ? chatInput! : internalInput);

	// Derived: board has at least one card
	const boardContext = $derived(serializeBoardContext(boardState));
	const hasCards = $derived(countCards(boardContext) > 0);

	// Focus the textarea and move the caret to the end whenever a non-empty prefix arrives.
	$effect(() => {
		if (controlled && chatInput) {
			const prefix = chatInput;
			tick().then(() => {
				if (inputRef) {
					inputRef.focus();
					inputRef.setSelectionRange(prefix.length, prefix.length);
				}
			});
		}
	});

	function scrollToBottom() {
		setTimeout(() => {
			if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight;
		}, 10);
	}

	function setInput(v: string) {
		if (controlled) onChatInputChange!(v);
		else internalInput = v;
	}

	function updateAiBubble(aiId: string, text: string) {
		messages = messages.map((m) => {
			if (m.id !== aiId || !m.parts) return m;
			return {
				...m,
				parts: m.parts.map((p) => {
					if (p.kind !== 'text') return p;
					return { ...p, text };
				})
			};
		});
		scrollToBottom();
	}

	function updateAiParts(
		aiId: string,
		updater: (parts: NonNullable<ChatMessage['parts']>) => NonNullable<ChatMessage['parts']>
	) {
		messages = messages.map((m) => {
			if (m.id !== aiId || !m.parts) return m;
			return { ...m, parts: updater(m.parts!) };
		});
		scrollToBottom();
	}

	function startCharFlush(aiId: string) {
		if (flushTimerId !== null) return;
		flushTimerId = setInterval(() => {
			if (!charQueue) return;
			const batch = charQueue.slice(0, 4);
			charQueue = charQueue.slice(4);
			charDisplayed += batch;
			updateAiBubble(aiId, charDisplayed);
		}, 16);
	}

	function stopCharFlush(aiId: string) {
		if (flushTimerId !== null) {
			clearInterval(flushTimerId);
			flushTimerId = null;
		}
		if (charQueue) {
			charDisplayed += charQueue;
			charQueue = '';
			updateAiBubble(aiId, charDisplayed);
		}
	}

	async function analyze(text: string = 'Analyze all Tasks') {
		// Fix #3: Set busy synchronously before any await to prevent duplicate concurrent requests.
		if (busy || !hasCards) return;
		busy = true;

		const userMsg: ChatMessage = {
			id: `m-${Date.now()}-u`,
			role: 'user',
			text
		};

		const aiId = `m-${Date.now()}-a`;
		const aiMsg: ChatMessage = {
			id: aiId,
			role: 'ai',
			parts: [{ kind: 'text', streamed: true, text: '' }]
		};

		// Snapshot prior turns before appending the new pair — used to give the API session context.
		type HistoryTurn = { role: 'user' | 'assistant'; content: string };
		const historyForApi: HistoryTurn[] = messages
			.filter((m) => m.id !== 'm-greet')
			.flatMap((m): HistoryTurn[] => {
				if (m.role === 'user') {
					return m.text?.trim() ? [{ role: 'user', content: m.text }] : [];
				}
				const text = m.parts
					?.filter((p: MessagePart) => p.kind === 'text')
					.map((p: MessagePart) => (p.kind === 'text' ? p.text : ''))
					.join('') ?? '';
				return text.trim() ? [{ role: 'assistant', content: text }] : [];
			});

		messages = [...messages, userMsg, aiMsg];
		streamingAiId = aiId;
		charQueue = '';
		charDisplayed = '';
		scrollToBottom();

		let acc = '';
		let sawDone = false;
		let interrupted = false;

		// Fix #1: AbortController with a 60-second timeout.
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 60_000);

		try {
			const res = await fetch('/api/ai/analyze', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ board: boardContext, message: text, boardId, boardType, history: historyForApi }),
				signal: controller.signal
			});

			// Non-stream error or JSON error response
			if (!res.ok || res.headers.get('content-type')?.includes('application/json')) {
				let errMsg = 'Analysis failed. Please try again.';
				try {
					const body = await res.json();
					if (body?.error) errMsg = body.error;
				} catch {
					// ignore parse errors
				}
				updateAiBubble(aiId, errMsg);
				return;
			}

			// Fix #2: Guard against a null response body.
			if (!res.body) {
				updateAiBubble(aiId, 'Analysis failed: server returned an empty response. Please try again.');
				return;
			}

			// SSE read loop — we POSTed a body so EventSource is not an option.
			// Fix #4: Stateful line accumulator — buffer incomplete lines across chunks
			// and only parse when a complete `data: ...` line is received.
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			// `lineBuf` holds a partial line carried over from the previous chunk.
			let lineBuf = '';

			while (true) {
				const { value, done } = await reader.read();
				if (done) break;

				// Append the decoded chunk to any leftover partial line.
				lineBuf += decoder.decode(value, { stream: true });

				// Split on newlines; the last element is an incomplete (or empty) line fragment.
				const rawLines = lineBuf.split('\n');
				// Keep the trailing fragment for the next iteration.
				lineBuf = rawLines.pop() ?? '';

				for (const rawLine of rawLines) {
					const line = rawLine.trimEnd();
					// SSE: blank lines separate events — skip them.
					if (!line) continue;
					// Only handle `data:` fields.
					if (!line.startsWith('data:')) continue;

					const data = line.slice(5).trimStart();
					if (data === '[DONE]') {
						sawDone = true;
						continue;
					}
					try {
						const payload = JSON.parse(data);
						// Fix #5: Validate error field is a non-empty string before using it.
						if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
							interrupted = true;
							acc += `\n\n_${payload.error}_`;
						} else if (payload.text) {
							acc += payload.text;
							charQueue += payload.text;
							startCharFlush(aiId);
						} else if (typeof payload.tool_call === 'string') {
							updateAiParts(aiId, (parts) => [
								...parts,
								{ kind: 'tool_status', tool: payload.tool_call, status: 'calling' }
							]);
						} else if (typeof payload.tool_done === 'string') {
							updateAiParts(aiId, (parts) => {
								const idx = [...parts].reverse().findIndex(
									(p) => p.kind === 'tool_status' && p.tool === payload.tool_done && p.status === 'calling'
								);
								if (idx === -1) return parts;
								const realIdx = parts.length - 1 - idx;
								return parts.map((p, i) =>
									i === realIdx ? { ...p, status: 'done' } : p
								);
							});
						} else if (typeof payload.tool_error === 'string') {
							updateAiParts(aiId, (parts) => {
								const idx = [...parts].reverse().findIndex(
									(p) => p.kind === 'tool_status' && p.tool === payload.tool_error && p.status === 'calling'
								);
								if (idx === -1) return parts;
								const realIdx = parts.length - 1 - idx;
								return parts.map((p, i) =>
									i === realIdx ? { ...p, status: 'error' } : p
								);
							});
						}
					} catch {
						// ignore malformed frames
					}
				}
			}

			// If the stream ended without a [DONE] frame or an error frame arrived, append notice
			if (!sawDone && !interrupted) {
				acc += '\n\n_Response was cut short — the stream ended unexpectedly._';
				updateAiBubble(aiId, acc);
			} else if (interrupted && !sawDone) {
				acc += '\n\n_Response was cut short — please try again._';
				updateAiBubble(aiId, acc);
			}

			// Ensure final text is flushed
			if (acc) updateAiBubble(aiId, acc);
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				updateAiBubble(aiId, 'Analysis timed out. Please try again.');
			} else {
				const errText = err instanceof Error ? err.message : 'Network error';
				updateAiBubble(aiId, `Analysis failed: ${errText}. Please try again.`);
			}
		} finally {
			clearTimeout(timeoutId);
			stopCharFlush(aiId);
			// Flush any trailing text (errors, cut-short notices) that bypassed the queue
			if (acc) updateAiBubble(aiId, acc);
			streamingAiId = null;
			busy = false;
		}
	}

	async function send(text: string) {
		const t = text.trim();
		if (!t || busy) return;
		setInput('');
		// Route free-text through the analyze flow with the board as context
		await analyze(t);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			if (input.trim()) {
				send(input);
			} else {
				analyze();
			}
		}
	}

	function clearChat() {
		messages = [GREETING];
	}

	function applyQuickReply(value: string) {
		if (value === '__analyze__') {
			analyze();
		} else {
			setInput(value);
			setTimeout(() => inputRef?.focus(), 50);
		}
	}

	function renderMd(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;')
			.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
			.replace(/\*(.+?)\*/g, '<em>$1</em>')
			.replace(/`(.+?)`/g, '<code>$1</code>')
			.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
			.replace(/_(.+?)_/g, '<em>$1</em>')
			.replace(/\n/g, '<br/>');
	}
</script>

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
			{#if onTogglePlacement}
				<button
					class="chat-iconbtn"
					onclick={onTogglePlacement}
					title={placement === 'side' ? 'Float chat' : 'Dock to sidebar'}
				>
					{#if placement === 'side'}
						<Minimize2 size={16} />
					{:else}
						<Maximize2 size={16} />
					{/if}
				</button>
			{/if}
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
						{#if msg.id === streamingAiId && busy && !msg.parts?.some((p: MessagePart) => (p.kind === 'text' && p.text.length > 0) || p.kind === 'tool_status')}
							<div class="typing" aria-label="Thinking…">
								<span></span>
								<span></span>
								<span></span>
							</div>
						{:else if msg.parts}
							{#each msg.parts as part, partIdx (partIdx)}
								{#if part.kind === 'text'}
									<div class="msg-body">
										{@html renderMd(part.text)}
									</div>
								{:else if part.kind === 'tool_status'}
									<div class="msg-tool-status msg-tool-status-{part.status}">
										{part.tool.replace(/_/g, ' ')} {part.status === 'calling' ? '⏳' : part.status === 'done' ? '✓' : '✗'}
									</div>
								{/if}
							{/each}
						{/if}
					</div>
				</div>
			{/if}
		{/each}

		{#if busy && !streamingAiId}
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
					<button
						class="qr-chip"
						disabled={busy || (qr.value === '__analyze__' && !hasCards)}
						onclick={() => applyQuickReply(qr.value)}
					>
						{qr.label}
					</button>
				{/each}
			</div>
		{/if}

		<div class="chat-input">
			<textarea
				bind:this={inputRef}
				value={input}
				placeholder="Ask anything about the board…"
				rows={1}
				disabled={busy}
				oninput={(e) => setInput((e.currentTarget as HTMLTextAreaElement).value)}
				onkeydown={handleKeydown}
				aria-label="Chat message"
			></textarea>
			<button
				class="chat-send"
				disabled={(!input.trim() && !hasCards) || busy}
				onclick={() => (input.trim() ? send(input) : analyze())}
				aria-label="Send message"
			>
				<ArrowUp size={16} />
			</button>
		</div>

		<div class="chat-hint">
			<span>⌨ type a question</span>
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

	.qr-chip:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-soft);
	}

	.qr-chip:disabled {
		opacity: 0.4;
		cursor: default;
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

	.msg-tool-status {
		display: block;
		font-size: 12px;
		font-style: italic;
		color: var(--fg-3);
		margin-top: 4px;
	}

	.msg-tool-status-done {
		color: var(--fg-3);
	}

	.msg-tool-status-error {
		color: #e11d48;
	}
</style>
