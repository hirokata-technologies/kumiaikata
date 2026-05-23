<script lang="ts">
	import type { KataCard } from '$lib/types.js';
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
		onopen: (id: string) => void;
		ondragstart: (e: DragEvent, card: KataCard, colId: string) => void;
		ondragend: () => void;
	} = $props();

	const matches = $derived(() => {
		if (!query) return true;
		const q = query.toLowerCase();
		if (card.title.toLowerCase().includes(q)) return true;
		if (card.desc && card.desc.toLowerCase().includes(q)) return true;
		if (card.labels.some(l => l.toLowerCase().includes(q))) return true;
		return false;
	});
</script>

<div
	class="kc {density}"
	class:is-dragging={dragging}
	class:is-glow={glow}
	class:is-dim={!matches()}
	class:kc-flat={columnStyle === 'flat'}
	draggable={true}
	role="button"
	tabindex="0"
	onclick={() => onopen(card.id)}
	onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onopen(card.id); } }}
	ondragstart={(e) => ondragstart(e, card, columnId)}
	ondragend={() => ondragend()}
>
	<div class="kc-title">{card.title}</div>

	{#if card.desc && density !== 'compact'}
		<div class="kc-desc">{card.desc}</div>
	{/if}

	<div class="kc-meta">
		<div class="kc-labels">
			{#if card.due || columnId === 'done'}
				<DueBadge iso={card.due} done={columnId === 'done'} />
			{/if}
			{#each card.labels as labelId (labelId)}
				<LabelChip id={labelId} />
			{/each}
		</div>
		{#if card.assignee}
			<AvatarChip id={card.assignee} />
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
