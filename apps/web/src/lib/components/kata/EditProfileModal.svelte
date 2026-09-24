<script lang="ts">
	import { authClient } from '$lib/auth-client.js';
	import { uploadAvatar } from '$lib/api';
	import { NAME_MAX, validatePassword, validateConfirmPassword } from '$lib/auth-validation.js';

	let {
		user,
		onClose,
		onSaved
	}: {
		user?: { name?: string | null; email: string; image?: string | null } | null;
		onClose: () => void;
		onSaved: (patch: { name?: string | null; image?: string | null }) => void;
	} = $props();

	// --- Name ---
	let name = $state(user?.name?.trim() ?? '');
	let nameError: string | null = $state(null);
	let nameInputRef: HTMLInputElement | null = $state(null);

	// --- Photo ---
	let fileInput: HTMLInputElement | null = $state(null);
	let selectedFile: File | null = $state(null);
	let previewUrl: string | null = $state(null);
	let removePhoto = $state(false);
	let uploadedImageUrl: string | null = $state(null);
	let photoError: string | null = $state(null);
	let imgFailed = $state(false);

	// --- Password ---
	let hasPassword = $state(true);
	let showPasswordSection = $state(false);
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let currentPwError: string | null = $state(null);
	let newPwError: string | null = $state(null);
	let confirmPwError: string | null = $state(null);
	let passwordSuccess: string | null = $state(null);
	let showCurrentPw = $state(false);
	let showNewPw = $state(false);
	let showConfirmPw = $state(false);

	// --- Global ---
	let saving = $state(false);
	let bannerError: string | null = $state(null);

	// --- Derived ---
	const initials = $derived.by(() => {
		if (!user) return '?';
		const n = user.name?.trim();
		if (n) {
			const parts = n.split(/\s+/).filter((p) => p.length > 0);
			if (parts.length >= 2) {
				const a = parts[0][0] ?? '';
				const b = parts[1][0] ?? '';
				return (a + b).toUpperCase() || '?';
			}
			return n[0].toUpperCase() || '?';
		}
		const e = user.email?.trim();
		return e ? e[0].toUpperCase() : '?';
	});

	// Priority: new file preview > existing photo (unless removing/failed) > none
	const previewSrc = $derived(
		previewUrl ?? (removePhoto || imgFailed ? null : (user?.image ?? null))
	);

	// Detect credential account on mount. Default is true (optimistic) so the
	// password section is visible when the API call fails (network error, timeout).
	// Only set to false when listAccounts() succeeds AND no credential account is found.
	$effect(() => {
		authClient
			.listAccounts()
			.then((res) => {
				// better-auth returns { data: [...], error: null } or { data: null, error: {...} }
				const accounts = (res as { data?: Array<{ providerId: string }> | null })?.data ?? [];
				if (Array.isArray(accounts)) {
					hasPassword = accounts.some((a) => a.providerId === 'credential');
				}
				// If accounts is not an array (error response), leave hasPassword=true
			})
			.catch(() => {
				// Network/timeout error — leave hasPassword=true so users are not blocked
			});
	});

	// Focus name input on mount
	$effect(() => {
		nameInputRef?.focus();
	});

	// Revoke object URL on unmount
	$effect(() => {
		return () => {
			if (previewUrl) URL.revokeObjectURL(previewUrl);
		};
	});

	// --- File picking ---
	const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
	const MAX_SIZE = 5 * 1024 * 1024;

	function onPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		if (!ALLOWED_TYPES.has(file.type)) {
			photoError = 'Please choose a JPEG, PNG, GIF, or WebP image.';
			input.value = '';
			return;
		}
		if (file.size > MAX_SIZE) {
			photoError = 'Photo must be 5 MB or smaller.';
			input.value = '';
			return;
		}

		// Revoke any prior object URL
		if (previewUrl) URL.revokeObjectURL(previewUrl);

		previewUrl = URL.createObjectURL(file);
		selectedFile = file;
		removePhoto = false;
		uploadedImageUrl = null;
		photoError = null;
		imgFailed = false;
	}

	function onRemovePhoto() {
		if (previewUrl) {
			URL.revokeObjectURL(previewUrl);
			previewUrl = null;
		}
		selectedFile = null;
		uploadedImageUrl = null;
		removePhoto = true;
		photoError = null;
		imgFailed = false;
		if (fileInput) fileInput.value = '';
	}

	// --- Validation ---
	function validate(): boolean {
		let valid = true;

		// Name
		nameError = null;
		const n = name.trim();
		if (!n) {
			nameError = 'Name is required.';
			valid = false;
		} else if (n.length > NAME_MAX) {
			nameError = 'Name must be 256 characters or fewer.';
			valid = false;
		}

		// Password (only when hasPassword and any field is non-empty)
		currentPwError = null;
		newPwError = null;
		confirmPwError = null;
		const pwPartial = currentPassword || newPassword || confirmPassword;
		if (hasPassword && pwPartial) {
			if (!currentPassword) {
				currentPwError = 'Current password is required.';
				valid = false;
			}
			const npErr = validatePassword(newPassword);
			if (npErr) {
				newPwError = npErr;
				valid = false;
			}
			const cpErr = validateConfirmPassword(confirmPassword, newPassword);
			if (cpErr) {
				confirmPwError = cpErr;
				valid = false;
			}
		}

		return valid;
	}

	function errMessage(err: unknown): string {
		if (err instanceof Error) return err.message;
		return 'Something went wrong. Please try again.';
	}

	// --- Save ---
	async function save() {
		if (saving) return;
		bannerError = null;
		passwordSuccess = null;
		if (!validate()) return;
		saving = true;

		try {
			// 1) Avatar upload (only if a new file and not already uploaded)
			let imageUrl: string | null | undefined = undefined;
			if (selectedFile && !uploadedImageUrl) {
				try {
					const res = await uploadAvatar(selectedFile);
					uploadedImageUrl = res.imageUrl;
				} catch (err) {
					photoError = errMessage(err);
					bannerError = 'Could not upload your photo. Please try again.';
					return;
				}
			}
			if (uploadedImageUrl) imageUrl = uploadedImageUrl;
			else if (removePhoto) imageUrl = null;

			// 2) updateUser — only when name or image changed
			const nameChanged = name.trim() !== (user?.name?.trim() ?? '');
			const imageChanged = imageUrl !== undefined;
			if (nameChanged || imageChanged) {
				const payload: { name?: string; image?: string | null } = {};
				if (nameChanged) payload.name = name.trim();
				if (imageChanged) payload.image = imageUrl ?? null;
				const r = await authClient.updateUser(payload);
				if ((r as { error?: { message?: string } | null })?.error) {
					const errObj = (r as { error?: { message?: string } | null }).error;
					bannerError = errObj?.message ?? 'Could not update your profile. Please try again.';
					return;
				}
			}

			// 3) changePassword — only if password fields filled
			if (hasPassword && (currentPassword || newPassword || confirmPassword)) {
				const r = await authClient.changePassword({
					currentPassword,
					newPassword,
					revokeOtherSessions: false,
				});
				const rErr = (r as { error?: { code?: string; message?: string } | null })?.error;
				if (rErr) {
					if (rErr.code === 'INVALID_PASSWORD') {
						currentPwError = 'Current password is incorrect.';
					} else {
						bannerError = rErr.message ?? 'Could not change password. Please try again.';
					}
					return;
				}
				// Success: clear fields + show success
				currentPassword = '';
				newPassword = '';
				confirmPassword = '';
				passwordSuccess = 'Password updated.';
			}

			// Full success → emit patch and close
			const patch: { name?: string | null; image?: string | null } = {};
			if (name.trim() !== (user?.name?.trim() ?? '')) patch.name = name.trim();
			if (imageUrl !== undefined) patch.image = imageUrl ?? null;
			if (fileInput) fileInput.value = '';
			onSaved(patch);
		} finally {
			saving = false;
		}
	}

	// --- Focus trap helpers ---
	function getFocusable(panel: HTMLElement): HTMLElement[] {
		return Array.from(
			panel.querySelectorAll<HTMLElement>(
				'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
			)
		);
	}

	function onPanelKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
			return;
		}
		if (e.key !== 'Tab') return;
		const panel = e.currentTarget as HTMLElement;
		const focusable = getFocusable(panel);
		if (!focusable.length) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (e.shiftKey) {
			if (document.activeElement === first) {
				e.preventDefault();
				last?.focus();
			}
		} else {
			if (document.activeElement === last) {
				e.preventDefault();
				first?.focus();
			}
		}
	}
</script>

<div
	class="ep-scrim"
	onclick={onClose}
	role="dialog"
	aria-modal="true"
	aria-label="Edit profile"
	tabindex="-1"
>
	<div
		class="ep-panel"
		onclick={(e) => e.stopPropagation()}
		onkeydown={onPanelKeydown}
		role="presentation"
	>
		<!-- Header -->
		<header class="ep-header">
			<h2 class="ep-title">Edit profile</h2>
			<button class="ep-close" onclick={onClose} aria-label="Close">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<line x1="18" y1="6" x2="6" y2="18"/>
					<line x1="6" y1="6" x2="18" y2="18"/>
				</svg>
			</button>
		</header>

		{#if bannerError}
			<div class="ep-banner ep-banner-error" role="alert">{bannerError}</div>
		{/if}

		<div class="ep-body">
			<!-- Avatar section -->
			<div class="ep-section ep-avatar-section">
				<button
					class="ep-avatar-wrap"
					type="button"
					onclick={() => fileInput?.click()}
					aria-label="Upload photo"
					disabled={saving}
				>
					{#if previewSrc}
						<img
							class="ep-avatar-img"
							src={previewSrc}
							alt="Your avatar"
							onload={() => { imgFailed = false; }}
							onerror={() => { imgFailed = true; }}
						/>
					{:else}
						<span class="ep-avatar-initials" aria-hidden="true">{initials}</span>
					{/if}
					<span class="ep-avatar-overlay" aria-hidden="true">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
							<circle cx="12" cy="13" r="4"/>
						</svg>
					</span>
				</button>

				<div class="ep-avatar-actions">
					<button
						class="ep-btn ep-btn-ghost"
						type="button"
						onclick={() => fileInput?.click()}
						disabled={saving}
					>
						Upload photo
					</button>
					{#if user?.image && !selectedFile}
						<button
							class="ep-btn ep-btn-ghost ep-btn-danger"
							type="button"
							onclick={onRemovePhoto}
							disabled={saving}
						>
							Remove photo
						</button>
					{/if}
				</div>

				<input
					type="file"
					accept="image/jpeg,image/png,image/gif,image/webp"
					class="ep-hidden"
					bind:this={fileInput}
					onchange={onPick}
					disabled={saving}
				/>

				{#if photoError}
					<p class="ep-field-error" role="alert">{photoError}</p>
				{/if}
			</div>

			<div class="ep-sep" role="separator"></div>

			<!-- Name field -->
			<div class="ep-section">
				<div class="ep-field">
					<label for="ep-name" class="ep-label">Display name</label>
					<input
						id="ep-name"
						type="text"
						class="ep-input"
						class:is-error={nameError}
						maxlength={NAME_MAX}
						bind:value={name}
						bind:this={nameInputRef}
						disabled={saving}
						autocomplete="name"
					/>
					{#if nameError}<p class="ep-field-error" role="alert">{nameError}</p>{/if}
				</div>

				<!-- Email (read-only) -->
				<div class="ep-field">
					<span class="ep-label">Email</span>
					<output class="ep-output">{user?.email ?? ''}</output>
				</div>
			</div>

			<!-- Password section (credential accounts only) -->
			{#if hasPassword}
				<div class="ep-sep" role="separator"></div>

				<div class="ep-section">
					<button
						class="ep-disclosure"
						type="button"
						onclick={() => { showPasswordSection = !showPasswordSection; }}
						aria-expanded={showPasswordSection}
					>
						<span>Change password</span>
						<svg
							class="ep-disclosure-icon"
							class:is-open={showPasswordSection}
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<polyline points="6 9 12 15 18 9"/>
						</svg>
					</button>

					{#if showPasswordSection}
						<div class="ep-pw-fields">
							{#if passwordSuccess}
								<p class="ep-pw-success" role="status">{passwordSuccess}</p>
							{/if}

							<div class="ep-field">
								<label for="ep-cur-pw" class="ep-label">Current password</label>
								<div class="ep-input-wrap">
									<input
										id="ep-cur-pw"
										type={showCurrentPw ? 'text' : 'password'}
										class="ep-input ep-input-pw"
										class:is-error={currentPwError}
										bind:value={currentPassword}
										oninput={() => { currentPwError = null; }}
										disabled={saving}
										autocomplete="current-password"
									/>
									<button
										type="button"
										class="ep-pw-toggle"
										onclick={() => (showCurrentPw = !showCurrentPw)}
										aria-label={showCurrentPw ? 'Hide current password' : 'Show current password'}
										aria-pressed={showCurrentPw}
									>
										{#if showCurrentPw}
											<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
												<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
												<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
												<line x1="1" y1="1" x2="23" y2="23"/>
											</svg>
										{:else}
											<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
												<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
												<circle cx="12" cy="12" r="3"/>
											</svg>
										{/if}
									</button>
								</div>
								{#if currentPwError}<p class="ep-field-error" role="alert">{currentPwError}</p>{/if}
							</div>

							<div class="ep-field">
								<label for="ep-new-pw" class="ep-label">New password</label>
								<div class="ep-input-wrap">
									<input
										id="ep-new-pw"
										type={showNewPw ? 'text' : 'password'}
										class="ep-input ep-input-pw"
										class:is-error={newPwError}
										bind:value={newPassword}
										oninput={() => { newPwError = null; }}
										disabled={saving}
										autocomplete="new-password"
									/>
									<button
										type="button"
										class="ep-pw-toggle"
										onclick={() => (showNewPw = !showNewPw)}
										aria-label={showNewPw ? 'Hide new password' : 'Show new password'}
										aria-pressed={showNewPw}
									>
										{#if showNewPw}
											<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
												<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
												<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
												<line x1="1" y1="1" x2="23" y2="23"/>
											</svg>
										{:else}
											<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
												<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
												<circle cx="12" cy="12" r="3"/>
											</svg>
										{/if}
									</button>
								</div>
								{#if newPwError}<p class="ep-field-error" role="alert">{newPwError}</p>{/if}
							</div>

							<div class="ep-field">
								<label for="ep-conf-pw" class="ep-label">Confirm new password</label>
								<div class="ep-input-wrap">
									<input
										id="ep-conf-pw"
										type={showConfirmPw ? 'text' : 'password'}
										class="ep-input ep-input-pw"
										class:is-error={confirmPwError}
										bind:value={confirmPassword}
										oninput={() => { confirmPwError = null; }}
										disabled={saving}
										autocomplete="new-password"
									/>
									<button
										type="button"
										class="ep-pw-toggle"
										onclick={() => (showConfirmPw = !showConfirmPw)}
										aria-label={showConfirmPw ? 'Hide confirm password' : 'Show confirm password'}
										aria-pressed={showConfirmPw}
									>
										{#if showConfirmPw}
											<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
												<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
												<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
												<line x1="1" y1="1" x2="23" y2="23"/>
											</svg>
										{:else}
											<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
												<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
												<circle cx="12" cy="12" r="3"/>
											</svg>
										{/if}
									</button>
								</div>
								{#if confirmPwError}<p class="ep-field-error" role="alert">{confirmPwError}</p>{/if}
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Footer -->
		<footer class="ep-footer">
			<button class="ep-btn ep-btn-ghost" type="button" onclick={onClose} disabled={saving}>
				Cancel
			</button>
			<button
				class="ep-btn ep-btn-primary"
				type="button"
				onclick={save}
				disabled={saving}
				aria-busy={saving}
			>
				{#if saving}
					<span class="ep-spinner" aria-hidden="true"></span>
					Saving…
				{:else}
					Save
				{/if}
			</button>
		</footer>
	</div>
</div>

<style>
	.ep-scrim {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
	}

	.ep-panel {
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		width: 100%;
		max-width: 440px;
		max-height: calc(100vh - 32px);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.ep-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px 14px;
		border-bottom: 1px solid var(--line-1);
		flex-shrink: 0;
	}

	.ep-title {
		font: 600 15px var(--font-sans);
		color: var(--fg-1);
		margin: 0;
	}

	.ep-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: 0;
		background: transparent;
		color: var(--fg-3);
		border-radius: var(--radius-sm, 4px);
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast);
	}

	.ep-close:hover {
		background: var(--paper-2);
		color: var(--fg-1);
	}

	.ep-close svg {
		width: 16px;
		height: 16px;
	}

	.ep-banner {
		padding: 10px 20px;
		font: 500 13px/1.4 var(--font-sans);
		flex-shrink: 0;
	}

	.ep-banner-error {
		background: color-mix(in srgb, var(--paper-1) 90%, var(--warning, #c0392b) 10%);
		border-bottom: 1px solid color-mix(in srgb, var(--line-1) 70%, var(--warning, #c0392b) 30%);
		color: var(--fg-2);
	}

	.ep-body {
		flex: 1;
		overflow-y: auto;
		padding: 0;
	}

	.ep-section {
		padding: 16px 20px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.ep-sep {
		height: 1px;
		background: var(--line-1);
	}

	/* Avatar */
	.ep-avatar-section {
		flex-direction: row;
		align-items: flex-start;
		flex-wrap: wrap;
		gap: 12px;
	}

	.ep-avatar-wrap {
		position: relative;
		width: 64px;
		height: 64px;
		border-radius: 999px;
		overflow: hidden;
		border: 0;
		background: transparent;
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
	}

	.ep-avatar-wrap:disabled {
		cursor: default;
		opacity: 0.7;
	}

	.ep-avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.ep-avatar-initials {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		background: var(--accent);
		color: var(--paper-0);
		font: 600 22px var(--font-sans);
		border-radius: 999px;
	}

	.ep-avatar-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.35);
		border-radius: 999px;
		opacity: 0;
		transition: opacity var(--dur-fast);
		color: #fff;
	}

	.ep-avatar-overlay svg {
		width: 20px;
		height: 20px;
	}

	.ep-avatar-wrap:hover:not(:disabled) .ep-avatar-overlay {
		opacity: 1;
	}

	.ep-avatar-actions {
		display: flex;
		flex-direction: column;
		gap: 6px;
		justify-content: center;
	}

	.ep-hidden {
		display: none;
	}

	/* Fields */
	.ep-field {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.ep-label {
		font: 500 12px var(--font-sans);
		color: var(--fg-2);
		letter-spacing: 0.01em;
	}

	.ep-input {
		width: 100%;
		padding: 9px 12px;
		border: 1px solid var(--line-3);
		border-radius: var(--radius-md);
		background: var(--paper-0);
		color: var(--fg-1);
		font: 400 14px/1.3 var(--font-sans);
		outline: none;
		transition: border-color var(--dur-fast), box-shadow var(--dur-fast);
		-webkit-appearance: none;
		appearance: none;
		box-sizing: border-box;
	}

	.ep-input::placeholder {
		color: var(--fg-4);
	}

	.ep-input:hover:not(:disabled) {
		border-color: var(--ink-3);
	}

	.ep-input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}

	.ep-input.is-error {
		border-color: var(--danger);
	}

	.ep-input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.ep-output {
		display: block;
		padding: 9px 12px;
		border: 1px solid var(--line-2);
		border-radius: var(--radius-md);
		background: var(--paper-1);
		color: var(--fg-3);
		font: 400 14px/1.3 var(--font-sans);
		box-sizing: border-box;
		user-select: text;
	}

	.ep-field-error {
		font: 400 12px var(--font-sans);
		color: var(--danger);
		margin: 0;
	}

	/* Password */
	.ep-input-wrap {
		position: relative;
	}

	.ep-input-pw {
		padding-right: 40px;
	}

	.ep-pw-toggle {
		position: absolute;
		right: 6px;
		top: 50%;
		transform: translateY(-50%);
		width: 28px;
		height: 28px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 0;
		background: transparent;
		color: var(--fg-3);
		border-radius: var(--radius-sm, 4px);
		cursor: pointer;
	}

	.ep-pw-toggle:hover {
		color: var(--fg-1);
		background: var(--paper-1);
	}

	.ep-pw-toggle svg {
		width: 15px;
		height: 15px;
	}

	.ep-pw-fields {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.ep-pw-success {
		font: 500 13px var(--font-sans);
		color: var(--success, #1e7e34);
		margin: 0;
		padding: 8px 12px;
		border-radius: var(--radius-sm, 4px);
		background: color-mix(in srgb, var(--paper-1) 85%, var(--success, #1e7e34) 15%);
	}

	/* Disclosure toggle */
	.ep-disclosure {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		border: 0;
		background: transparent;
		padding: 0;
		font: 600 13px var(--font-sans);
		color: var(--fg-2);
		cursor: pointer;
		text-align: left;
	}

	.ep-disclosure:hover {
		color: var(--fg-1);
	}

	.ep-disclosure-icon {
		width: 16px;
		height: 16px;
		transition: transform var(--dur-fast);
	}

	.ep-disclosure-icon.is-open {
		transform: rotate(180deg);
	}

	/* Buttons */
	.ep-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 8px 14px;
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		font: 500 13px/1 var(--font-sans);
		cursor: pointer;
		transition: background var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast);
		white-space: nowrap;
	}

	.ep-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.ep-btn-ghost {
		background: transparent;
		border-color: var(--line-3);
		color: var(--fg-2);
	}

	.ep-btn-ghost:hover:not(:disabled) {
		background: var(--paper-2);
		color: var(--fg-1);
	}

	.ep-btn-danger {
		color: var(--danger);
		border-color: color-mix(in srgb, var(--line-3) 60%, var(--danger) 40%);
	}

	.ep-btn-danger:hover:not(:disabled) {
		background: color-mix(in srgb, var(--paper-2) 80%, var(--danger) 20%);
		color: var(--danger);
	}

	.ep-btn-primary {
		background: var(--ink-0);
		border-color: var(--ink-0);
		color: var(--paper-0);
	}

	.ep-btn-primary:hover:not(:disabled) {
		background: var(--ink-1);
		border-color: var(--ink-1);
	}

	.ep-spinner {
		width: 12px;
		height: 12px;
		border: 2px solid rgba(255, 255, 255, 0.4);
		border-top-color: #fff;
		border-radius: 50%;
		animation: ep-spin 0.6s linear infinite;
		flex-shrink: 0;
	}

	@keyframes ep-spin {
		to { transform: rotate(360deg); }
	}

	/* Footer */
	.ep-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		padding: 14px 20px;
		border-top: 1px solid var(--line-1);
		flex-shrink: 0;
	}
</style>
