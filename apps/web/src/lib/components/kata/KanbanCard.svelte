<script lang="ts">
	import type { KataCard, KataLabel, KataProject, MemberInfo } from '$lib/types.js';
	import LabelChip from './LabelChip.svelte';
	import AvatarChip from './AvatarChip.svelte';
	import DueBadge from './DueBadge.svelte';

	let {
		card,
		columnId,
		density,
		query,
		dragging,
		glow,
		columnStyle,
		boardLabels,
		boardProjects,
		boardMembers,
		/** In project-group mode: the real status column id (e.g. 'backlog', 'doing', 'done') */
		statusId,
		/** In project-group mode: the human-readable status title */
		statusTitle,
		onopen,
		ondragstart,
		ondragend
	}: {
		card: KataCard;
		columnId: string;
		density: string;
		query: string;
		dragging: boolean;
		glow: boolean;
		columnStyle: string;
		boardLabels: KataLabel[];
		boardProjects: KataProject[];
		boardMembers: MemberInfo[];
		statusId?: string;
		statusTitle?: string;
		onopen: (id: string) => void;
		ondragstart: (e: DragEvent, card: KataCard, colId: string) => void;
		ondragend: () => void;
	} = $props();

	const matches = $derived(
		!query
		|| card.title.toLowerCase().includes(query.toLowerCase())
		|| (card.desc ?? '').toLowerCase().includes(query.toLowerCase())
		|| card.labels.some(labelId => {
			const label = boardLabels.find(l => l.id === labelId);
			return label ? label.name.toLowerCase().includes(query.toLowerCase()) : false;
		})
	);

	const project = $derived(card.projectId ? boardProjects.find(p => p.id === card.projectId) ?? null : null);

	// In project-group mode, show a status pill; in status mode, show the project ribbon.
	const showProjectRibbon = $derived(!statusId && !!project);
	const showStatusPill = $derived(!!statusId);

	// Effective "done" column: in status mode it's columnId; in project mode it's statusId
	const effectiveColumnId = $derived(statusId ?? columnId);

	const MAX_AVATARS = 3;

	// Build a Map once per boardMembers change for O(1) lookup per assignee.
	const memberMap = $derived(new Map(boardMembers.map((m) => [m.id, m])));

	const assignedMembers = $derived(
		card.assignees.map((uid) => memberMap.get(uid) ?? { id: uid, name: 'Unknown', email: '', imageUrl: null as string | null })
	);
	const shownMembers = $derived(assignedMembers.slice(0, MAX_AVATARS));
	const overflow = $derived(Math.max(0, assignedMembers.length - MAX_AVATARS));
</script>

<div
	class="kc {density}"
	class:is-dragging={dragging}
	class:is-glow={glow}
	class:is-dim={!matches}
	class:kc-flat={columnStyle === 'flat'}
	draggable={true}
	role="button"
	tabindex="0"
	onclick={() => onopen(card.id)}
	onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onopen(card.id); } }}
	ondragstart={(e) => ondragstart(e, card, columnId)}
	ondragend={() => ondragend()}
>
	{#if showProjectRibbon}
		<div class="kc-proj" title="In {project!.name}">
			<span class="kc-proj-dot" style="background: {project!.color};"></span>
			<span class="kc-proj-name">{project!.name}</span>
		</div>
	{/if}

	<div class="kc-title">{card.title}</div>

	{#if card.desc && density !== 'compact'}
		<div class="kc-desc">{card.desc}</div>
	{/if}

	<div class="kc-meta">
		<div class="kc-labels">
			{#if showStatusPill}
				<span class="kc-status kc-status-{statusId}">
					<span class="kc-status-dot"></span>
					{statusTitle}
				</span>
			{/if}
			{#if card.due || effectiveColumnId === 'done'}
				<DueBadge iso={card.due} done={effectiveColumnId === 'done'} />
			{/if}
			{#each card.labels as labelId (labelId)}
				{@const label = boardLabels.find(l => l.id === labelId)}
				{#if label}
					<LabelChip {label} />
				{/if}
			{/each}
		</div>
		{#if assignedMembers.length > 0}
			<div class="kc-assignees">
				{#each shownMembers as m (m.id)}
					<span class="kc-av"><AvatarChip id={m.id} name={m.name} imageUrl={m.imageUrl} size={22} /></span>
				{/each}
				{#if overflow > 0}
					<span class="kc-av kc-av-more" title="{overflow} more">+{overflow}</span>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.kc {
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: 10px;
		box-shadow: var(--shadow-sm);
		padding: 12px 14px;
		cursor: pointer;
		transition: box-shadow 140ms, border-color 140ms, transform 140ms, opacity 140ms;
		user-select: none;
		position: relative;
	}

	/* Project ribbon — colored dot + name */
	.kc-proj {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font: 500 10.5px var(--font-sans);
		color: var(--fg-3);
		margin-bottom: 4px;
		max-width: 100%;
	}

	.kc-proj-dot {
		width: 5px;
		height: 5px;
		border-radius: 999px;
		flex-shrink: 0;
	}

	.kc-proj-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.compact .kc-proj { font-size: 10px; margin-bottom: 2px; }
	.spacious .kc-proj { font-size: 11px; margin-bottom: 6px; }

	/* Status pill — shown in project-group mode */
	.kc-status {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font: 500 10.5px var(--font-sans);
		letter-spacing: -0.005em;
		padding: 2px 8px 2px 7px;
		border-radius: 999px;
		background: var(--paper-2);
		color: var(--fg-2);
		white-space: nowrap;
		border: 1px solid var(--line-1);
	}

	.kc-status-dot {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: var(--fg-3);
		flex-shrink: 0;
	}

	.kc-status-backlog .kc-status-dot { background: var(--fg-4); }
	.kc-status-todo    .kc-status-dot { background: var(--accent); }

	.kc-status-doing {
		background: rgba(176, 122, 42, 0.10);
		color: var(--warning);
		border-color: rgba(176, 122, 42, 0.22);
	}
	.kc-status-doing .kc-status-dot { background: var(--warning); }

	.kc-status-done {
		background: rgba(63, 107, 74, 0.08);
		color: var(--success);
		border-color: rgba(63, 107, 74, 0.22);
	}
	.kc-status-done .kc-status-dot { background: var(--success); }

	:global([data-theme="dark"]) .kc-status { background: rgba(244, 241, 234, 0.06); }
	:global([data-theme="dark"]) .kc-status-doing { background: rgba(176, 122, 42, 0.18); }
	:global([data-theme="dark"]) .kc-status-done {
		background: rgba(63, 107, 74, 0.18);
		color: #8EBBA0;
		border-color: rgba(63, 107, 74, 0.4);
	}

	.kc:hover {
		box-shadow: var(--shadow-md);
		border-color: var(--line-2);
	}

	.kc.is-dragging {
		opacity: 0.4;
		transform: rotate(-1deg);
	}

	.kc.is-dim {
		opacity: 0.28;
	}

	.kc.is-glow {
		animation: glow 1.4s ease-out;
	}

	@keyframes glow {
		0% { box-shadow: 0 0 0 0 var(--accent); border-color: var(--accent); }
		50% { box-shadow: 0 0 0 6px rgba(46, 58, 107, 0); border-color: var(--accent); }
		100% { box-shadow: var(--shadow-sm); border-color: var(--line-1); }
	}

	.kc-flat {
		border-radius: 0;
		border-left: none;
		border-right: none;
		border-top: none;
		box-shadow: none;
		border-bottom: 1px solid var(--line-1);
		background: transparent;
		padding: 12px 14px;
	}

	.kc-flat:hover {
		background: var(--paper-1);
		box-shadow: none;
	}

	.kc-title {
		font: 500 14px/1.4 var(--font-sans);
		color: var(--fg-1);
		letter-spacing: -0.005em;
	}

	.kc-desc {
		font-size: 12.5px;
		color: var(--fg-3);
		line-height: 1.45;
		margin-top: 6px;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.kc-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-top: 10px;
	}

	.kc-labels {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		min-width: 0;
	}

	.kc-assignees {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
	}

	.kc-av {
		margin-left: -6px;
		border-radius: 999px;
		box-shadow: 0 0 0 2px var(--paper-0);
	}

	.kc-av:first-child {
		margin-left: 0;
	}

	.kc-av-more {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		font: 600 10px var(--font-sans);
		background: var(--paper-3);
		color: var(--fg-2);
	}

	.compact {
		padding: 8px 12px;
	}

	.compact .kc-title {
		font-size: 13.5px;
	}

	.compact .kc-meta {
		margin-top: 6px;
	}

	.spacious {
		padding: 16px 18px;
	}

	.spacious .kc-title {
		font-size: 15px;
	}

	.spacious .kc-meta {
		margin-top: 14px;
	}
</style>
