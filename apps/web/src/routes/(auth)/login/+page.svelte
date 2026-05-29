<script lang="ts">
	import { authClient } from '$lib/auth-client';
	import { page } from '$app/state';
	import * as Sentry from '@sentry/sveltekit';

	const ERROR_MESSAGES: Record<string, string> = {
		access_denied: 'Sign-in was cancelled. Click below to try again.',
		state_mismatch: 'Your sign-in session expired. Please try again.',
		DOMAIN_NOT_ALLOWED: 'Sign-ins from this email domain are not permitted.',
		UNAUTHENTICATED: 'You need to sign in to continue.',
		INVALID_EMAIL_OR_PASSWORD: 'Incorrect email or password.',
		EMAIL_NOT_VERIFIED:
			'Please verify your email before signing in. Check your inbox or request a new verification email.',
	};
	const GENERIC_ERROR = 'Something went wrong. Please try again.';

	let email = $state('');
	let password = $state('');
	let rememberMe = $state(false);
	let showPassword = $state(false);
	let loading = $state(false);
	let ssoLoading = $state(false);
	let errorCode = $state<string | null>(page.url.searchParams.get('error'));
	let verifiedSuccess = $state(page.url.searchParams.get('verified') === 'true');
	let resetSuccess = $state(page.url.searchParams.get('reset') === 'true');
	let resendLoading = $state(false);
	let resendSent = $state(false);
	let resendError = $state<string | null>(null);

	let errorMessage = $derived(errorCode ? (ERROR_MESSAGES[errorCode] ?? GENERIC_ERROR) : null);
	let safeErrorCode = $derived(
		errorCode && /^[a-zA-Z0-9_-]+$/.test(errorCode) ? errorCode : null
	);

	$effect(() => {
		if (errorCode || verifiedSuccess || resetSuccess) {
			history.replaceState(null, '', window.location.pathname);
		}
	});

	async function signInWithGoogle() {
		errorCode = null;
		ssoLoading = true;
		Sentry.addBreadcrumb({ category: 'auth', message: 'Google SSO sign-in initiated', level: 'info' });
		try {
			const { error } = await authClient.signIn.social({
				provider: 'google',
				callbackURL: window.location.origin + '/',
			});
			if (error) {
				errorCode = error.code ?? 'unknown';
				Sentry.addBreadcrumb({ category: 'auth', message: `Google SSO failed: ${errorCode}`, level: 'warning' });
			}
		} catch (err) {
			errorCode = 'unknown';
			Sentry.captureException(err);
		} finally {
			ssoLoading = false;
		}
	}

	async function signInWithEmail(event: SubmitEvent) {
		event.preventDefault();
		errorCode = null;
		loading = true;
		Sentry.addBreadcrumb({ category: 'auth', message: 'Email sign-in initiated', level: 'info' });
		try {
			const { error } = await authClient.signIn.email({
				email,
				password,
				rememberMe,
				callbackURL: '/',
			});
			if (error) {
				errorCode = error.code ?? 'unknown';
				Sentry.addBreadcrumb({ category: 'auth', message: `Email sign-in failed: ${errorCode}`, level: 'warning' });
			}
		} catch (err) {
			errorCode = 'unknown';
			Sentry.captureException(err);
		} finally {
			loading = false;
		}
	}

	async function resendVerification() {
		resendLoading = true;
		resendError = null;
		try {
			const { error } = await authClient.sendVerificationEmail({
				email: email.trim(),
				callbackURL: '/login?verified=true',
			});
			if (error) {
				resendError = 'Failed to send verification email. Please try again.';
			} else {
				resendSent = true;
			}
		} catch (err) {
			Sentry.captureException(err);
			resendError = 'Failed to send verification email. Please try again.';
		} finally {
			resendLoading = false;
		}
	}
</script>

<svelte:head>
	<title>Sign in — Kata</title>
	<meta name="description" content="Sign in to your Kata personal board." />
</svelte:head>

<form class="form" onsubmit={signInWithEmail} autocomplete="on" novalidate>
	<img class="glyph" src="/logo-mark.png" alt="" />

	<div class="head">
		<h1>Welcome back.</h1>
		<p>Sign in to pick up where you left off.</p>
	</div>

	<!-- Success banners -->
	{#if verifiedSuccess}
		<div class="banner banner-success" role="status">
			Email verified — you can now sign in.
		</div>
	{/if}

	{#if resetSuccess}
		<div class="banner banner-success" role="status">
			Password updated — please sign in with your new password.
		</div>
	{/if}

	<!-- Error banner -->
	{#if errorMessage}
		<div class="banner banner-error" role="alert">
			<p class="banner-text">{errorMessage}</p>
			<p class="banner-code">Error: {safeErrorCode ?? 'unknown'}</p>
			{#if errorCode === 'EMAIL_NOT_VERIFIED'}
				{#if resendSent}
					<p class="banner-text" style="margin-top: 6px;">
						If that address is registered and unverified, a new link has been sent.
					</p>
				{:else}
					<button
						class="resend-btn"
						type="button"
						onclick={resendVerification}
						disabled={resendLoading}
					>
						{resendLoading ? 'Sending…' : 'Resend verification email'}
					</button>
					{#if resendError}
						<p class="banner-hint">{resendError}</p>
					{/if}
				{/if}
			{/if}
		</div>
	{/if}

	<!-- Google SSO -->
	<button
		class="sso"
		type="button"
		onclick={signInWithGoogle}
		disabled={ssoLoading || loading}
		aria-label="Continue with Google"
	>
		<svg viewBox="0 0 18 18" aria-hidden="true">
			<path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
			<path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
			<path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
			<path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
		</svg>
		{ssoLoading ? 'Signing in…' : 'Continue with Google'}
	</button>

	<!-- Divider -->
	<div class="divider"><span>or continue with email</span></div>

	<!-- Fields -->
	<div class="fields">
		<div class="field">
			<label for="email">Email</label>
			<div class="input-wrap">
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					placeholder="you@studio.com"
					required
					bind:value={email}
					disabled={loading}
				/>
			</div>
		</div>

		<div class="field">
			<div class="field-row">
				<label for="password">Password</label>
				<a href="/forgot-password" class="field-link">Forgot?</a>
			</div>
			<div class="input-wrap pw-wrap">
				<input
					id="password"
					name="password"
					type={showPassword ? 'text' : 'password'}
					autocomplete="current-password"
					placeholder="••••••••"
					required
					bind:value={password}
					disabled={loading}
				/>
				<button
					type="button"
					class="pw-toggle"
					onclick={() => (showPassword = !showPassword)}
					aria-label={showPassword ? 'Hide password' : 'Show password'}
					aria-pressed={showPassword}
				>
					{#if showPassword}
						<!-- eye-off -->
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
							<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
							<line x1="1" y1="1" x2="23" y2="23"/>
						</svg>
					{:else}
						<!-- eye -->
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
							<circle cx="12" cy="12" r="3"/>
						</svg>
					{/if}
				</button>
			</div>
		</div>

		<label class="row">
			<input type="checkbox" name="remember" bind:checked={rememberMe} disabled={loading} />
			<span>Keep me signed in on this device</span>
		</label>
	</div>

	<button class="primary" type="submit" disabled={loading || !email || !password}>
		{#if loading}
			<span class="spinner" aria-hidden="true"></span>
			Signing in…
		{:else}
			Sign in
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
		{/if}
	</button>

	<p class="switch">Don't have an account? <a href="/signup">Sign up</a></p>

	<div class="foot">
		<div class="trust">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
			<span>Encrypted in transit · we never sell your data</span>
		</div>
		<p class="legal">
			By continuing you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.
		</p>
	</div>
</form>

<style>
	.form {
		width: 100%;
		max-width: 380px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 28px;
	}

	.glyph {
		width: 52px;
		height: 52px;
		display: block;
	}

	.head {
		text-align: center;
	}

	.head h1 {
		font-family: var(--font-display);
		font-weight: 500;
		font-size: 40px;
		line-height: 1.05;
		letter-spacing: -0.02em;
		color: var(--ink-0);
		margin: 0 0 10px;
	}

	.head p {
		margin: 0;
		font-size: 14px;
		color: var(--fg-3);
		line-height: 1.55;
		max-width: 38ch;
		margin-inline: auto;
	}

	/* Banners */
	.banner {
		width: 100%;
		border-radius: var(--radius-md);
		padding: 12px 14px;
	}

	.banner-success {
		background: color-mix(in srgb, var(--paper-1) 90%, var(--success) 10%);
		border: 1px solid color-mix(in srgb, var(--line-1) 70%, var(--success) 30%);
		font: 500 13px/1.5 var(--font-sans);
		color: var(--fg-2);
	}

	.banner-error {
		background: color-mix(in srgb, var(--paper-1) 90%, var(--warning) 10%);
		border: 1px solid color-mix(in srgb, var(--line-1) 70%, var(--warning) 30%);
	}

	.banner-text {
		margin: 0;
		font: 500 13px/1.5 var(--font-sans);
		color: var(--fg-2);
	}

	.banner-code {
		margin: 4px 0 0;
		font: 400 11px/1.4 var(--font-sans);
		color: var(--fg-3);
	}

	.banner-hint {
		margin: 6px 0 0;
		font: 400 12px/1.4 var(--font-sans);
		color: var(--fg-3);
	}

	.resend-btn {
		background: none;
		border: none;
		color: var(--fg-2);
		text-decoration: underline;
		cursor: pointer;
		font: 400 13px var(--font-sans);
		padding: 0;
		margin-top: 6px;
		display: block;
	}

	.resend-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* SSO */
	.sso {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		width: 100%;
		padding: 12px 18px;
		border-radius: var(--radius-md);
		border: 1px solid var(--line-3);
		background: var(--paper-0);
		color: var(--ink-0);
		font: 500 14px/1 var(--font-sans);
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.sso:hover:not(:disabled) {
		background: var(--paper-1);
	}

	.sso:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.sso svg {
		width: 18px;
		height: 18px;
		display: block;
		flex-shrink: 0;
	}

	/* Divider */
	.divider {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		font: 500 11px var(--font-sans);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--fg-4);
	}

	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--line-1);
	}

	/* Fields */
	.fields {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.field-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}

	.field label {
		font: 500 12px var(--font-sans);
		letter-spacing: 0.01em;
		color: var(--fg-2);
	}

	.field-link {
		font: 500 12px var(--font-sans);
		color: var(--accent);
		text-decoration: none;
	}

	.field-link:hover {
		color: var(--accent-hover);
	}

	.input-wrap {
		position: relative;
	}

	.field input[type='email'],
	.field input[type='password'],
	.field input[type='text'] {
		width: 100%;
		padding: 11px 14px;
		border: 1px solid var(--line-3);
		border-radius: var(--radius-md);
		background: var(--paper-0);
		color: var(--ink-0);
		font: 400 14px/1.3 var(--font-sans);
		transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
		-webkit-appearance: none;
		appearance: none;
		box-sizing: border-box;
		outline: none;
	}

	.field input::placeholder {
		color: var(--fg-4);
	}

	.field input:hover {
		border-color: var(--ink-3);
	}

	.field input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}

	.pw-wrap input {
		padding-right: 42px;
	}

	.pw-toggle {
		position: absolute;
		right: 6px;
		top: 50%;
		transform: translateY(-50%);
		width: 32px;
		height: 32px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 0;
		background: transparent;
		color: var(--fg-3);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.pw-toggle:hover {
		color: var(--ink-0);
		background: var(--paper-1);
	}

	.pw-toggle svg {
		width: 16px;
		height: 16px;
	}

	/* Checkbox row */
	.row {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		font: 400 13px/1.5 var(--font-sans);
		color: var(--fg-2);
		user-select: none;
		cursor: pointer;
	}

	.row input[type='checkbox'] {
		appearance: none;
		-webkit-appearance: none;
		width: 16px;
		height: 16px;
		border: 1px solid var(--line-3);
		border-radius: 4px;
		background: var(--paper-0);
		display: inline-grid;
		place-content: center;
		cursor: pointer;
		margin-top: 2px;
		flex-shrink: 0;
		transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.row input[type='checkbox']:hover {
		border-color: var(--ink-3);
	}

	.row input[type='checkbox']:checked {
		background: var(--ink-0);
		border-color: var(--ink-0);
	}

	.row input[type='checkbox']:checked::after {
		content: '';
		width: 9px;
		height: 5px;
		border-left: 1.5px solid var(--paper-0);
		border-bottom: 1.5px solid var(--paper-0);
		transform: rotate(-45deg) translate(1px, -1px);
	}

	/* Primary button */
	.primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 100%;
		padding: 13px 18px;
		border-radius: var(--radius-md);
		border: 1px solid var(--ink-0);
		background: var(--ink-0);
		color: var(--paper-0);
		font: 500 14px/1 var(--font-sans);
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
	}

	.primary:hover:not(:disabled) {
		background: var(--ink-1);
		border-color: var(--ink-1);
	}

	.primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.primary svg {
		width: 16px;
		height: 16px;
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

	/* Switch link */
	.switch {
		font: 400 13px var(--font-sans);
		color: var(--fg-3);
		text-align: center;
		margin: 0;
	}

	.switch a {
		color: var(--accent);
		text-decoration: none;
		font-weight: 500;
	}

	.switch a:hover {
		color: var(--accent-hover);
	}

	/* Footer */
	.foot {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
	}

	.trust {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font: 400 12px var(--font-sans);
		color: var(--fg-3);
	}

	.trust svg {
		width: 13px;
		height: 13px;
		flex-shrink: 0;
	}

	.legal {
		font: 400 12px/1.55 var(--font-sans);
		color: var(--fg-4);
		text-align: center;
		margin: 0;
	}

	.legal a {
		color: var(--fg-3);
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 2px;
	}

	.legal a:hover {
		color: var(--ink-0);
	}

	@media (max-width: 480px) {
		.head h1 {
			font-size: 34px;
		}

		.form {
			gap: 24px;
		}
	}
</style>
