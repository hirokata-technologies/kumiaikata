<script lang="ts">
	import { User, Settings, Keyboard, LogOut } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import * as Sentry from '@sentry/sveltekit';
	import EditProfileModal from './EditProfileModal.svelte';
	import SettingsModal from './SettingsModal.svelte';

	let {
		user = null,
		onUserUpdate
	}: {
		user?: { name?: string | null; email: string; image?: string | null } | null;
		onUserUpdate?: (patch: { name?: string | null; image?: string | null }) => void;
	} = $props();

	let open = $state(false);
	let wrapRef: HTMLElement | null = $state(null);
	let isSigningOut = $state(false);
	let signOutError = $state<string | null>(null);
	let imageBroken = $state(false);
	let editOpen = $state(false);
	let settingsOpen = $state(false);

	// Reset imageBroken whenever the image URL changes
	$effect(() => {
		// Track user.image — when it changes, reset the broken flag
		void user?.image;
		imageBroken = false;
	});

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

	async function signOut() {
		if (isSigningOut) return;
		isSigningOut = true;
		signOutError = null;
		Sentry.addBreadcrumb({ category: 'auth', message: 'Sign-out initiated', level: 'info' });
		try {
			const result = await authClient.signOut();
			if (result?.error) {
				signOutError = 'Could not sign out. Please try again.';
				return;
			}
			await goto('/login');
		} catch (err) {
			Sentry.captureException(err);
			signOutError = 'Could not sign out. Please try again.';
		} finally {
			isSigningOut = false;
		}
	}

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
		{#if user?.image && !imageBroken}
			<img class="me-avatar-img" src={user.image} alt="" onerror={() => (imageBroken = true)} />
		{:else}
			<span class="me-avatar-circle" aria-hidden="true">{initials}</span>
		{/if}
	</button>

	{#if editOpen}
		<EditProfileModal
			{user}
			onClose={() => (editOpen = false)}
			onSaved={(patch: { name?: string | null; image?: string | null }) => { onUserUpdate?.(patch); imageBroken = false; editOpen = false; }}
		/>
	{/if}

	{#if settingsOpen}
		<SettingsModal onClose={() => (settingsOpen = false)} />
	{/if}

	{#if open}
		<div class="me-menu" role="menu">
			<div class="me-menu-id">
				{#if user?.image && !imageBroken}
					<img class="me-avatar-img me-avatar-lg" src={user.image} alt="" onerror={() => (imageBroken = true)} />
				{:else}
					<span class="me-avatar-circle me-avatar-lg" aria-hidden="true">{initials}</span>
				{/if}
				<div class="me-menu-id-text">
					<div class="me-menu-id-name">{displayName}</div>
					<div class="me-menu-id-mail">{email}</div>
				</div>
			</div>

			<div class="me-menu-sep" role="separator"></div>

			<button class="me-menu-item" role="menuitem" onclick={() => { editOpen = true; open = false; }}>
				<User size={15} />
				<span>Edit profile</span>
			</button>
			<button class="me-menu-item" role="menuitem" onclick={() => { open = false; settingsOpen = true; }}>
				<Settings size={15} />
				<span>Settings</span>
			</button>
			<button class="me-menu-item" role="menuitem" onclick={() => (open = false)}>
				<Keyboard size={15} />
				<span>Keyboard shortcuts</span>
				<kbd class="me-menu-kbd">?</kbd>
			</button>

			<div class="me-menu-sep" role="separator"></div>

			<button
				class="me-menu-item"
				role="menuitem"
				onclick={signOut}
				disabled={isSigningOut}
				aria-busy={isSigningOut}
			>
				<LogOut size={15} />
				<span>{isSigningOut ? 'Signing out…' : 'Sign out'}</span>
			</button>

			{#if signOutError}
				<div class="me-menu-error" role="alert">{signOutError}</div>
			{/if}
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

	.me-avatar-img {
		display: block;
		width: 32px;
		height: 32px;
		border-radius: 999px;
		object-fit: cover;
		flex-shrink: 0;
	}

	.me-avatar-lg {
		width: 36px;
		height: 36px;
		font-size: 14px;
	}

	.me-avatar-img.me-avatar-lg {
		width: 36px;
		height: 36px;
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

	.me-menu-item:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.me-menu-error {
		padding: 6px 8px;
		font: 500 12px var(--font-sans);
		color: var(--danger, #c0392b);
		line-height: 1.3;
	}
</style>
