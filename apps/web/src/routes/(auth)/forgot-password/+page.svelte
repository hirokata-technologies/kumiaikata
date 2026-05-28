<script lang="ts">
	import { authClient } from '$lib/auth-client';

	let email = $state('');
	let loading = $state(false);
	let errorMessage = $state<string | null>(null);
	let submitted = $state(false);
	let touched = $state(false);
	let resendCooldown = $state(false);

	let emailError = $derived.by(() => {
		if (!touched) return null;
		if (!email.trim()) return 'Email is required.';
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Please enter a valid email address.';
		return null;
	});

	async function handleRequestReset(event: SubmitEvent) {
		event.preventDefault();
		touched = true;
		if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;

		errorMessage = null;
		loading = true;
		try {
			const { error } = await authClient.requestPasswordReset({
				email: email.trim(),
				redirectTo: `${window.location.origin}/reset-password`,
			});
			if (error && error.status && error.status >= 500) {
				errorMessage = 'Something went wrong. Please try again.';
			} else {
				submitted = true;
			}
		} catch {
			errorMessage = 'Something went wrong. Please try again.';
		} finally {
			loading = false;
		}
	}

	async function handleResend() {
		if (resendCooldown) return;
		resendCooldown = true;
		try {
			await authClient.requestPasswordReset({
				email: email.trim(),
				redirectTo: `${window.location.origin}/reset-password`,
			});
		} catch { /* swallow */ }
		setTimeout(() => { resendCooldown = false; }, 60000);
	}
</script>

<svelte:head>
	<title>Reset password — Kata</title>
	<meta name="description" content="Request a password reset link for your Kata account." />
</svelte:head>

{#if submitted}
	<!-- Sent confirmation state -->
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
				<h1>Check your inbox.</h1>
				<p>If an account exists for this email, we've sent a link to reset your password.</p>
			</div>
			<span class="confirm-mail">{email.trim()}</span>
		</div>

		<a class="primary" href="/login" style="text-decoration: none;">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
			Back to sign in
		</a>

		<p class="switch">
			Didn't get it?
			<button
				type="button"
				class="resend-link"
				onclick={handleResend}
				disabled={resendCooldown}
			>
				{resendCooldown ? 'Sent — check again in a minute' : 'Resend email'}
			</button>
		</p>

		<div class="foot">
			<p class="legal">Still stuck? <a href="/support">Contact support</a>.</p>
		</div>
	</div>
{:else}
	<!-- Request form -->
	<form class="form" onsubmit={handleRequestReset} autocomplete="on" novalidate>
		<a href="/login" class="back-link">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
			Back to sign in
		</a>

		<img class="glyph" src="/logo-mark.png" alt="" />

		<div class="head">
			<h1>Reset your password.</h1>
			<p>Enter the email you signed up with — we'll send a link to set a new one.</p>
		</div>

		{#if errorMessage}
			<div class="banner banner-error" role="alert">
				<p class="banner-text">{errorMessage}</p>
			</div>
		{/if}

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
						onblur={() => (touched = true)}
						disabled={loading}
						class:is-error={emailError}
					/>
				</div>
				{#if emailError}<p class="field-error" role="alert">{emailError}</p>{/if}
			</div>
		</div>

		<button class="primary" type="submit" disabled={loading}>
			{#if loading}
				<span class="spinner" aria-hidden="true"></span>
				Sending…
			{:else}
				Send reset link
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
			{/if}
		</button>

		<p class="switch">Remembered it? <a href="/login">Sign in</a></p>

		<div class="foot">
			<div class="trust">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
				<span>Reset links expire after 30 minutes</span>
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

	/* Back link */
	.back-link {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: 500 13px var(--font-sans);
		color: var(--fg-2);
		text-decoration: none;
		margin-bottom: -8px;
	}

	.back-link:hover { color: var(--ink-0); }
	.back-link svg { width: 14px; height: 14px; }

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
		max-width: 36ch;
		margin-inline: auto;
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

	.field input {
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

	@keyframes spin { to { transform: rotate(360deg); } }

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

	.switch a:hover { color: var(--accent-hover); }

	.resend-link {
		background: none;
		border: none;
		padding: 0;
		color: var(--accent);
		font: 500 13px var(--font-sans);
		cursor: pointer;
		text-decoration: none;
	}

	.resend-link:hover:not(:disabled) { color: var(--accent-hover); }
	.resend-link:disabled { opacity: 0.7; cursor: default; }

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

	.legal {
		font: 400 12px/1.55 var(--font-sans);
		color: var(--fg-4);
		text-align: center;
		margin: 0;
	}

	.legal a { color: var(--fg-3); text-decoration: underline; text-underline-offset: 2px; }
	.legal a:hover { color: var(--ink-0); }

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
