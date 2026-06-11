<script lang="ts">
	import { Inbox } from '@lucide/svelte';
	import type { KataCard, KataLabel, KataProject, MemberInfo } from '$lib/types.js';
	import LabelChip from './LabelChip.svelte';
	import AvatarChip from './AvatarChip.svelte';

	let {
		cards,
		statusOf,
		statusTitleOf,
		showCompleted = true,
		query = '',
		activeProjectId = null,
		boardProjects,
		boardLabels,
		boardMembers,
		onCardOpen,
	}: {
		cards: KataCard[];
		statusOf: (cardId: string) => string | undefined;
		statusTitleOf: (columnId: string) => string;
		showCompleted?: boolean;
		query?: string;
		activeProjectId?: string | null;
		boardProjects: KataProject[];
		boardLabels: KataLabel[];
		boardMembers: MemberInfo[];
		onCardOpen?: (id: string) => void;
	} = $props();

	function isDone(cardId: string): boolean {
		const col = statusOf(cardId) ?? '';
		return col === 'done' || statusTitleOf(col).trim().toLowerCase() === 'done';
	}

	const labelMap = $derived(new Map(boardLabels.map((l) => [l.id, l])));
	const memberMap = $derived(new Map(boardMembers.map((m) => [m.id, m])));

	function matches(card: KataCard): boolean {
		if (!query) return true;
		const q = query.toLowerCase();
		return card.title.toLowerCase().includes(q)
			|| (card.desc || '').toLowerCase().includes(q)
			|| card.labels.some((l) => labelMap.get(l)?.name.toLowerCase().includes(q));
	}

	function firstAssignee(card: KataCard): MemberInfo | null {
		const id = card.assignees[0];
		if (!id) return null;
		return memberMap.get(id) ?? { id, name: 'Unknown', email: '', imageUrl: null };
	}

	const undated = $derived.by(() => {
		let list = cards.filter((c) => !c.due);
		if (!showCompleted) list = list.filter((c) => !isDone(c.id));
		return list;
	});

	type Group = { id: string; name: string; tone: string; cards: KataCard[] };
	const groups = $derived.by((): Group[] => {
		const out: Group[] = [];
		for (const p of boardProjects) {
			const list = undated.filter((c) => c.projectId === p.id);
			if (list.length) out.push({ id: p.id, name: p.name, tone: p.color, cards: list });
		}
		const orphans = undated.filter((c) => !c.projectId);
		if (orphans.length) out.push({ id: '__none', name: 'No project', tone: 'var(--fg-4)', cards: orphans });
		return out;
	});

	const visibleGroups = $derived(
		activeProjectId ? groups.filter((g) => g.id === activeProjectId) : groups,
	);
</script>

<aside class="rm-tray">
	<div class="rm-tray-head">
		<div class="rm-tray-title"><Inbox size={15} />Undated<span class="rm-tray-count">{undated.length}</span></div>
		<div class="rm-tray-sub">Tasks without a due date — schedule one to place it on the timeline.</div>
	</div>
	<div class="rm-tray-body">
		{#if visibleGroups.length === 0}
			<div class="rm-tray-empty">Nothing undated here.</div>
		{/if}
		{#each visibleGroups as g (g.id)}
			<div class="rm-tray-group">
				<div class="rm-tray-group-head"><span class="rm-tray-group-dot" style="--pc:{g.tone};"></span>{g.name}</div>
				{#each g.cards as card (card.id)}
					{@const done = isDone(card.id)}
					{@const me = firstAssignee(card)}
					<div
						class="rm-tray-card"
						class:is-done={done}
						class:is-dim={!matches(card)}
						style="--pc:{g.tone};"
						onclick={() => onCardOpen?.(card.id)}
						onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCardOpen?.(card.id); } }}
						role="button"
						tabindex="0"
					>
						<div class="rm-tray-card-title">{card.title}</div>
						<div class="rm-tray-card-meta">
							<div class="kc-labels">
								{#each card.labels.slice(0, 2) as l (l)}
									{@const lab = labelMap.get(l)}
									{#if lab}<LabelChip label={lab} />{/if}
								{/each}
							</div>
							{#if me}<AvatarChip id={me.id} name={me.name} imageUrl={me.imageUrl} size={20} />{/if}
						</div>
					</div>
				{/each}
			</div>
		{/each}
	</div>
</aside>

<style>
	.rm-tray {
		width: 264px;
		flex: 0 0 264px;
		border-left: 1px solid var(--line-2);
		background: var(--paper-0);
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.rm-tray-head {
		padding: 16px 18px 12px;
		border-bottom: 1px solid var(--line-1);
	}
	.rm-tray-title {
		display: flex;
		align-items: center;
		gap: 8px;
		font: 500 15px var(--font-display);
		color: var(--fg-1);
		letter-spacing: -0.01em;
	}
	.rm-tray-title :global(svg) { width: 15px; height: 15px; color: var(--fg-3); }
	.rm-tray-count {
		margin-left: auto;
		font: 500 11px var(--font-mono);
		color: var(--fg-3);
		background: var(--paper-2);
		padding: 1px 7px;
		border-radius: 999px;
	}
	.rm-tray-sub {
		font: 400 11.5px/1.45 var(--font-sans);
		color: var(--fg-4);
		margin-top: 5px;
	}
	.rm-tray-body {
		flex: 1;
		overflow-y: auto;
		padding: 12px 14px 18px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		scrollbar-width: thin;
		scrollbar-color: var(--line-2) transparent;
	}
	.rm-tray-body::-webkit-scrollbar { width: 7px; }
	.rm-tray-body::-webkit-scrollbar-thumb { background: var(--line-2); border-radius: 999px; }
	.rm-tray-group { display: flex; flex-direction: column; gap: 6px; }
	.rm-tray-group-head {
		display: flex;
		align-items: center;
		gap: 6px;
		font: 600 9.5px var(--font-sans);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--fg-4);
		padding: 2px 2px 1px;
	}
	.rm-tray-group-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--pc, var(--fg-4)); }
	.rm-tray-card {
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-left: 3px solid var(--pc, var(--line-2));
		border-radius: 8px;
		box-shadow: var(--shadow-sm);
		padding: 9px 11px;
		display: flex;
		flex-direction: column;
		gap: 7px;
		cursor: pointer;
		text-align: left;
		transition: box-shadow var(--dur-fast), border-color var(--dur-fast), opacity var(--dur-fast);
	}
	.rm-tray-card:hover { box-shadow: var(--shadow-md); border-color: var(--line-2); }
	.rm-tray-card.is-dim { opacity: 0.22; }
	.rm-tray-card.is-done { background: var(--paper-1); box-shadow: none; border-left-color: var(--success); }
	.rm-tray-card.is-done .rm-tray-card-title { color: var(--fg-3); text-decoration: line-through; text-decoration-color: var(--fg-4); }
	.rm-tray-card-title {
		font: 500 12.5px/1.36 var(--font-sans);
		color: var(--fg-1);
		letter-spacing: -0.005em;
		text-wrap: pretty;
	}
	.rm-tray-card-meta { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
	.kc-labels { display: flex; gap: 4px; flex-wrap: wrap; min-width: 0; }
	.rm-tray-empty {
		font: 400 12px var(--font-sans);
		font-style: italic;
		color: var(--fg-4);
		padding: 8px 2px;
	}

	@media (max-width: 900px) {
		.rm-tray { display: none; }
	}
</style>
