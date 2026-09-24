<script lang="ts">
	import { User, Users, ChevronsUpDown, Check, Plus, Settings2 } from '@lucide/svelte';

	export type Workspace = {
		id: string;
		name: string;
		hint: string;
		icon: 'user' | 'users';
	};

	let {
		workspace,
		workspaces,
		onselectworkspace
	}: {
		workspace: Workspace;
		workspaces: Workspace[];
		onselectworkspace: (id: string) => void;
	} = $props();

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

	function select(id: string) {
		onselectworkspace(id);
		open = false;
	}
</script>

{#snippet wsIcon(name: 'user' | 'users')}
	{#if name === 'user'}
		<User size={15} />
	{:else}
		<Users size={15} />
	{/if}
{/snippet}

<div class="ws-wrap" bind:this={wrapRef}>
	<button
		class="ws-btn"
		class:is-open={open}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-label="Switch workspace"
		onclick={() => (open = !open)}
	>
		<span class="ws-icon">
			{@render wsIcon(workspace.icon)}
		</span>
		<span class="ws-text">
			<span class="eyebrow">Workspace</span>
			<span class="ws-name">{workspace.name}</span>
			{#if workspace.hint}
				<span class="ws-hint">{workspace.hint}</span>
			{/if}
		</span>
		<span class="ws-chev"><ChevronsUpDown size={14} /></span>
	</button>

	{#if open}
		<div class="ws-menu" role="menu">
			<div class="ws-menu-label">Switch workspace</div>

			{#each workspaces as ws (ws.id)}
				{@const active = ws.id === workspace.id}
				<button
					role="menuitem"
					class="ws-menu-item"
					class:is-active={active}
					onclick={() => select(ws.id)}
				>
					<span class="ws-menu-icon" class:is-active={active}>
						{@render wsIcon(ws.icon)}
					</span>
					<span class="ws-menu-meta">
						<span class="ws-menu-name">{ws.name}</span>
						<span class="ws-menu-hint">{ws.hint}</span>
					</span>
					{#if active}
						<span class="ws-menu-check"><Check size={15} /></span>
					{/if}
				</button>
			{/each}

			<div class="ws-sep" role="separator"></div>

			<button class="ws-menu-action" role="menuitem" onclick={() => (open = false)}>
				<Plus size={14} />
				<span>New workspace</span>
			</button>
			<button class="ws-menu-action" role="menuitem" onclick={() => (open = false)}>
				<Settings2 size={14} />
				<span>Workspace settings</span>
			</button>
		</div>
	{/if}
</div>

<style>
	.ws-wrap {
		position: relative;
	}

	.ws-btn {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 4px 8px 4px 6px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
		color: var(--fg-1);
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.ws-btn:hover {
		background: var(--paper-2);
	}

	.ws-btn.is-open {
		background: var(--paper-2);
		border-color: var(--line-1);
	}

	/* Small icon square next to the text */
	.ws-icon {
		width: 28px;
		height: 28px;
		border-radius: 8px;
		background: var(--paper-3);
		color: var(--fg-2);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
	}

	.ws-icon :global(svg) {
		width: 15px;
		height: 15px;
	}

	.ws-text {
		display: flex;
		flex-direction: column;
		line-height: 1.15;
		gap: 1px;
		text-align: left;
	}

	.ws-name {
		font-family: var(--font-display);
		font-size: 15px;
		font-weight: 500;
		color: var(--fg-1);
		white-space: nowrap;
	}

	.ws-hint {
		font: 400 11px var(--font-sans);
		color: var(--fg-4);
		white-space: nowrap;
	}

	.ws-chev {
		display: inline-flex;
		flex: 0 0 auto;
	}

	.ws-chev :global(svg) {
		width: 14px;
		height: 14px;
		color: var(--fg-3);
	}

	/* Dropdown */
	.ws-menu {
		position: absolute;
		top: calc(100% + 8px);
		left: 0;
		min-width: 280px;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		padding: 6px;
		z-index: 50;
		animation: ws-menu-in 140ms var(--ease-out);
	}

	@keyframes ws-menu-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.ws-menu-label {
		font: 600 10px var(--font-sans);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--fg-4);
		padding: 6px 8px 8px;
	}

	.ws-menu-item {
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

	.ws-menu-item:hover {
		background: var(--paper-2);
	}

	.ws-menu-item.is-active {
		background: var(--accent-soft);
	}

	/* Larger icon in dropdown rows */
	.ws-menu-icon {
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

	.ws-menu-icon.is-active {
		background: var(--accent);
		color: var(--paper-0);
	}

	.ws-menu-icon :global(svg) {
		width: 15px;
		height: 15px;
	}

	.ws-menu-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}

	.ws-menu-name {
		font: 600 13px var(--font-sans);
		color: var(--fg-1);
		line-height: 1.2;
	}

	.ws-menu-hint {
		font: 400 12px var(--font-sans);
		color: var(--fg-3);
		line-height: 1.3;
	}

	.ws-menu-check {
		display: inline-flex;
		flex: 0 0 auto;
		color: var(--accent);
	}

	.ws-menu-check :global(svg) {
		width: 15px;
		height: 15px;
	}

	.ws-sep {
		height: 1px;
		background: var(--line-1);
		margin: 4px -2px;
	}

	.ws-menu-action {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 7px 8px;
		border: 0;
		background: transparent;
		color: var(--fg-2);
		font: 500 13px var(--font-sans);
		text-align: left;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast);
	}

	.ws-menu-action:hover {
		background: var(--paper-2);
		color: var(--fg-1);
	}

	.ws-menu-action :global(svg) {
		width: 14px;
		height: 14px;
		color: var(--fg-3);
		flex-shrink: 0;
		transition: color var(--dur-fast);
	}

	.ws-menu-action:hover :global(svg) {
		color: var(--fg-1);
	}
</style>
