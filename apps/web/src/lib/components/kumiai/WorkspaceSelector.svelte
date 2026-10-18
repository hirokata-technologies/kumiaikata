<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import Plus from '@lucide/svelte/icons/plus';
	import type { KumiaiWorkspace } from '$lib/kumiai/types.js';

	let {
		workspaces,
		activeId,
		onselect,
		oncreate
	}: {
		workspaces: KumiaiWorkspace[];
		activeId: string | null;
		onselect: (id: string) => void;
		/** Resolves to an error message to show under the field, or `null` on success. */
		oncreate: (name: string) => Promise<string | null>;
	} = $props();

	let open = $state(false);
	let naming = $state(false);
	let name = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);

	const active = $derived(workspaces.find((w) => w.id === activeId) ?? workspaces[0] ?? null);

	const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
	const meta = (w: KumiaiWorkspace) =>
		`${plural(w.goalCount, 'goal')} · ${plural(w.projectCount, 'project')}`;

	function close() {
		open = false;
		naming = false;
		name = '';
		error = null;
	}

	function pick(id: string) {
		close();
		if (id !== active?.id) onselect(id);
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		const trimmed = name.trim();
		if (!trimmed || busy) return;
		busy = true;
		error = await oncreate(trimmed);
		busy = false;
		if (!error) close();
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (open && e.key === 'Escape') close();
	}}
/>

{#if active}
	<div class="workspace-selector">
		<span class="eyebrow label">Workspace</span>
		<button
			type="button"
			class="trigger"
			aria-haspopup="listbox"
			aria-expanded={open}
			onclick={() => (open ? close() : (open = true))}
		>
			<span class="initial" aria-hidden="true">{active.name[0]?.toUpperCase()}</span>
			<span class="text">
				<span class="name">{active.name}</span>
				<span class="meta">{meta(active)}</span>
			</span>
			<ChevronsUpDown size={14} class="chevrons" aria-hidden="true" />
		</button>

		{#if open}
			<div class="scrim" role="presentation" onclick={close}></div>
			<div class="menu">
				<ul role="listbox" aria-label="Workspaces" class="options">
					{#each workspaces as w (w.id)}
						<li role="presentation">
							<button
								type="button"
								role="option"
								aria-selected={w.id === active.id}
								class="option"
								class:current={w.id === active.id}
								onclick={() => pick(w.id)}
							>
								<span class="initial muted" aria-hidden="true">{w.name[0]?.toUpperCase()}</span>
								<span class="text">
									<span class="name">{w.name}</span>
									<span class="meta">{meta(w)}</span>
								</span>
								{#if w.id === active.id}
									<Check size={14} class="check" aria-hidden="true" />
								{/if}
							</button>
						</li>
					{/each}
				</ul>

				<div class="footer">
					{#if naming}
						<form class="new-form" onsubmit={create}>
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="new-input"
								aria-label="Workspace name"
								placeholder="Workspace name"
								maxlength="60"
								autofocus
								bind:value={name}
							/>
							{#if error}<span class="error" role="alert">{error}</span>{/if}
						</form>
					{:else}
						<button type="button" class="option new" onclick={() => (naming = true)}>
							<Plus size={14} aria-hidden="true" />
							<span class="name">New workspace</span>
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.workspace-selector {
		position: relative;
		display: flex;
		flex-direction: column;
	}

	.label {
		padding: 0 var(--space-2) 6px;
	}

	.trigger {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 10px;
		border-radius: 8px;
		border: 1px solid var(--line-2);
		background: var(--paper-0);
		cursor: pointer;
		text-align: left;
	}

	.initial {
		width: 22px;
		height: 22px;
		border-radius: 6px;
		background: var(--ink-0);
		color: var(--paper-0);
		display: flex;
		align-items: center;
		justify-content: center;
		font: 700 11px var(--font-sans);
		flex-shrink: 0;
	}

	.initial.muted {
		background: var(--paper-2);
		color: var(--ink-1);
	}

	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.name {
		font: 600 13px var(--font-sans);
		color: var(--ink-0);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.meta {
		font: 400 11px var(--font-sans);
		color: var(--fg-3);
		margin-top: 1px;
	}

	.trigger :global(.chevrons) {
		color: var(--fg-3);
		flex-shrink: 0;
	}

	.scrim {
		position: fixed;
		inset: 0;
		z-index: 30;
	}

	.menu {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(100% + 6px);
		z-index: 31;
		background: var(--paper-0);
		border: 1px solid var(--line-2);
		border-radius: 10px;
		box-shadow: 0 8px 24px rgba(20, 19, 15, 0.12);
		padding: 6px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.options {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 260px;
		overflow-y: auto;
	}

	.option {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px;
		border-radius: 6px;
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
	}

	.option:hover,
	.option.current {
		background: var(--paper-1);
	}

	.option .name {
		font-weight: 500;
	}

	.option :global(.check) {
		color: var(--accent);
		flex-shrink: 0;
	}

	.footer {
		border-top: 1px solid var(--line-1);
		margin-top: 4px;
		padding-top: 4px;
	}

	.option.new {
		color: var(--fg-2);
	}

	.new-form {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 4px;
	}

	.new-input {
		width: 100%;
		box-sizing: border-box;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid var(--line-2);
		background: var(--paper-0);
		font: 400 13px var(--font-sans);
		color: var(--ink-0);
	}

	.error {
		font: 400 11px var(--font-sans);
		color: var(--danger);
	}
</style>
