<script lang="ts">
	// Deliberately does not import a bits-ui input primitive — bits-ui ships none (its
	// public export list has no `Input`; only interactive/composite primitives like
	// Avatar and Separator exist there). Upstream shadcn-svelte's own Input component is
	// likewise a plain <input> styled with the shared cn() helper. See review_finding #3
	// / TASK-013.
	import type { HTMLInputAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		type,
		files = $bindable(),
		...restProps
	}: WithElementRef<HTMLInputAttributes> = $props();
</script>

{#if type === "file"}
	<input
		bind:this={ref}
		data-slot="input"
		class={cn(
			"selection:bg-primary selection:text-primary-foreground border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
			"focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
			className
		)}
		type="file"
		bind:files
		bind:value
		{...restProps}
	/>
{:else}
	<input
		bind:this={ref}
		data-slot="input"
		class={cn(
			"border-input placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
			"focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
			className
		)}
		{type}
		bind:value
		{...restProps}
	/>
{/if}
