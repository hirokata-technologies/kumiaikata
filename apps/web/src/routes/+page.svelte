<script lang="ts">
	import { Sparkles } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import type { BoardState, GroupBy, MemberInfo } from '$lib/types.js';
	import type { Workspace } from '$lib/components/kata/WorkspaceSwitcher.svelte';
	import { getPersonalBoard, getTeamBoard, getMyTeam, listTeamMembers, listLabels, listProjects, subscribeBoard, ApiError, wasClientOp } from '$lib/api';
	import type { TeamInfo } from '$lib/api';
	import {
		toLocalColumns,
		applyColumnCreated,
		applyColumnUpdated,
		applyColumnDeleted,
		applyCardCreated,
		applyCardUpdated,
		applyCardMoved,
		applyCardDeleted,
		applyColumnsReordered,
		applyCardsReordered,
		applyCardLabelChange,
		applyCardAssigneeChange,
		applyLabelCreated,
		applyLabelUpdated,
		applyLabelDeleted,
		applyProjectCreated,
		applyProjectUpdated,
		applyProjectDeleted,
	} from '$lib/api/adapters.js';
	import TopBar from '$lib/components/kata/TopBar.svelte';
	import ViewBar from '$lib/components/kata/ViewBar.svelte';
	import KanbanBoard from '$lib/components/kata/KanbanBoard.svelte';
	import ChatPanel from '$lib/components/kata/ChatPanel.svelte';
	import CardModal from '$lib/components/kata/CardModal.svelte';
	import { settings, setDensity, setChatPlacement, toggleTheme } from '$lib/settings.svelte.js';
	import {
		readWorkspace, writeWorkspace,
		readContext, writeProjectFilter, writeGroupBy,
		type WorkspaceId,
	} from '$lib/workspace.svelte.js';

	let { data } = $props();

	type CurrentUser = { name?: string | null; email: string; image?: string | null } | null;
	let currentUser = $state<CurrentUser>(untrack(() => data?.user ? { name: data.user.name, email: data.user.email, image: data.user.image } : null));

	let boardState: BoardState = $state({ columns: [], labels: [], projects: [] });
	let boardId: string | null = $state(null);
	let boardMembers = $state<MemberInfo[]>([]);
	let membersLoading = $state(false);
	let membersError = $state(false);
	let loading = $state(true);
	let loadError: string | null = $state(null);
	let teamInfo = $state<TeamInfo | null>(null);
	let loadSeq = 0; // plain counter; does NOT need to be reactive

	let query = $state('');
	let openCardId: string | null = $state(null);
	let chatVisible = $state(true);
	let chatInput = $state('');
	let glowIds: Set<string> = $state(new Set());

	const initialWorkspace = readWorkspace();
	const initialContext = readContext(initialWorkspace);

	let groupBy = $state<GroupBy>(initialContext.groupBy);
	let activeProjectId = $state<string | null>(initialContext.activeProjectId);
	let fallbackMessage = $state<string | null>(null);

	/** Per-project card counts + unassigned count, used by ViewBar chips */
	const projectCounts = $derived.by(() => {
		const counts: Record<string, number> = { __none: 0 };
		for (const col of boardState.columns) {
			for (const card of col.cards) {
				if (card.projectId) {
					counts[card.projectId] = (counts[card.projectId] ?? 0) + 1;
				} else {
					counts['__none'] = (counts['__none'] ?? 0) + 1;
				}
			}
		}
		return counts;
	});

	const totalCount = $derived(boardState.columns.reduce((n, c) => n + c.cards.length, 0));

	let workspaceId = $state<WorkspaceId>(initialWorkspace);

	const workspaces: Workspace[] = $derived([
		{ id: 'personal', name: 'Personal', hint: 'Just for you', icon: 'user' },
		{
			id: 'team',
			name: teamInfo?.name ?? 'Team',
			hint: teamInfo?.domain ?? '',
			icon: 'users',
		},
	]);

	const workspace = $derived(workspaces.find((w) => w.id === workspaceId) ?? workspaces[0]);

	let restoringTeam = false; // plain flag, not reactive

	function selfMember(): MemberInfo | null {
		const u = data?.user;
		if (!u) return null;
		return { id: u.id, name: (u.name?.trim()) || u.email || 'User', email: u.email, imageUrl: u.image ?? null };
	}

	async function loadMembers(kind: 'personal' | 'team', teamId: string | undefined, seq: number) {
		if (kind === 'personal') {
			const self = selfMember();
			if (seq === loadSeq) { boardMembers = self ? [self] : []; membersError = false; membersLoading = false; }
			return;
		}
		// team board
		const tid = teamId ?? teamInfo?.id;
		if (!tid) {
			if (seq === loadSeq) { boardMembers = []; membersError = true; membersLoading = false; }
			return;
		}
		if (seq === loadSeq) { membersLoading = true; membersError = false; }
		try {
			const rows = await listTeamMembers(tid);
			if (seq !== loadSeq) return;
			boardMembers = rows.map((r) => ({
				id: r.userId,
				name: (r.name?.trim()) || r.email || 'User',
				email: r.email ?? '',
				imageUrl: r.imageUrl,
			}));
			membersError = false;
		} catch {
			if (seq !== loadSeq) return;
			boardMembers = [];
			membersError = true;
		} finally {
			if (seq === loadSeq) membersLoading = false;
		}
	}

	async function loadBoard(kind: 'personal' | 'team' = workspaceId) {
		const seq = ++loadSeq;
		loading = true;
		loadError = null;
		boardMembers = [];
		membersError = false;
		try {
			const api = kind === 'team' ? await getTeamBoard() : await getPersonalBoard();
			if (seq !== loadSeq) return; // superseded — abandon
			const [columns, labels, projects] = await Promise.all([
				Promise.resolve(toLocalColumns(api)),
				listLabels(api.id),
				listProjects(api.id),
			]);
			if (seq !== loadSeq) return; // superseded after the second await
			boardId = api.id;
			const mappedProjects = projects.map((p) => ({ id: p.id, name: p.name, color: p.color }));
			boardState = {
				columns,
				labels: labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
				projects: mappedProjects,
			};
			// Clear restoringTeam flag on successful team load so later 404s don't auto-fallback
			if (kind === 'team') restoringTeam = false;
			// Validate restored activeProjectId against loaded projects (US-3 AC-5)
			if (activeProjectId && activeProjectId !== '__none') {
				const exists = mappedProjects.some((p) => p.id === activeProjectId);
				if (!exists) activeProjectId = null; // stale filter cleared
			}
			// Load member list for the board (personal = self only, team = API call)
			loadMembers(kind, api.teamId, seq);
		} catch (err) {
			if (seq !== loadSeq) return; // superseded — don't show a stale error
			const e = err instanceof ApiError ? err : null;
			if (kind === 'team' && e?.status === 404) {
				if (restoringTeam) {
					restoringTeam = false; // consume the flag (no repeat)
					workspaceId = 'personal';
					writeWorkspace('personal'); // US-4 AC-2 — don't repeat fallback next load
					const ctx = readContext('personal');
					groupBy = ctx.groupBy;
					activeProjectId = ctx.activeProjectId;
					fallbackMessage = 'Team workspace not available — opened Personal instead';
					loadBoard('personal'); // bumps loadSeq; banner shows once personal is ready
					return; // do not set loadError for the fallback path
				}
				loadError = 'Team board not found';
			} else {
				loadError = e?.message ?? (err instanceof Error ? err.message : 'Failed to load board');
			}
		} finally {
			if (seq === loadSeq) loading = false;
		}
	}

	function handleSelectWorkspace(id: string) {
		if (id !== 'personal' && id !== 'team') return;
		if (id === workspaceId) return; // no-op: no write (US-2 AC-3)
		openCardId = null; // close any open card modal
		writeWorkspace(id); // US-2 AC-1/2 — write before fetch begins
		const ctx = readContext(id); // incoming workspace context (US-3 AC-4)
		groupBy = ctx.groupBy;
		activeProjectId = ctx.activeProjectId; // may be null; validated after board loads
		workspaceId = id;
		loadBoard(id);
	}

	const pageTitle = $derived(
		workspaceId === 'team'
			? `Kata — ${teamInfo?.name ?? 'Team'}`
			: 'Kata — Personal board',
	);

	let mounted = $state(false);
	$effect(() => {
		if (mounted) return;
		mounted = true;
		if (workspaceId === 'team') restoringTeam = true;
		loadBoard(workspaceId);
		getMyTeam()
			.then((info) => { teamInfo = info; })
			.catch(() => { teamInfo = null; }); // fall back to "Team" label, stay usable
	});

	// Auto-dismiss fallback banner after 5 seconds
	$effect(() => {
		if (!fallbackMessage) return;
		const t = setTimeout(() => { fallbackMessage = null; }, 5000);
		return () => clearTimeout(t);
	});

	$effect(() => {
		if (!boardId) return;
		const unsubscribe = subscribeBoard(boardId, (ev) => {
			const { type, data } = ev;
			const cols = boardState.columns;
			let next = cols;
			let next_projects = boardState.projects;
			switch (type) {
				case 'column.created':
					next = applyColumnCreated(cols, data as { id: string; title: string; position: string });
					break;
				case 'column.updated':
					next = applyColumnUpdated(cols, data as { id: string; title: string });
					break;
				case 'column.deleted':
					next = applyColumnDeleted(cols, data as { id: string });
					break;
				case 'columns.reordered':
					next = applyColumnsReordered(cols, data as { orderedIds: string[] });
					break;
				case 'card.created': {
					const d = data as { id: string; columnId: string; title: string };
					if (wasClientOp(`create:${d.id}`)) return;
					next = applyCardCreated(cols, d);
					break;
				}
				case 'card.updated': {
					const d = data as { id: string; title?: string; dueDate?: string | null; projectId?: string | null };
					if (wasClientOp(`update:${d.id}`)) return;
					next = applyCardUpdated(cols, d);
					break;
				}
				case 'card.moved': {
					const d = data as { id: string; columnId: string; position: string };
					if (wasClientOp(`move:${d.id}`)) return;
					next = applyCardMoved(cols, d);
					break;
				}
				case 'card.deleted': {
					const d = data as { id: string };
					if (wasClientOp(`delete:${d.id}`)) return;
					next = applyCardDeleted(cols, d);
					break;
				}
				case 'cards.reordered':
					next = applyCardsReordered(
						cols,
						data as { columnId: string; orderedIds: string[] },
					);
					break;
				case 'card.label.added':
					next = applyCardLabelChange(
						cols,
						{ ...(data as { cardId: string; labelId: string }), op: 'add' },
					);
					break;
				case 'card.label.removed':
					next = applyCardLabelChange(
						cols,
						{ ...(data as { cardId: string; labelId: string }), op: 'remove' },
					);
					break;
				case 'card.assignee.added': {
					const d = data as { cardId: string; userId: string };
					if (wasClientOp(`assignee:${d.cardId}:${d.userId}`)) return;
					next = applyCardAssigneeChange(cols, { ...d, op: 'add' });
					break;
				}
				case 'card.assignee.removed': {
					const d = data as { cardId: string; userId: string };
					if (wasClientOp(`assignee:${d.cardId}:${d.userId}`)) return;
					next = applyCardAssigneeChange(cols, { ...d, op: 'remove' });
					break;
				}
				case 'label.created':
					boardState = { ...boardState, labels: applyLabelCreated(boardState.labels, data as { id: string; name: string; color: string }) };
					return;
				case 'label.updated':
					boardState = { ...boardState, labels: applyLabelUpdated(boardState.labels, data as { id: string; name?: string; color?: string }) };
					return;
				case 'label.deleted':
					boardState = { ...boardState, labels: applyLabelDeleted(boardState.labels, data as { id: string }) };
					return;
				case 'project.created':
					next_projects = applyProjectCreated(boardState.projects, data as { id: string; name: string; color: string });
					break;
				case 'project.updated':
					next_projects = applyProjectUpdated(boardState.projects, data as { id: string; name?: string; color?: string });
					break;
				case 'project.deleted':
					next_projects = applyProjectDeleted(boardState.projects, data as { id: string });
					break;
				default:
					return;
			}
			const colsChanged = next !== cols;
			const projectsChanged = next_projects !== boardState.projects;
			if (colsChanged || projectsChanged) {
				boardState = {
					...boardState,
					...(colsChanged && { columns: next }),
					...(projectsChanged && { projects: next_projects }),
				};
			}
		});
		return unsubscribe;
	});

	// Apply theme to document; enable cross-theme transitions after first paint
	$effect(() => {
		document.documentElement.dataset.theme = settings.theme;
		requestAnimationFrame(() => {
			document.documentElement.classList.add('theme-ready');
		});
	});

	// Apply accent color
	$effect(() => {
		document.documentElement.style.setProperty('--accent', settings.accent);
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
		chatInput = prefix;
		chatVisible = true;
	}

	function togglePlacement() {
		setChatPlacement(settings.chatPlacement === 'side' ? 'floating' : 'side');
	}
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content="Kata Kanban board" />
</svelte:head>

<div class="shell" class:has-chat={chatVisible}>
	{#if fallbackMessage}
		<div class="ws-fallback-banner" role="status" aria-live="polite">
			<span>{fallbackMessage}</span>
			<button class="ws-fallback-close" aria-label="Dismiss" onclick={() => (fallbackMessage = null)}>×</button>
		</div>
	{/if}

	<TopBar
		{query}
		onquery={(q) => (query = q)}
		density={settings.density}
		ondensity={(d) => setDensity(d as import('$lib/settings.svelte.js').Density)}
		{chatVisible}
		onOpenChat={() => (chatVisible = true)}
		chatPlacement={settings.chatPlacement}
		isDark={settings.theme === 'dark'}
		ontoggle={toggleTheme}
		{workspace}
		{workspaces}
		onselectworkspace={handleSelectWorkspace}
		user={currentUser}
		onUserUpdate={(patch) => { currentUser = currentUser ? { ...currentUser, ...patch } : currentUser; }}
	/>

	{#if !loading && !loadError}
		<ViewBar
			{groupBy}
			{activeProjectId}
			boardProjects={boardState.projects}
			{projectCounts}
			{totalCount}
			ongroupby={(g) => {
				groupBy = g;
				activeProjectId = null;
				writeGroupBy(workspaceId, g);
				writeProjectFilter(workspaceId, null);
			}}
			onprojectfilter={(pid) => {
				activeProjectId = pid;
				writeProjectFilter(workspaceId, pid);
			}}
		/>
	{/if}

	{#if loading}
		<main class="main main-loading">
			<p class="loading-message">Loading board…</p>
		</main>
	{:else if loadError}
		<main class="main main-error">
			<div class="error-banner">
				<p class="error-message">{loadError}</p>
				<button class="retry-btn" onclick={() => loadBoard()}>Retry</button>
			</div>
		</main>
	{:else}
		<main class="main">
			<KanbanBoard
				boardId={boardId ?? ''}
				state={boardState}
				density={settings.density}
				{query}
				columnStyle={settings.columnStyle}
				showMist={settings.mist}
				glowCardIds={glowIds}
				boardLabels={boardState.labels}
				boardProjects={boardState.projects}
				{boardMembers}
				{groupBy}
				{activeProjectId}
				onCardOpen={(id) => (openCardId = id)}
				onStateChange={(s) => (boardState = s)}
				onclearfilter={() => { activeProjectId = null; writeProjectFilter(workspaceId, null); }}
			/>

			{#if chatVisible && settings.chatPlacement === 'side'}
				<ChatPanel
					boardState={boardState}
					placement="side"
					chatInput={chatInput}
					onChatInputChange={(v) => (chatInput = v)}
					onClose={() => (chatVisible = false)}
					onTogglePlacement={togglePlacement}
				/>
			{/if}
		</main>

		{#if settings.chatPlacement === 'floating'}
			{#if chatVisible}
				<div class="floating-chat">
					<ChatPanel
						boardState={boardState}
						placement="floating"
						chatInput={chatInput}
						onChatInputChange={(v) => (chatInput = v)}
						onClose={() => (chatVisible = false)}
						onTogglePlacement={togglePlacement}
					/>
				</div>
			{:else}
				<button
					class="chat-fab"
					onclick={() => (chatVisible = true)}
					aria-label="Open assistant"
					title="Open assistant"
				>
					<Sparkles size={22} />
				</button>
			{/if}
		{/if}

		{#if chatVisible && settings.chatPlacement === 'overlay'}
			<div
				class="overlay-chat-scrim"
				onclick={() => (chatVisible = false)}
				onkeydown={(e) => {
					if (e.key === 'Escape') chatVisible = false;
				}}
				role="dialog"
				aria-modal="true"
				aria-label="Assistant chat"
				tabindex="-1"
			>
				<div class="overlay-chat" onclick={(e) => e.stopPropagation()} role="presentation">
					<ChatPanel
						boardState={boardState}
						placement="overlay"
						chatInput={chatInput}
						onChatInputChange={(v) => (chatInput = v)}
						onClose={() => (chatVisible = false)}
					/>
				</div>
			</div>
		{/if}

		{#if openCardId}
			<CardModal
				boardId={boardId ?? ''}
				cardId={openCardId}
				state={boardState}
				onClose={() => (openCardId = null)}
				onAsk={handleAsk}
				onStateChange={(s) => (boardState = s)}
				{boardMembers}
				{membersLoading}
				{membersError}
			/>
		{/if}
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

	.main-loading {
		align-items: center;
		justify-content: center;
	}

	.loading-message {
		color: var(--fg-1);
		font-size: 0.9rem;
		opacity: 0.65;
	}

	.main-error {
		align-items: center;
		justify-content: center;
	}

	.error-banner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 24px 32px;
		background: var(--paper-1);
		border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
		border-radius: 12px;
	}

	.error-message {
		color: var(--fg-1);
		font-size: 0.875rem;
		text-align: center;
		margin: 0;
	}

	.retry-btn {
		padding: 6px 18px;
		background: var(--accent);
		color: #fff;
		border: none;
		border-radius: 6px;
		font-size: 0.875rem;
		cursor: pointer;
	}

	.retry-btn:hover {
		opacity: 0.88;
	}

	.chat-fab {
		position: fixed;
		bottom: 24px;
		right: 24px;
		z-index: 30;
		width: 52px;
		height: 52px;
		border-radius: 999px;
		background: var(--ink-0);
		color: var(--paper-0);
		border: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: var(--shadow-lg);
		transition: background var(--dur-fast), transform var(--dur-fast);
	}

	.chat-fab:hover {
		background: var(--accent);
		transform: scale(1.06);
	}

	.chat-fab :global(svg) {
		flex-shrink: 0;
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
		from {
			transform: translateY(8px);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}

	.overlay-chat :global(.chat) {
		width: 100%;
		border-left: none;
	}

	.ws-fallback-banner {
		position: fixed;
		top: 12px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 50;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 16px;
		background: var(--paper-0);
		border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
		border-radius: 8px;
		box-shadow: var(--shadow-lg);
		font-size: 0.875rem;
		color: var(--fg-1);
		max-width: calc(100vw - 32px);
	}

	.ws-fallback-close {
		flex-shrink: 0;
		background: none;
		border: none;
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		color: var(--fg-2, var(--fg-1));
		padding: 0 2px;
	}

	.ws-fallback-close:hover {
		color: var(--fg-0, var(--fg-1));
	}
</style>
