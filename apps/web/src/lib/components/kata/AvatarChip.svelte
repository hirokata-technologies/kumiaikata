<script lang="ts">
	import { AVATARS } from '$lib/data.js';
	import type { AvatarId } from '$lib/types.js';

	let { id, size = 22 }: { id: AvatarId; size?: number } = $props();

	const A = $derived(AVATARS[id]);
</script>

{#if A}
	<span
		class="avatar"
		style="width: {size}px; height: {size}px; background: {A.tone}; font-size: {size * 0.42}px;"
		title={A.name}
	>
		{A.init}
	</span>
{/if}

<style>
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		color: var(--paper-0);
		font-family: var(--font-sans);
		font-weight: 600;
		flex-shrink: 0;
	}
</style>
