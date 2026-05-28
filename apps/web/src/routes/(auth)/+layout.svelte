<script lang="ts">
	let { children } = $props();
</script>

<div class="stage">
	<header class="topbar">
		<a href="/" class="mark">
			<img src="/logo-mark.png" alt="" class="mark-img" />
			<span class="mark-text">HIROKATA</span>
		</a>
	</header>

	<main class="main">
		{@render children()}
	</main>

	<footer class="footer">
		<span>© HiroKata Studio</span>
		<nav class="footer-links">
			<a href="/terms">Terms</a>
			<a href="/privacy">Privacy</a>
			<a href="/support">Support</a>
		</nav>
	</footer>
</div>

<style>
	:global(body) {
		overflow: auto;
	}

	.stage {
		position: relative;
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* Mist background decoration */
	.stage::after {
		content: '';
		position: absolute;
		inset: 0;
		background-image: url('/mist.svg');
		background-repeat: no-repeat;
		background-size: 1200px;
		background-position: 50% 105%;
		opacity: 0.035;
		pointer-events: none;
		z-index: 0;
	}

	/* Top bar */
	.topbar {
		position: relative;
		z-index: 2;
		display: flex;
		align-items: center;
		padding: 24px 32px;
	}

	.mark {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		text-decoration: none;
		color: inherit;
	}

	.mark-img {
		width: 28px;
		height: 28px;
		display: block;
	}

	.mark-text {
		font: 700 13px var(--font-sans);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-0);
	}

	/* Main centered form area */
	.main {
		position: relative;
		z-index: 1;
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 32px 24px 56px;
	}

	/* Footer */
	.footer {
		position: relative;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20px 32px;
		font: 400 12px var(--font-sans);
		color: var(--fg-4);
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

	@media (max-width: 480px) {
		.topbar,
		.footer {
			padding-inline: 20px;
		}
	}
</style>
