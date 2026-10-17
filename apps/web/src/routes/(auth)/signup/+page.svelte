<script lang="ts">
	import { authClient } from '$lib/auth-client';
	import {
		EMAIL_SEND_FAILED,
		RESEND_COOLDOWN_SECONDS,
		resendVerificationEmail,
	} from '$lib/resend-verification';
	import * as Sentry from '@sentry/sveltekit';

	const ERROR_MESSAGES: Record<string, string> = {
		USER_ALREADY_EXISTS: 'An account with this email already exists.',
		DOMAIN_NOT_ALLOWED: 'Sign-ups from this email domain are not permitted.',
	};
	const GENERIC_ERROR = 'Something went wrong. Please try again.';

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let showPassword = $state(false);
	let termsChecked = $state(false);
	let loading = $state(false);
	let ssoLoading = $state(false);
	let errorCode = $state<string | null>(null);
	let errorMessage = $state<string | null>(null);
	let submitted = $state(false);
	// The account exists but the API could not send the verification email.
	let emailFailed = $state(false);
	let resendLoading = $state(false);
	let resendSent = $state(false);
	let resendError = $state<string | null>(null);
	let cooldown = $state(0);
	let cooldownTimer: ReturnType<typeof setInterval> | undefined;
	let touched = $state({ name: false, email: false, password: false });

	$effect(() => () => clearInterval(cooldownTimer));

	function startCooldown() {
		clearInterval(cooldownTimer);
		cooldown = RESEND_COOLDOWN_SECONDS;
		cooldownTimer = setInterval(() => {
			cooldown -= 1;
			if (cooldown <= 0) clearInterval(cooldownTimer);
		}, 1000);
	}

	async function resendVerification() {
		if (resendLoading || cooldown > 0) return;
		resendLoading = true;
		resendError = null;
		resendSent = false;
		const result = await resendVerificationEmail(email);
		if (result.ok) {
			resendSent = true;
			emailFailed = false;
			startCooldown();
		} else {
			resendError = result.message;
		}
		resendLoading = false;
	}

	let nameError = $derived(touched.name && !name.trim() ? 'Name is required.' : null);

	let emailError = $derived.by(() => {
		if (!touched.email) return null;
		if (!email.trim()) return 'Email is required.';
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Please enter a valid email address.';
		return null;
	});

	let passwordError = $derived.by(() => {
		if (!touched.password) return null;
		if (!password) return 'Password is required.';
		if (password.length < 8) return 'Password must be at least 8 characters.';
		if (password.length > 128) return 'Password must be no longer than 128 characters.';
		return null;
	});

	let formValid = $derived(
		name.trim().length > 0 &&
			/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
			password.length >= 8 &&
			password.length <= 128 &&
			termsChecked
	);

	// Password strength: 0–4
	let passwordStrength = $derived.by(() => {
		if (!password) return 0;
		let s = 0;
		if (password.length >= 8) s++;
		if (password.length >= 14) s++;
		if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s++;
		if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) s++;
		return Math.min(s, 4);
	});

	const strengthLabels = ['', 'Weak', 'Fair', 'Good', 'Strong'];

	async function signUpWithGoogle() {
		errorCode = null;
		ssoLoading = true;
		Sentry.addBreadcrumb({ category: 'auth', message: 'Google SSO sign-up initiated', level: 'info' });
		try {
			const { error } = await authClient.signIn.social({
				provider: 'google',
				callbackURL: window.location.origin + '/',
			});
			if (error) {
				errorCode = error.code ?? 'unknown';
				errorMessage = ERROR_MESSAGES[errorCode] ?? GENERIC_ERROR;
				Sentry.addBreadcrumb({ category: 'auth', message: `Google SSO sign-up failed: ${errorCode}`, level: 'warning' });
			}
		} catch (err) {
			errorCode = 'unknown';
			errorMessage = GENERIC_ERROR;
			Sentry.captureException(err);
		} finally {
			ssoLoading = false;
		}
	}

	async function handleSignUp(event: SubmitEvent) {
		event.preventDefault();
		touched = { name: true, email: true, password: true };
		if (!formValid) return;
		if (loading) return;

		errorCode = null;
		errorMessage = null;
		loading = true;
		Sentry.addBreadcrumb({ category: 'auth', message: 'Email sign-up initiated', level: 'info' });
		try {
			const { error } = await authClient.signUp.email({
				name: name.trim(),
				email: email.trim(),
				password,
			});
			if (error?.code === EMAIL_SEND_FAILED) {
				// The account was created; only the email failed, so offer to resend it.
				emailFailed = true;
				submitted = true;
				Sentry.addBreadcrumb({ category: 'auth', message: 'Sign-up verification email failed to send', level: 'warning' });
			} else if (error) {
				errorCode = error.code ?? 'unknown';
				errorMessage = ERROR_MESSAGES[errorCode] ?? GENERIC_ERROR;
				Sentry.addBreadcrumb({ category: 'auth', message: `Email sign-up failed: ${errorCode}`, level: 'warning' });
			} else {
				submitted = true;
			}
		} catch (err) {
			errorCode = 'unknown';
			errorMessage = GENERIC_ERROR;
			Sentry.captureException(err);
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Sign up — Kata</title>
	<meta name="description" content="Create a Kata account to manage your personal Kanban board." />
</svelte:head>

{#if submitted}
	<!-- Confirmation state -->
	<div class="form">
		<div class="confirm">
			<div class="confirm-icon" aria-hidden="true">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
					<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
					<polyline points="22,6 12,13 2,6"/>
					<path d="m9 12 2 2 4-4" stroke-width="2"/>
				</svg>
			</div>
			<div class="head">
				{#if emailFailed}
					<h1>Account created.</h1>
					<p>We couldn't send the verification email. Resend it to activate your account.</p>
				{:else}
					<h1>Check your inbox.</h1>
					<p>We've sent a verification email. Click the link to activate your account.</p>
				{/if}
			</div>
			<span class="confirm-mail">{email.trim()}</span>

			{#if resendError}
				<p class="resend-note resend-note-error" role="alert">{resendError}</p>
			{:else if resendSent}
				<p class="resend-note" role="status">Verification email sent again.</p>
			{/if}

			<button
				class="secondary"
				type="button"
				onclick={resendVerification}
				disabled={resendLoading || cooldown > 0}
			>
				{#if resendLoading}
					<span class="spinner spinner-dark" aria-hidden="true"></span>
					Sending…
				{:else if cooldown > 0}
					Resend available in {cooldown}s
				{:else if emailFailed}
					Send verification email
				{:else}
					Didn't get it? Resend email
				{/if}
			</button>
		</div>
		<a class="primary" href="/login" style="text-decoration: none;">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
			Back to sign in
		</a>
	</div>
{:else}
	<form class="form" onsubmit={handleSignUp} autocomplete="on" novalidate>
		<img class="glyph" src="/logo-mark.png" alt="" />

		<div class="head">
			<h1>Create your account.</h1>
			<p>Set up Kata in under a minute.</p>
		</div>

		{#if errorMessage}
			<div class="banner banner-error" role="alert">
				<p class="banner-text">{errorMessage}</p>
				<p class="banner-code">Error: {errorCode ?? 'unknown'}</p>
			</div>
		{/if}

		<!-- Google SSO -->
		<button
			class="sso"
			type="button"
			onclick={signUpWithGoogle}
			disabled={ssoLoading || loading}
			aria-label="Sign up with Google"
		>
			<svg viewBox="0 0 18 18" aria-hidden="true">
				<path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
				<path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
				<path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
				<path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
			</svg>
			{ssoLoading ? 'Connecting…' : 'Sign up with Google'}
		</button>

		<div class="divider"><span>or use your email</span></div>

		<!-- Fields -->
		<div class="fields">
			<div class="field">
				<label for="name">Full name</label>
				<div class="input-wrap">
					<input
						id="name"
						name="name"
						type="text"
						autocomplete="name"
						placeholder="Hiroki Tanaka"
						required
						maxlength="256"
						bind:value={name}
						onblur={() => (touched.name = true)}
						disabled={loading}
						class:is-error={nameError}
					/>
				</div>
				{#if nameError}<p class="field-error" role="alert">{nameError}</p>{/if}
			</div>

			<div class="field">
				<label for="email">Work email</label>
				<div class="input-wrap">
					<input
						id="email"
						name="email"
						type="email"
						autocomplete="email"
						placeholder="you@studio.com"
						required
						bind:value={email}
						onblur={() => (touched.email = true)}
						disabled={loading}
						class:is-error={emailError}
					/>
				</div>
				{#if emailError}<p class="field-error" role="alert">{emailError}</p>{/if}
			</div>

			<div class="field">
				<label for="password">Password</label>
				<div class="input-wrap pw-wrap">
					<input
						id="password"
						name="password"
						type={showPassword ? 'text' : 'password'}
						autocomplete="new-password"
						placeholder="At least 8 characters"
						minlength="8"
						required
						bind:value={password}
						onblur={() => (touched.password = true)}
						disabled={loading}
						class:is-error={passwordError}
					/>
					<button
						type="button"
						class="pw-toggle"
						onclick={() => (showPassword = !showPassword)}
						aria-label={showPassword ? 'Hide password' : 'Show password'}
						aria-pressed={showPassword}
					>
						{#if showPassword}
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

				<!-- Strength meter -->
				{#if password}
					<div class="pw-meter" data-strength={passwordStrength} aria-hidden="true">
						<span></span><span></span><span></span><span></span>
					</div>
					{#if passwordStrength > 0}
						<div class="pw-meter-label">
							<span>Mix letters, numbers, and symbols.</span>
							<span class="pw-strength-label">{strengthLabels[passwordStrength]}</span>
						</div>
					{/if}
				{/if}

				{#if passwordError}<p class="field-error" role="alert">{passwordError}</p>{/if}
			</div>

			<label class="row">
				<input type="checkbox" name="terms" required bind:checked={termsChecked} disabled={loading} />
				<span>I agree to the <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>.</span>
			</label>
		</div>

		<button class="primary" type="submit" disabled={loading || !formValid}>
			{#if loading}
				<span class="spinner" aria-hidden="true"></span>
				Creating account…
			{:else}
				Create account
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
			{/if}
		</button>

		<p class="switch">Already have an account? <a href="/login">Sign in</a></p>

		<div class="foot">
			<div class="trust">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
				<span>Encrypted in transit · we never sell your data</span>
			</div>
		</div>
	</form>
{/if}

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
	}

	.banner {
		width: 100%;
		border-radius: var(--radius-md);
		padding: 12px 14px;
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
		transition: background var(--dur-fast) var(--ease-out);
	}

	.sso:hover:not(:disabled) { background: var(--paper-1); }
	.sso:disabled { opacity: 0.6; cursor: not-allowed; }
	.sso svg { width: 18px; height: 18px; display: block; flex-shrink: 0; }

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

	.field label {
		font: 500 12px var(--font-sans);
		letter-spacing: 0.01em;
		color: var(--fg-2);
	}

	.input-wrap { position: relative; }

	.field input[type='text'],
	.field input[type='email'],
	.field input[type='password'] {
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

	.field input::placeholder { color: var(--fg-4); }
	.field input:hover { border-color: var(--ink-3); }
	.field input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}

	.field input.is-error { border-color: var(--danger); }

	.field-error {
		font: 400 12px var(--font-sans);
		color: var(--danger);
		margin: 0;
	}

	.pw-wrap input { padding-right: 42px; }

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

	.pw-toggle:hover { color: var(--ink-0); background: var(--paper-1); }
	.pw-toggle svg { width: 16px; height: 16px; }

	/* Strength meter */
	.pw-meter {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 4px;
		margin-top: 4px;
	}

	.pw-meter span {
		height: 3px;
		border-radius: 2px;
		background: var(--line-1);
		transition: background var(--dur-fast) var(--ease-out);
	}

	.pw-meter[data-strength='1'] span:nth-child(-n+1) { background: var(--danger); }
	.pw-meter[data-strength='2'] span:nth-child(-n+2) { background: var(--warning); }
	.pw-meter[data-strength='3'] span:nth-child(-n+3) { background: var(--success); }
	.pw-meter[data-strength='4'] span:nth-child(-n+4) { background: var(--success); }

	.pw-meter-label {
		display: flex;
		justify-content: space-between;
		font: 500 11px var(--font-sans);
		color: var(--fg-3);
		margin-top: 6px;
	}

	.pw-strength-label { color: var(--fg-2); }

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
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.row input[type='checkbox']:hover { border-color: var(--ink-3); }
	.row input[type='checkbox']:checked { background: var(--ink-0); border-color: var(--ink-0); }
	.row input[type='checkbox']:checked::after {
		content: '';
		width: 9px;
		height: 5px;
		border-left: 1.5px solid var(--paper-0);
		border-bottom: 1.5px solid var(--paper-0);
		transform: rotate(-45deg) translate(1px, -1px);
	}

	.row a { color: var(--fg-2); text-decoration: underline; text-underline-offset: 2px; }
	.row a:hover { color: var(--ink-0); }

	/* Primary */
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
		transition: background var(--dur-fast), border-color var(--dur-fast);
	}

	.primary:hover:not(:disabled) { background: var(--ink-1); border-color: var(--ink-1); }
	.primary:disabled { opacity: 0.6; cursor: not-allowed; }
	.primary svg { width: 16px; height: 16px; }

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.4);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
		flex-shrink: 0;
	}

	.spinner-dark {
		border-color: var(--line-3);
		border-top-color: var(--ink-0);
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	/* Secondary */
	.secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 100%;
		padding: 12px 18px;
		border-radius: var(--radius-md);
		border: 1px solid var(--line-3);
		background: var(--paper-0);
		color: var(--ink-0);
		font: 500 14px/1 var(--font-sans);
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-out);
	}

	.secondary:hover:not(:disabled) { background: var(--paper-1); }
	.secondary:disabled { opacity: 0.6; cursor: not-allowed; }

	.resend-note {
		margin: 0;
		font: 400 13px/1.5 var(--font-sans);
		color: var(--fg-2);
	}

	.resend-note-error { color: var(--danger); }

	.switch {
		font: 400 13px var(--font-sans);
		color: var(--fg-3);
		text-align: center;
		margin: 0;
	}

	.switch a { color: var(--accent); text-decoration: none; font-weight: 500; }
	.switch a:hover { color: var(--accent-hover); }

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

	.trust svg { width: 13px; height: 13px; flex-shrink: 0; }

	/* Confirmation state */
	.confirm {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 18px;
		text-align: center;
	}

	.confirm-icon {
		width: 56px;
		height: 56px;
		border-radius: 999px;
		background: color-mix(in oklab, var(--success) 14%, var(--paper-0));
		color: var(--success);
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.confirm-icon svg { width: 26px; height: 26px; }

	.confirm-mail {
		font: 500 13px var(--font-mono);
		color: var(--ink-0);
		background: var(--paper-1);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-sm);
		padding: 6px 10px;
		display: inline-block;
	}

	@media (max-width: 480px) {
		.head h1 { font-size: 34px; }
		.form { gap: 24px; }
	}
</style>
