<script lang="ts">
	import { AlertCircle } from 'lucide-svelte';
	import { authClient } from '$lib/auth-client';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import * as Sentry from '@sentry/sveltekit';

	const ERROR_MESSAGES: Record<string, string> = {
		INVALID_TOKEN: 'This reset link is invalid or has already been used.',
		TOKEN_EXPIRED: 'This reset link has expired. Please request a new one.',
	};
	const GENERIC_ERROR = 'Something went wrong. Please try again.';

	const TOKEN_FORMAT = /^[A-Za-z0-9_-]{1,512}$/;

	function isValidTokenFormat(t: string | null): t is string {
		return !!t && TOKEN_FORMAT.test(t);
	}

	let token = $state(page.url.searchParams.get('token'));
	let newPassword = $state('');
	let confirmPassword = $state('');
	let loading = $state(false);
	let errorCode = $state<string | null>(isValidTokenFormat(token) ? null : 'INVALID_TOKEN');
	let touched = $state({ newPassword: false, confirmPassword: false });

	let passwordError = $derived.by(() => {
		if (!touched.newPassword) return null;
		if (!newPassword) return 'Password is required.';
		if (newPassword.length < 8) return 'Password must be at least 8 characters.';
		if (newPassword.length > 128) return 'Password must be no longer than 128 characters.';
		return null;
	});

	let confirmError = $derived.by(() => {
		if (!touched.confirmPassword) return null;
		if (!confirmPassword) return 'Please confirm your password.';
		if (confirmPassword !== newPassword) return 'Passwords do not match.';
		return null;
	});

	let formValid = $derived(
		newPassword.length >= 8 &&
			newPassword.length <= 128 &&
			confirmPassword === newPassword
	);

	// Token-level errors that block the form entirely
	let isTokenError = $derived(
		errorCode === 'INVALID_TOKEN' || errorCode === 'TOKEN_EXPIRED'
	);

	// Inline server errors that show above the form
	let serverErrorMessage = $derived.by(() => {
		if (!errorCode || isTokenError) return null;
		return GENERIC_ERROR;
	});

	async function handleResetPassword() {
		touched = { newPassword: true, confirmPassword: true };
		if (!formValid || !isValidTokenFormat(token)) return;

		loading = true;
		errorCode = null;
		try {
			const { data, error } = await authClient.resetPassword({
				newPassword,
				token,
			});
			if (error === null || error === undefined) {
				if (data) {
					await goto('/login?reset=true');
				} else {
					// Malformed response: no error but also no data
					errorCode = 'unknown';
				}
			} else {
				errorCode = error.code ?? 'unknown';
			}
		} catch (err) {
			Sentry.captureException(err);
			errorCode = 'unknown';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Reset password — Kata</title>
	<meta name="description" content="Set a new password for your Kata account." />
</svelte:head>

{#if isTokenError}
	<div class="token-error">
		<AlertCircle size={40} strokeWidth={1.5} aria-hidden="true" />
		<p>{ERROR_MESSAGES[errorCode ?? 'INVALID_TOKEN'] ?? ERROR_MESSAGES.INVALID_TOKEN}</p>
		<a href="/forgot-password">Request a new reset link</a>
		<a href="/login">Back to sign in</a>
	</div>
{:else}
	<div class="card-head">
		<img class="card-logo" src="/logo-mark.png" alt="Kata logo" />
		<h1>Set a new password</h1>
	</div>

	{#if serverErrorMessage}
		<div class="error-banner" role="alert">
			<p class="error-text">{serverErrorMessage}</p>
			<p class="error-code">Error: {errorCode ?? 'unknown'}</p>
		</div>
	{/if}

	<form onsubmit={(e) => { e.preventDefault(); handleResetPassword(); }}>
		<div class="form-group">
			<label class="form-label" for="new-password">New password</label>
			<input
				id="new-password"
				class="form-input"
				class:form-input-error={passwordError}
				type="password"
				name="new-password"
				autocomplete="new-password"
				required
				bind:value={newPassword}
				onblur={() => (touched.newPassword = true)}
				disabled={loading}
			/>
			{#if passwordError}
				<p class="field-error" role="alert">{passwordError}</p>
			{/if}
		</div>

		<div class="form-group">
			<label class="form-label" for="confirm-password">Confirm password</label>
			<input
				id="confirm-password"
				class="form-input"
				class:form-input-error={confirmError}
				type="password"
				name="confirm-password"
				autocomplete="new-password"
				required
				bind:value={confirmPassword}
				onblur={() => (touched.confirmPassword = true)}
				disabled={loading}
			/>
			{#if confirmError}
				<p class="field-error" role="alert">{confirmError}</p>
			{/if}
		</div>

		<button class="submit-btn" type="submit" disabled={loading}>
			{#if loading}
				<span class="spinner" aria-hidden="true"></span>
				Resetting password…
			{:else}
				Reset password
			{/if}
		</button>
	</form>

	<p class="back-link"><a href="/login">Back to sign in</a></p>
{/if}

<style>
	.card-head {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 18px;
		margin-bottom: 28px;
		text-align: center;
	}

	.card-logo {
		width: 44px;
		height: 44px;
	}

	.card-head h1 {
		font-family: var(--font-display);
		font-weight: 500;
		font-size: 28px;
		line-height: 1.2;
		letter-spacing: -0.01em;
		color: var(--ink-0);
		margin: 0;
	}

	.error-banner {
		background: color-mix(in srgb, var(--paper-1) 90%, #f5a623 10%);
		border: 1px solid color-mix(in srgb, var(--line-1) 70%, #f5a623 30%);
		border-radius: 8px;
		padding: 12px 14px;
		margin-bottom: 14px;
	}

	.error-text {
		margin: 0;
		font: 500 13px/1.5 var(--font-sans);
		color: var(--fg-2);
	}

	.error-code {
		margin: 4px 0 0;
		font: 400 11px/1.4 var(--font-sans);
		color: var(--fg-3);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: 14px;
	}

	.form-label {
		font: 500 13px var(--font-sans);
		color: var(--fg-2);
	}

	.form-input {
		width: 100%;
		padding: 10px 14px;
		border: 1px solid var(--line-3);
		border-radius: 8px;
		background: var(--paper-0);
		color: var(--ink-0);
		font: 400 14px var(--font-sans);
		outline: none;
		transition: border-color 140ms;
		box-sizing: border-box;
	}

	.form-input:focus {
		border-color: var(--ink-0);
	}

	.form-input-error {
		border-color: #e53e3e;
	}

	.field-error {
		font: 400 12px var(--font-sans);
		color: #e53e3e;
		margin: 0;
	}

	.submit-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 100%;
		padding: 13px 18px;
		border-radius: 8px;
		border: 1px solid var(--ink-0);
		background: var(--ink-0);
		color: var(--paper-0);
		font: 500 14px/1 var(--font-sans);
		cursor: pointer;
		transition: background 140ms;
	}

	.submit-btn:hover:not(:disabled) {
		background: var(--ink-1);
		border-color: var(--ink-1);
	}

	.submit-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.4);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
		flex-shrink: 0;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.back-link {
		text-align: center;
		font: 400 13px var(--font-sans);
		color: var(--fg-3);
		margin-top: 14px;
		margin-bottom: 0;
	}

	.back-link a {
		color: var(--fg-2);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.back-link a:hover {
		color: var(--ink-0);
	}

	.token-error {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		text-align: center;
		padding: 20px 0;
	}

	.token-error p {
		font: 400 14px/1.6 var(--font-sans);
		color: var(--fg-3);
		margin: 0;
	}

	.token-error a {
		font: 500 13px var(--font-sans);
		color: var(--fg-2);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.token-error a:hover {
		color: var(--ink-0);
	}
</style>
