<script lang="ts">
	import { Avatar as AvatarPrimitive } from "bits-ui";
	import { cn, type WithoutChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChild<AvatarPrimitive.FallbackProps> = $props();
</script>

<AvatarPrimitive.Fallback
	bind:ref
	data-slot="avatar-fallback"
	class={cn("bg-muted flex size-full items-center justify-center rounded-full", className)}
	{...restProps}
>
	{@render children?.()}
</AvatarPrimitive.Fallback>
