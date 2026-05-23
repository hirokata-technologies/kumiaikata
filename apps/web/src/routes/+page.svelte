<script lang="ts">
	import { deepCloneColumns, SEED_COLUMNS } from '$lib/data.js';
	import type { BoardState } from '$lib/types.js';
	import TopBar from '$lib/components/kata/TopBar.svelte';
	import KanbanBoard from '$lib/components/kata/KanbanBoard.svelte';
	import ChatPanel from '$lib/components/kata/ChatPanel.svelte';
	import CardModal from '$lib/components/kata/CardModal.svelte';

	let boardState: BoardState = $state({ columns: deepCloneColumns(SEED_COLUMNS) });
	let query = $state('');
	let openCardId: string | null = $state(null);
	let chatVisible = $state(true);
	let glowIds: Set<string> = $state(new Set());
	let dark = $state(false);
	let accent = $state('#2E3A6B');
	let mist = $state(true);
	let density = $state('comfortable');
	let chat_placement = $state('side');
	let column_style = $state('tray');

	// Apply dark theme to document
	$effect(() => {
		document.documentElement.dataset.theme = dark ? 'dark' : 'light';
	});

	// Apply accent color
	$effect(() => {
		document.documentElement.style.setProperty('--accent', accent);
	});

	// Listen for glow events from chat panel
	$effect(() => {
		function onGlow(e: Event) {
			const ce = e as CustomEvent<{ ids: string[] }>;
			const ids = ce.detail?.ids ?? [];
			glowIds = new Set(ids);
			setTimeout(() => {
				glowIds = new Set();
			}, 1500);
		}
		window.addEventListener('hk-glow', onGlow);
		return () => window.removeEventListener('hk-glow', onGlow);
	});

	function handleAsk(prefix: string) {
		openCardId = null;
		chatVisible = true;
		// We can't directly focus the textarea in ChatPanel from here
		// The ChatPanel will handle focus internally
	}
</script>

<svelte:head>
	<title>Kata — Personal board</title>
	<meta name="description" content="Kata personal Kanban board" />
</svelte:head>

<div class="shell" class:has-chat={chatVisible}>
	<TopBar
		{query}
		onquery={(q) => (query = q)}
		{density}
		ondensity={(d) => (density = d)}
		{chatVisible}
		onOpenChat={() => (chatVisible = true)}
	/>

	<main class="main">
		<KanbanBoard
			state={boardState}
			{density}
			{query}
			columnStyle={column_style}
			showMist={mist}
			glowCardIds={glowIds}
			onCardOpen={(id) => (openCardId = id)}
			onStateChange={(s) => (boardState = s)}
		/>

		{#if chatVisible && chat_placement === 'side'}
			<ChatPanel
				boardState={boardState}
				selectedCardId={openCardId}
				placement="side"
				onClose={() => (chatVisible = false)}
				onStateChange={(s) => (boardState = s)}
			/>
		{/if}
	</main>

	{#if chatVisible && chat_placement === 'floating'}
		<div class="floating-chat">
			<ChatPanel
				boardState={boardState}
				selectedCardId={openCardId}
				placement="floating"
				onClose={() => (chatVisible = false)}
				onStateChange={(s) => (boardState = s)}
			/>
		</div>
	{/if}

	{#if chatVisible && chat_placement === 'overlay'}
		<div
			class="overlay-chat-scrim"
			onclick={() => (chatVisible = false)}
			onkeydown={(e) => { if (e.key === 'Escape') chatVisible = false; }}
			role="dialog"
			aria-modal="true"
			aria-label="Assistant chat"
			tabindex="-1"
		>
			<div class="overlay-chat" onclick={(e) => e.stopPropagation()} role="presentation">
				<ChatPanel
					boardState={boardState}
					selectedCardId={openCardId}
					placement="overlay"
					onClose={() => (chatVisible = false)}
					onStateChange={(s) => (boardState = s)}
				/>
			</div>
		</div>
	{/if}

	{#if openCardId}
		<CardModal
			cardId={openCardId}
			state={boardState}
			onClose={() => (openCardId = null)}
			onAsk={handleAsk}
			onStateChange={(s) => (boardState = s)}
		/>
	{/if}
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: var(--paper-1);
		overflow: hidden;
	}

	.main {
		flex: 1;
		display: flex;
		min-height: 0;
		min-width: 0;
	}

	.floating-chat {
		position: fixed;
		bottom: 24px;
		right: 24px;
		z-index: 30;
		width: 380px;
		height: 580px;
		max-height: calc(100vh - 48px);
		background: var(--paper-0);
		border: 1px solid var(--line-2);
		border-radius: 16px;
		box-shadow: var(--shadow-lg);
		overflow: hidden;
		display: flex;
	}

	.floating-chat :global(.chat) {
		width: 100%;
		border-left: none;
	}

	.overlay-chat-scrim {
		position: fixed;
		inset: 0;
		background: rgba(20, 19, 15, 0.45);
		backdrop-filter: blur(6px);
		z-index: 40;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 32px;
	}

	.overlay-chat {
		width: min(680px, 100%);
		height: min(780px, 100%);
		background: var(--paper-0);
		border-radius: 18px;
		box-shadow: var(--shadow-lg);
		display: flex;
		overflow: hidden;
		animation: overlay-in 220ms ease-out;
	}

	@keyframes overlay-in {
		from { transform: translateY(8px); opacity: 0; }
		to { transform: none; opacity: 1; }
	}

	.overlay-chat :global(.chat) {
		width: 100%;
		border-left: none;
	}
</style>
