<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.notFound || !data.project ? 'Project not found' : data.project.title} — Kata</title>
</svelte:head>

{#if data.notFound || !data.project}
	<section class="placeholder">
		<h1>Project not found</h1>
		<p>This project doesn't exist, or you don't have access to it.</p>
	</section>
{:else}
	<section class="placeholder">
		<h1>{data.project.title}</h1>
		<p>Coming soon.</p>
	</section>
{/if}

<style>
	.placeholder {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	h1 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 22px;
		font-weight: 600;
		color: var(--fg-1);
	}

	p {
		margin: 0;
		font: 400 13px var(--font-sans);
		color: var(--fg-3);
	}
</style>
