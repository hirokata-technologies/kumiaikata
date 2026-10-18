<script lang="ts">
	import { parseAgentMarkdown, type MdBlock, type MdInline } from '$lib/kumiai/planning.js';

	/** Renders agent markdown as elements, never as an HTML string (see parseAgentMarkdown). */
	let { source }: { source: string } = $props();

	const tree = $derived(parseAgentMarkdown(source));
</script>

{#snippet inline(nodes: MdInline[])}
	{#each nodes as node, i (i)}
		{#if node.type === 'text'}{node.text}{:else if node.type === 'strong'}<strong
				>{@render inline(node.children)}</strong
			>{:else if node.type === 'em'}<em>{@render inline(node.children)}</em
			>{:else if node.type === 'del'}<del>{@render inline(node.children)}</del
			>{:else if node.type === 'code'}<code>{node.text}</code
			>{:else if node.type === 'link'}<a href={node.href} target="_blank" rel="noopener noreferrer"
				>{@render inline(node.children)}</a
			>{:else if node.type === 'br'}<br />{/if}
	{/each}
{/snippet}

{#snippet block(nodes: MdBlock[])}
	{#each nodes as node, i (i)}
		{#if node.type === 'paragraph'}
			<p>{@render inline(node.children)}</p>
		{:else if node.type === 'heading'}
			<p class="heading">{@render inline(node.children)}</p>
		{:else if node.type === 'list'}
			<svelte:element this={node.ordered ? 'ol' : 'ul'}>
				{#each node.items as item, j (j)}
					<li>{@render block(item)}</li>
				{/each}
			</svelte:element>
		{:else if node.type === 'code'}
			<pre><code>{node.text}</code></pre>
		{:else if node.type === 'quote'}
			<blockquote>{@render block(node.blocks)}</blockquote>
		{:else if node.type === 'hr'}
			<hr />
		{/if}
	{/each}
{/snippet}

<div class="md">{@render block(tree)}</div>

<style>
	.md {
		font: 400 14px/1.55 var(--font-sans);
		color: var(--fg-1);
		overflow-wrap: anywhere;
	}

	p,
	ul,
	ol,
	pre,
	blockquote {
		margin: 6px 0;
	}

	.md > :first-child {
		margin-top: 2px;
	}

	.md > :last-child {
		margin-bottom: 0;
	}

	ul,
	ol {
		padding-left: 20px;
		list-style: disc;
	}

	ol {
		list-style: decimal;
	}

	li > :global(p) {
		margin: 2px 0;
	}

	.heading {
		margin-top: 10px;
		font-weight: 600;
	}

	code {
		font: 400 12.5px var(--font-mono);
	}

	pre {
		padding: 8px 10px;
		overflow-x: auto;
		background: var(--paper-1);
		border-radius: var(--radius-sm);
	}

	blockquote {
		padding-left: 10px;
		border-left: 2px solid var(--line-3);
		color: var(--fg-2);
	}

	hr {
		border: none;
		border-top: 1px solid var(--line-2);
	}

	a {
		color: var(--accent);
	}
</style>
