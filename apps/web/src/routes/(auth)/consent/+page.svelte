<script lang="ts">
	import * as Sentry from '@sentry/sveltekit';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let pending = $state<'approve' | 'deny' | null>(null);
	let errorMessage = $state<string | null>(null);

	/**
	 * Send the decision to Better Auth's consent endpoint. The auth client attaches
	 * the signed authorization request (`oauth_query`) from this page's URL; the
	 * response redirects back to the app (with a code, or `access_denied`).
	 */
	async function decide(accept: boolean) {
		pending = accept ? 'approve' : 'deny';
		errorMessage = null;
		try {
			const { data: result, error } = await authClient.$fetch<{ redirect?: boolean; url?: string }>(
				'/oauth2/consent',
				{ method: 'POST', body: { accept } }
			);
			if (error || !result?.url) {
				errorMessage = 'This request has expired. Start the connection again from the app.';
				pending = null;
				return;
			}
			// The auth client's redirect plugin navigates to `result.url`; keep the
			// buttons disabled until the page unloads.
		} catch (err) {
			Sentry.captureException(err);
			errorMessage = 'Something went wrong. Please try again.';
			pending = null;
		}
	}
</script>

<svelte:head>
	<title>Authorize {data.client.name} — Kata</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="form">
	<img class="glyph" src="/logo-mark.png" alt="" />

	<div class="head">
		<h1>Connect {data.client.name}?</h1>
		<p>
			It is asking to use Kumiai as <strong>{data.account.email}</strong>.
		</p>
	</div>

	<div class="panel">
		<p class="panel-title">If you approve, {data.client.name} can:</p>
		<ul class="scopes">
			<li>Read and update your team's Kumiai workspaces — goals, projects, requirements and tasks — on your behalf</li>
			{#each data.scopes as { scope, description } (scope)}
				<li>{description}</li>
			{/each}
		</ul>
		{#if data.redirectHost || data.client.uri}
			<dl class="meta">
				{#if data.client.uri}
					<dt>App website</dt>
					<dd>{data.client.uri}</dd>
				{/if}
				{#if data.redirectHost}
					<dt>Returns you to</dt>
					<dd>{data.redirectHost}</dd>
				{/if}
			</dl>
		{/if}
	</div>

	{#if errorMessage}
		<div class="banner banner-error" role="alert">{errorMessage}</div>
	{/if}

	<div class="actions">
		<Button
			class="w-full"
			size="lg"
			disabled={pending !== null}
			onclick={() => decide(true)}
		>
			{pending === 'approve' ? 'Approving…' : 'Approve'}
		</Button>
		<Button
			class="w-full"
			size="lg"
			variant="outline"
			disabled={pending !== null}
			onclick={() => decide(false)}
		>
			{pending === 'deny' ? 'Denying…' : 'Deny'}
		</Button>
	</div>

	<p class="legal">Only approve apps you trust.</p>
</div>

<style>
	.form {
		width: 100%;
		max-width: 400px;
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
		font-size: 36px;
		line-height: 1.1;
		letter-spacing: -0.02em;
		color: var(--ink-0);
		margin: 0 0 10px;
		overflow-wrap: anywhere;
	}

	.head p {
		margin: 0;
		font-size: 14px;
		color: var(--fg-3);
		line-height: 1.55;
		overflow-wrap: anywhere;
	}

	.head strong {
		color: var(--fg-2);
		font-weight: 500;
	}

	.panel {
		width: 100%;
		border: 1px solid var(--line-1);
		border-radius: var(--radius-md);
		background: var(--paper-0);
		padding: 16px 18px;
		box-sizing: border-box;
	}

	.panel-title {
		margin: 0 0 10px;
		font: 500 13px/1.5 var(--font-sans);
		color: var(--fg-2);
	}

	.scopes {
		margin: 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font: 400 13px/1.5 var(--font-sans);
		color: var(--fg-2);
	}

	.meta {
		margin: 14px 0 0;
		padding-top: 12px;
		border-top: 1px solid var(--line-1);
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 4px 12px;
		font: 400 12px/1.5 var(--font-sans);
	}

	.meta dt {
		color: var(--fg-3);
	}

	.meta dd {
		margin: 0;
		color: var(--fg-2);
		overflow-wrap: anywhere;
	}

	.banner {
		width: 100%;
		border-radius: var(--radius-md);
		padding: 12px 14px;
		box-sizing: border-box;
		font: 500 13px/1.5 var(--font-sans);
		color: var(--fg-2);
	}

	.banner-error {
		background: color-mix(in srgb, var(--paper-1) 90%, var(--warning) 10%);
		border: 1px solid color-mix(in srgb, var(--line-1) 70%, var(--warning) 30%);
	}

	.actions {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.legal {
		font: 400 12px/1.55 var(--font-sans);
		color: var(--fg-4);
		text-align: center;
		margin: 0;
	}

	@media (max-width: 480px) {
		.head h1 {
			font-size: 30px;
		}

		.form {
			gap: 24px;
		}
	}
</style>
