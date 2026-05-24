<script lang="ts">
	import { ShieldCheck } from 'lucide-svelte';
	import { authClient } from '$lib/auth-client';

	let loading = $state(false);

	async function signInWithGoogle() {
		loading = true;
		try {
			await authClient.signIn.social({
				provider: 'google',
				callbackURL: window.location.origin + '/',
			});
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Sign in — Kata</title>
	<meta name="description" content="Sign in to your Kata personal board." />
</svelte:head>

<div class="login-stage">
	<!-- Mist background decoration -->
	<div class="mist-bg" aria-hidden="true"></div>

	<!-- Top bar -->
	<nav class="topbar" aria-label="Site navigation">
		<a class="brand-link" href="/">
			<img class="brand-logo" src="/logo-mark.png" alt="Kata" />
			<span class="brand-wordmark">Kata</span>
		</a>
		<div class="topbar-right">
			<a href="/docs">Docs</a>
			<a href="/login">Sign in</a>
		</div>
	</nav>

	<!-- Login card -->
	<div class="card" role="main">
		<div class="card-head">
			<img class="card-logo" src="/logo-mark.png" alt="Kata logo" />
			<h1>Sign in to Kata</h1>
			<p>Your personal Kanban board for life outside of work.</p>
		</div>

		<div class="card-buttons">
			<!-- Google SSO -->
			<button class="sso-btn" type="button" onclick={signInWithGoogle} disabled={loading}>
				<svg class="sso-logo" viewBox="0 0 18 18" fill="none" aria-hidden="true" focusable="false">
					<path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
					<path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
					<path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
					<path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
				</svg>
				{loading ? 'Signing in…' : 'Continue with Google'}
			</button>

			<!-- Apple SSO -->
			<button class="sso-btn sso-btn-ink" type="button">
				<svg class="sso-logo" viewBox="0 0 18 18" fill="none" aria-hidden="true" focusable="false">
					<path fill="#FBFAF6" d="M14.94 13.84c-.3.69-.66 1.33-1.07 1.92-.56.8-1.02 1.35-1.36 1.65-.55.5-1.13.76-1.75.77-.45 0-.99-.13-1.62-.39-.63-.26-1.21-.39-1.73-.39-.55 0-1.14.13-1.78.39-.64.26-1.16.4-1.56.41-.6.03-1.19-.24-1.77-.79-.38-.33-.85-.9-1.42-1.72-.6-.87-1.1-1.89-1.48-3.05C.12 11.29 0 10.23 0 9.2c0-1.19.26-2.21.77-3.07a4.5 4.5 0 0 1 1.61-1.63A4.33 4.33 0 0 1 4.6 3.9c.47 0 1.08.14 1.84.43.76.29 1.25.43 1.45.43.16 0 .7-.17 1.6-.5.86-.31 1.58-.44 2.18-.4 1.61.13 2.82.76 3.62 1.9-1.44.87-2.15 2.09-2.14 3.64.01 1.21.45 2.22 1.32 3.01.39.37.83.66 1.32.87l-.85 2.56zM11.5.36c0 .95-.35 1.84-1.04 2.65-.83.97-1.84 1.53-2.93 1.44a2.93 2.93 0 0 1-.02-.36c0-.91.4-1.88 1.1-2.67C9.1.72 9.66.37 10.38.1c.71-.27 1.38-.4 2-.4.02.22.03.44.03.66 0 0 .09 0 .09 0z"/>
				</svg>
				Continue with Apple
			</button>
		</div>

		<div class="card-foot">
			<div class="trust">
				<ShieldCheck size={14} />
				<span>Single sign-on only — we never see your password.</span>
			</div>
			<p class="legal">
				By continuing, you agree to our
				<a href="/terms">Terms of Service</a>
				and
				<a href="/privacy">Privacy Policy</a>.
			</p>
		</div>
	</div>

	<!-- Footer -->
	<footer class="footer">
		<span>© HiroKata Studio</span>
		<div class="footer-links">
			<a href="/status">Status</a>
			<a href="/support">Support</a>
			<a href="/docs">Docs</a>
		</div>
	</footer>
</div>

<style>
	:global(body) {
		overflow: auto;
	}

	.login-stage {
		min-height: 100vh;
		background: var(--paper-1);
		display: grid;
		place-items: center;
		position: relative;
		overflow: hidden;
		font-family: var(--font-sans);
	}

	.mist-bg {
		position: absolute;
		inset: auto 0 0 0;
		height: 55%;
		background-image: url('/mist.svg');
		background-repeat: repeat-x;
		background-size: 800px;
		background-position: 50% 100%;
		opacity: 0.05;
		pointer-events: none;
	}

	.topbar {
		position: absolute;
		inset: 0 0 auto 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 24px 32px;
		z-index: 2;
	}

	.brand-link {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		text-decoration: none;
		color: inherit;
	}

	.brand-logo {
		width: 28px;
		height: 28px;
	}

	.brand-wordmark {
		font: 700 13px var(--font-sans);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-0);
	}

	.topbar-right {
		display: flex;
		align-items: center;
		gap: 18px;
		font: 400 13px var(--font-sans);
		color: var(--fg-3);
	}

	.topbar-right a {
		color: var(--fg-2);
		text-decoration: none;
		font-weight: 500;
	}

	.topbar-right a:hover {
		color: var(--ink-0);
	}

	.card {
		position: relative;
		width: 420px;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: 14px;
		box-shadow: var(--shadow-md);
		padding: 40px 40px 32px;
		z-index: 1;
	}

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

	.card-head p {
		margin: 0;
		font-size: 14px;
		color: var(--fg-3);
		line-height: 1.5;
	}

	.card-buttons {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.card-foot {
		margin-top: 22px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.sso-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		width: 100%;
		padding: 13px 18px;
		border-radius: 8px;
		border: 1px solid var(--line-3);
		background: var(--paper-0);
		color: var(--ink-0);
		font: 500 14px/1 var(--font-sans);
		cursor: pointer;
		transition: background 140ms;
	}

	.sso-btn:hover {
		background: var(--paper-1);
	}

	.sso-btn-ink {
		background: var(--ink-0);
		color: var(--paper-0);
		border-color: var(--ink-0);
	}

	.sso-btn-ink:hover {
		background: var(--ink-1);
		border-color: var(--ink-1);
	}

	.sso-logo {
		width: 18px;
		height: 18px;
		display: block;
		flex-shrink: 0;
	}

	.trust {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		font: 400 12px var(--font-sans);
		color: var(--fg-3);
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

	.footer {
		position: absolute;
		inset: auto 0 0 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20px 32px;
		font: 400 12px var(--font-sans);
		color: var(--fg-4);
		z-index: 2;
	}

	.footer-links {
		display: flex;
		gap: 18px;
	}

	.footer a {
		color: var(--fg-3);
		text-decoration: none;
	}

	.footer a:hover {
		color: var(--fg-2);
	}
</style>
