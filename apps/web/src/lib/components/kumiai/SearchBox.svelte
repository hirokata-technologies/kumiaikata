<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';
	import { goto } from '$app/navigation';
	import { Input } from '$lib/components/ui/input/index.js';
	import { searchWorkspace } from '$lib/api';
	import type { KumiaiSearchResults } from '$lib/api/kumiai/types.js';

	const DEBOUNCE_MS = 200;

	let query = $state('');
	let results = $state<KumiaiSearchResults | null>(null);
	let loading = $state(false);
	let open = $state(false);
	let wrapRef: HTMLElement | null = $state(null);

	const hasResults = $derived(
		!!results &&
			(results.goals.length > 0 || results.projects.length > 0 || results.requirements.length > 0)
	);

	// Debounce the search call, and cancel the in-flight timer whenever `query` changes —
	// the effect's cleanup runs before every re-run and on destroy, which is what gives
	// the debounce for free.
	$effect(() => {
		const trimmed = query.trim();
		if (!trimmed) {
			results = null;
			open = false;
			return;
		}

		const handle = setTimeout(() => {
			void runSearch(trimmed);
		}, DEBOUNCE_MS);

		return () => clearTimeout(handle);
	});

	async function runSearch(q: string) {
		loading = true;
		try {
			const res = await searchWorkspace(q);
			// Stale-response guard: only apply the result if the query hasn't moved on.
			if (query.trim() !== q) return;
			results = res;
		} catch {
			results = { goals: [], projects: [], requirements: [] };
		} finally {
			loading = false;
			open = true;
		}
	}

	function selectProject(id: string) {
		close();
		goto(`/projects/${id}`);
	}

	/** Goal/Requirement detail routes don't exist yet in this requirement — no-op landing. */
	function landingNoop() {
		close();
	}

	function close() {
		open = false;
		query = '';
		results = null;
	}

	$effect(() => {
		if (!open) return;
		function onPointerDown(ev: PointerEvent) {
			if (!wrapRef || !wrapRef.contains(ev.target as Node)) open = false;
		}
		function onKeydown(ev: KeyboardEvent) {
			if (ev.key === 'Escape') open = false;
		}
		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKeydown);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeydown);
		};
	});
</script>

<div class="search-wrap" bind:this={wrapRef}>
	<div class="search-input-wrap">
		<SearchIcon size={15} class="search-icon" />
		<Input
			type="text"
			aria-label="Search goals, projects, requirements"
			placeholder="Search goals, projects, requirements…"
			bind:value={query}
			onfocus={() => {
				if (results) open = true;
			}}
			class="search-input"
		/>
	</div>

	{#if open}
		<div class="search-results">
			{#if loading}
				<p class="search-status">Searching…</p>
			{:else if !hasResults}
				<p class="search-status">No results</p>
			{:else}
				{#if results && results.goals.length > 0}
					<div class="search-group">
						<span class="search-group-label">Goals</span>
						{#each results.goals as goal (goal.id)}
							<button type="button" class="search-item" onclick={landingNoop}>
								<span class="search-item-title">{goal.title}</span>
								<span class="search-item-id">{goal.id}</span>
							</button>
						{/each}
					</div>
				{/if}
				{#if results && results.projects.length > 0}
					<div class="search-group">
						<span class="search-group-label">Projects</span>
						{#each results.projects as project (project.id)}
							<button type="button" class="search-item" onclick={() => selectProject(project.id)}>
								<span class="search-item-title">{project.title}</span>
								<span class="search-item-id">{project.id}</span>
							</button>
						{/each}
					</div>
				{/if}
				{#if results && results.requirements.length > 0}
					<div class="search-group">
						<span class="search-group-label">Requirements</span>
						{#each results.requirements as requirement (requirement.id)}
							<button type="button" class="search-item" onclick={landingNoop}>
								<span class="search-item-title">{requirement.title}</span>
								<span class="search-item-id">{requirement.id}</span>
							</button>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.search-wrap {
		position: relative;
		width: 320px;
		max-width: 40vw;
	}

	.search-input-wrap {
		position: relative;
		display: flex;
		align-items: center;
	}

	.search-input-wrap :global(.search-icon) {
		position: absolute;
		left: 10px;
		color: var(--fg-4);
		pointer-events: none;
	}

	.search-input-wrap :global(.search-input) {
		padding-left: 32px;
	}

	.search-results {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		right: 0;
		min-width: 320px;
		max-height: 360px;
		overflow-y: auto;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		padding: 6px;
		z-index: 50;
	}

	.search-status {
		margin: 0;
		padding: 8px;
		font: 400 12px var(--font-sans);
		color: var(--fg-4);
		text-align: center;
	}

	.search-group + .search-group {
		margin-top: 4px;
		padding-top: 4px;
		border-top: 1px solid var(--line-1);
	}

	.search-group-label {
		display: block;
		padding: 4px 8px;
		font: 600 10px var(--font-sans);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg-4);
	}

	.search-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		width: 100%;
		padding: 7px 8px;
		border: 0;
		background: transparent;
		text-align: left;
		border-radius: var(--radius-sm, 4px);
		cursor: pointer;
		transition: background var(--dur-fast);
	}

	.search-item:hover {
		background: var(--paper-2);
	}

	.search-item-title {
		flex: 1;
		min-width: 0;
		font: 500 13px var(--font-sans);
		color: var(--fg-1);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.search-item-id {
		flex-shrink: 0;
		font: 400 11px var(--font-mono);
		color: var(--fg-4);
	}
</style>
