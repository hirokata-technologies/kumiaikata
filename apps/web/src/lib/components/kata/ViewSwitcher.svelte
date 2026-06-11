<script lang="ts">
	import { Columns3, CalendarRange, ChevronDown, Check } from '@lucide/svelte';

	export type BoardView = 'board' | 'roadmap';

	let {
		view,
		onselectview,
	}: {
		view: BoardView;
		onselectview: (v: BoardView) => void;
	} = $props();

	const VIEWS: { id: BoardView; name: string; hint: string }[] = [
		{ id: 'board', name: 'Board', hint: 'Kanban columns' },
		{ id: 'roadmap', name: 'Roadmap', hint: 'Timeline by due date' },
	];

	const current = $derived(VIEWS.find((v) => v.id === view) ?? VIEWS[0]);

	let open = $state(false);
	let wrapRef: HTMLElement | null = $state(null);

	$effect(() => {
		if (!open) return;
		function onPointerDown(e: PointerEvent) {
			if (!wrapRef || !wrapRef.contains(e.target as Node)) open = false;
		}
		function onKeydown(e: KeyboardEvent) {
			if (e.key === 'Escape') open = false;
		}
		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKeydown);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeydown);
		};
	});

	function select(id: BoardView) {
		onselectview(id);
		open = false;
	}
</script>

{#snippet viewIcon(id: BoardView)}
	{#if id === 'board'}
		<Columns3 size={15} />
	{:else}
		<CalendarRange size={15} />
	{/if}
{/snippet}

<div class="vs-wrap" bind:this={wrapRef}>
	<button
		class="vs-btn"
		class:is-open={open}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-label="Switch view"
		onclick={() => (open = !open)}
	>
		<span class="vs-icon">{@render viewIcon(current.id)}</span>
		<span class="vs-name">{current.name}</span>
		<span class="vs-chev"><ChevronDown size={14} /></span>
	</button>

	{#if open}
		<div class="vs-menu" role="menu">
			<div class="vs-menu-label">View as</div>
			{#each VIEWS as v (v.id)}
				{@const active = v.id === view}
				<button
					role="menuitem"
					class="vs-menu-item"
					class:is-active={active}
					onclick={() => select(v.id)}
				>
					<span class="vs-menu-icon" class:is-active={active}>{@render viewIcon(v.id)}</span>
					<span class="vs-menu-meta">
						<span class="vs-menu-name">{v.name}</span>
						<span class="vs-menu-hint">{v.hint}</span>
					</span>
					{#if active}<span class="vs-menu-check"><Check size={15} /></span>{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.vs-wrap { position: relative; }

	.vs-btn {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 7px 9px 7px 8px;
		background: var(--paper-0);
		border: 1px solid var(--line-3);
		border-radius: 8px;
		cursor: pointer;
		color: var(--fg-1);
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}
	.vs-btn:hover { background: var(--paper-1); }
	.vs-btn.is-open { background: var(--paper-1); border-color: var(--line-3); }

	.vs-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--fg-2);
		flex: 0 0 auto;
	}
	.vs-icon :global(svg) { width: 15px; height: 15px; }

	.vs-name {
		font: 500 14px var(--font-sans);
		color: var(--fg-1);
		white-space: nowrap;
	}

	.vs-chev { display: inline-flex; flex: 0 0 auto; }
	.vs-chev :global(svg) { width: 14px; height: 14px; color: var(--fg-3); }

	.vs-menu {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		min-width: 240px;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		padding: 6px;
		z-index: 50;
		animation: vs-menu-in 140ms var(--ease-out);
	}
	@keyframes vs-menu-in {
		from { opacity: 0; transform: translateY(-4px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.vs-menu-label {
		font: 600 10px var(--font-sans);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--fg-4);
		padding: 6px 8px 8px;
	}

	.vs-menu-item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px;
		border: 0;
		background: transparent;
		color: var(--fg-2);
		text-align: left;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background var(--dur-fast);
	}
	.vs-menu-item:hover { background: var(--paper-2); }
	.vs-menu-item.is-active { background: var(--accent-soft); }

	.vs-menu-icon {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		background: var(--paper-2);
		color: var(--fg-2);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
	}
	.vs-menu-icon.is-active { background: var(--accent); color: var(--paper-0); }
	.vs-menu-icon :global(svg) { width: 15px; height: 15px; }

	.vs-menu-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
	.vs-menu-name { font: 600 13px var(--font-sans); color: var(--fg-1); line-height: 1.2; }
	.vs-menu-hint { font: 400 12px var(--font-sans); color: var(--fg-3); line-height: 1.3; }

	.vs-menu-check { display: inline-flex; flex: 0 0 auto; color: var(--accent); }
	.vs-menu-check :global(svg) { width: 15px; height: 15px; }
</style>
