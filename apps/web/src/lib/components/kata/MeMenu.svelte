<script lang="ts">
	import { User, Settings, Keyboard, LogOut } from 'lucide-svelte';

	let {
		user = null
	}: {
		user?: { name?: string | null; email: string } | null;
	} = $props();

	let open = $state(false);
	let wrapRef: HTMLElement | null = $state(null);

	const initials = $derived.by(() => {
		if (!user) return 'Y';
		const name = user.name?.trim();
		if (name) {
			const parts = name.split(/\s+/);
			if (parts.length >= 2) return parts[0][0].toUpperCase() + parts[1][0].toUpperCase();
			return name[0].toUpperCase();
		}
		return user.email[0].toUpperCase();
	});

	const displayName = $derived(user?.name?.trim() || user?.email || 'You');
	const email = $derived(user?.email ?? '');

	$effect(() => {
		if (!open) return;

		function onPointerDown(e: PointerEvent) {
			if (!wrapRef || !wrapRef.contains(e.target as Node)) {
				open = false;
			}
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
</script>

<div class="me-menu-wrap" bind:this={wrapRef}>
	<button
		class="me-avatar-btn"
		class:is-open={open}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-label="Account menu"
		onclick={() => (open = !open)}
	>
		<span class="me-avatar-circle" aria-hidden="true">{initials}</span>
	</button>

	{#if open}
		<div class="me-menu" role="menu">
			<div class="me-menu-id">
				<span class="me-avatar-circle me-avatar-lg" aria-hidden="true">{initials}</span>
				<div class="me-menu-id-text">
					<div class="me-menu-id-name">{displayName}</div>
					<div class="me-menu-id-mail">{email}</div>
				</div>
			</div>

			<div class="me-menu-sep" role="separator"></div>

			<button class="me-menu-item" role="menuitem" onclick={() => (open = false)}>
				<User size={15} />
				<span>Edit profile</span>
			</button>
			<button class="me-menu-item" role="menuitem" onclick={() => (open = false)}>
				<Settings size={15} />
				<span>Settings</span>
			</button>
			<button class="me-menu-item" role="menuitem" onclick={() => (open = false)}>
				<Keyboard size={15} />
				<span>Keyboard shortcuts</span>
				<kbd class="me-menu-kbd">?</kbd>
			</button>

			<div class="me-menu-sep" role="separator"></div>

			<a class="me-menu-item" role="menuitem" href="/login" onclick={() => (open = false)}>
				<LogOut size={15} />
				<span>Sign out</span>
			</a>
		</div>
	{/if}
</div>

<style>
	.me-menu-wrap {
		position: relative;
	}

	.me-avatar-btn {
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0;
		border-radius: 999px;
		transition: box-shadow var(--dur-fast);
	}

	.me-avatar-btn:hover {
		box-shadow: 0 0 0 3px var(--paper-3);
	}

	.me-avatar-btn.is-open {
		box-shadow: 0 0 0 3px var(--accent-soft);
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
		flex-shrink: 0;
	}

	.me-avatar-lg {
		width: 36px;
		height: 36px;
		font-size: 14px;
	}

	.me-menu {
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
		animation: me-menu-in 140ms var(--ease-out);
	}

	@keyframes me-menu-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.me-menu-id {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 8px 10px;
	}

	.me-menu-id-text {
		min-width: 0;
		line-height: 1.2;
	}

	.me-menu-id-name {
		font: 600 13px var(--font-sans);
		color: var(--fg-1);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.me-menu-id-mail {
		font: 400 12px var(--font-sans);
		color: var(--fg-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-top: 2px;
	}

	.me-menu-sep {
		height: 1px;
		background: var(--line-1);
		margin: 4px -2px;
	}

	.me-menu-item {
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
		text-decoration: none;
		border-radius: var(--radius-sm, 4px);
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast);
	}

	.me-menu-item:hover {
		background: var(--paper-2);
		color: var(--fg-1);
	}

	.me-menu-item :global(svg) {
		width: 15px;
		height: 15px;
		color: var(--fg-3);
		flex-shrink: 0;
		transition: color var(--dur-fast);
	}

	.me-menu-item:hover :global(svg) {
		color: var(--fg-1);
	}

	.me-menu-kbd {
		margin-left: auto;
		font: 500 11px var(--font-mono);
		color: var(--fg-3);
		background: var(--paper-2);
		border: 1px solid var(--line-1);
		border-radius: 4px;
		padding: 1px 5px;
		line-height: 1.3;
	}
</style>
