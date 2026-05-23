<script lang="ts">
	import { Search, X, Sparkles } from 'lucide-svelte';

	let {
		query,
		onquery,
		density,
		ondensity,
		chatVisible,
		onOpenChat
	}: {
		query: string;
		onquery: (q: string) => void;
		density: string;
		ondensity: (d: string) => void;
		chatVisible: boolean;
		onOpenChat: () => void;
	} = $props();

	let searchRef: HTMLInputElement | null = $state(null);

	$effect(() => {
		function onKeydown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault();
				searchRef?.focus();
				searchRef?.select();
			}
		}
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	const densityLabels: Record<string, string> = {
		compact: 'Compact',
		comfortable: 'Comfy',
		spacious: 'Roomy'
	};
</script>

<header class="topbar">
	<div class="topbar-l">
		<a class="brand" href="/">
			<img class="brand-mark" src="/logo-mark.png" alt="Kata" />
			<div class="brand-text">
				<div class="brand-name">Kata</div>
				<div class="brand-sub">Personal board</div>
			</div>
		</a>
		<span class="topbar-sep" aria-hidden="true"></span>
		<div class="topbar-crumbs">
			<span class="eyebrow">Workspace</span>
			<span class="topbar-crumb">Personal</span>
		</div>
	</div>

	<div class="topbar-c">
		<div class="search" role="search">
			<Search class="search-i" size={16} aria-hidden="true" />
			<input
				type="search"
				placeholder="Find a card, label, or word…"
				value={query}
				bind:this={searchRef}
				oninput={(e) => onquery((e.currentTarget as HTMLInputElement).value)}
				aria-label="Search cards"
			/>
			{#if query}
				<button class="search-clear" onclick={() => onquery('')} aria-label="Clear search">
					<X size={14} />
				</button>
			{/if}
		</div>
	</div>

	<div class="topbar-r">
		<div class="hkbg" role="group" aria-label="Card density">
			{#each ['compact', 'comfortable', 'spacious'] as d (d)}
				<button
					class="hkbg-item"
					class:is-active={density === d}
					onclick={() => ondensity(d)}
					aria-pressed={density === d}
				>{densityLabels[d]}</button>
			{/each}
		</div>

		{#if !chatVisible}
			<button class="hkb hkb-secondary" onclick={onOpenChat}>
				<Sparkles class="hkb-i" size={16} />
				Assistant
			</button>
		{/if}

		<button class="me-avatar" aria-label="User menu">
			<span class="me-avatar-circle" aria-hidden="true">Y</span>
		</button>
	</div>
</header>

<style>
	.topbar {
		display: grid;
		grid-template-columns: 1fr minmax(260px, 480px) 1fr;
		align-items: center;
		gap: 24px;
		padding: 12px 20px;
		background: rgba(251, 250, 246, 0.85);
		backdrop-filter: saturate(140%) blur(12px);
		border-bottom: 1px solid var(--line-1);
		z-index: 5;
	}

	:global([data-theme="dark"]) .topbar {
		background: rgba(26, 24, 20, 0.85);
	}

	.topbar-l {
		display: flex;
		align-items: center;
		gap: 14px;
		min-width: 0;
	}

	.topbar-c {
		display: flex;
		justify-content: center;
	}

	.topbar-r {
		display: flex;
		align-items: center;
		gap: 10px;
		justify-content: flex-end;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--fg-1);
		text-decoration: none;
	}

	.brand-mark {
		width: 32px;
		height: 32px;
		border-radius: 999px;
		background: var(--ink-0);
	}

	.brand-text {
		line-height: 1.1;
	}

	.brand-name {
		font-family: var(--font-display);
		font-size: 18px;
		font-weight: 500;
		letter-spacing: -0.01em;
	}

	.brand-sub {
		font-size: 11px;
		color: var(--fg-3);
		letter-spacing: 0.04em;
		white-space: nowrap;
	}

	.topbar-sep {
		width: 1px;
		height: 22px;
		background: var(--line-2);
	}

	.topbar-crumbs {
		display: flex;
		flex-direction: column;
		line-height: 1.15;
		gap: 1px;
	}

	.topbar-crumb {
		font-family: var(--font-display);
		font-size: 15px;
		color: var(--fg-1);
		font-weight: 500;
	}

	.search {
		position: relative;
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 12px 7px 36px;
		background: var(--paper-2);
		border: 1px solid var(--line-1);
		border-radius: 8px;
		transition: border-color 140ms, background 140ms;
	}

	.search:focus-within {
		border-color: var(--line-3);
		background: var(--paper-0);
	}

	.search input {
		flex: 1;
		font: 400 14px var(--font-sans);
		color: var(--fg-1);
		background: transparent;
		border: none;
		outline: none;
	}

	.search input::placeholder {
		color: var(--fg-4);
	}

	/* Position the Search icon absolutely inside the search box */
	.search :global(svg) {
		position: absolute;
		left: 12px;
		color: var(--fg-3);
		pointer-events: none;
	}

	.search-clear {
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 2px;
		display: inline-flex;
		color: var(--fg-3);
		border-radius: 4px;
	}

	.search-clear:hover {
		background: var(--paper-3);
		color: var(--fg-1);
	}

	.me-avatar {
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0;
		border-radius: 999px;
	}

	.me-avatar-circle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 999px;
		background: var(--accent);
		color: var(--paper-0);
		font: 600 13px var(--font-sans);
	}

	.hkb {
		font: 500 14px/1 var(--font-sans);
		border-radius: 8px;
		border: 1px solid transparent;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 8px 14px;
		transition: all 140ms;
		white-space: nowrap;
	}

	.hkb-secondary {
		background: var(--paper-0);
		color: var(--fg-1);
		border-color: var(--line-3);
	}

	.hkb-secondary:hover {
		background: var(--paper-1);
	}

	.hkb :global(svg) {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}

	.hkbg {
		display: inline-flex;
		padding: 3px;
		background: var(--paper-1);
		border: 1px solid var(--line-1);
		border-radius: 8px;
	}

	.hkbg-item {
		font: 500 13px/1 var(--font-sans);
		padding: 6px 12px;
		border-radius: 5px;
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--fg-3);
		transition: all 140ms;
	}

	.hkbg-item:hover:not(.is-active) {
		color: var(--fg-1);
	}

	.hkbg-item.is-active {
		background: var(--paper-0);
		color: var(--ink-0);
		box-shadow: 0 1px 2px rgba(20, 19, 15, 0.06), 0 0 0 1px var(--line-1);
	}
</style>
