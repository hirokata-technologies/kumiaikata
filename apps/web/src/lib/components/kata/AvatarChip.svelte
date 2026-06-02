<script lang="ts">
	import { avatarColor, initials } from '$lib/data.js';

	let {
		id,
		name,
		imageUrl = null,
		size = 22,
	}: { id: string; name: string; imageUrl?: string | null; size?: number } = $props();

	let imgFailed = $state(false);
	const showImage = $derived(!!imageUrl && !imgFailed);
	const init = $derived(initials(name));
	const tone = $derived(avatarColor(id));
</script>

{#if showImage}
	<img
		class="avatar avatar-img"
		src={imageUrl}
		alt={name}
		title={name}
		width={size}
		height={size}
		style="width:{size}px;height:{size}px;"
		onerror={() => (imgFailed = true)}
	/>
{:else}
	<span
		class="avatar"
		style="width:{size}px;height:{size}px;background:{tone};font-size:{size * 0.42}px;"
		title={name}
	>{init}</span>
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

	.avatar-img {
		object-fit: cover;
	}
</style>
