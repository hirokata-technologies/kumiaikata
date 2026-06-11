<script lang="ts">
	import { Search, X, Sparkles } from '@lucide/svelte';
	import MeMenu from './MeMenu.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import WorkspaceSwitcher from './WorkspaceSwitcher.svelte';
	import type { Workspace } from './WorkspaceSwitcher.svelte';
	import ViewSwitcher from './ViewSwitcher.svelte';
	import type { BoardView } from './ViewSwitcher.svelte';

	let {
		query,
		onquery,
		density,
		ondensity,
		chatVisible,
		onOpenChat,
		chatPlacement = 'side',
		isDark = false,
		ontoggle,
		workspace,
		workspaces,
		onselectworkspace,
		view = 'board',
		onselectview,
		user,
		onUserUpdate
	}: {
		query: string;
		onquery: (q: string) => void;
		density: string;
		ondensity: (d: string) => void;
		chatVisible: boolean;
		onOpenChat: () => void;
		chatPlacement?: string;
		isDark?: boolean;
		ontoggle?: () => void;
		workspace: Workspace;
		workspaces: Workspace[];
		onselectworkspace: (id: string) => void;
		view?: BoardView;
		onselectview?: (v: BoardView) => void;
		user?: { name?: string | null; email: string; image?: string | null } | null;
		onUserUpdate?: (patch: { name?: string | null; image?: string | null }) => void;
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
			</div>
		</a>
		<span class="topbar-sep" aria-hidden="true"></span>
		<WorkspaceSwitcher {workspace} {workspaces} {onselectworkspace} />
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
		{#if onselectview}
			<ViewSwitcher {view} {onselectview} />
			<span class="topbar-sep" aria-hidden="true"></span>
		{/if}

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

		{#if !chatVisible && chatPlacement !== 'floating'}
			<button class="hkb hkb-secondary" onclick={onOpenChat}>
				<Sparkles class="hkb-i" size={16} />
				Assistant
			</button>
		{/if}

		{#if ontoggle}
			<ThemeToggle {isDark} ontoggle={ontoggle} />
		{/if}

		<MeMenu {user} {onUserUpdate} />
	</div>
</header>

<style>
	.topbar {
		display: flex;
		align-items: center;
		gap: 24px;
		padding: 12px 20px;
		background: rgba(251, 250, 246, 0.85);
		backdrop-filter: saturate(140%) blur(12px);
		-webkit-backdrop-filter: saturate(140%) blur(12px);
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
		flex: 0 0 auto;
	}

	.topbar-c {
		display: flex;
		justify-content: center;
		min-width: 0;
		flex: 1 1 auto;
	}

	.topbar-c .search {
		width: 100%;
		max-width: 480px;
	}

	.topbar-r {
		display: flex;
		align-items: center;
		gap: 10px;
		justify-content: flex-end;
		flex: 0 0 auto;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--fg-1);
		text-decoration: none;
		flex-shrink: 0;
	}

	.brand-mark {
		width: 32px;
		height: 32px;
		border-radius: 999px;
		background: var(--ink-0);
	}

	:global([data-theme="dark"]) .brand-mark {
		background: transparent;
		filter: invert(1) hue-rotate(180deg);
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

	.topbar-sep {
		width: 1px;
		height: 22px;
		background: var(--line-2);
		flex-shrink: 0;
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

	.search > :global(svg) {
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
