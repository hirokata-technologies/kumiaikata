<script lang="ts" generics="T extends string">
	let {
		options,
		value,
		label,
		onselect
	}: {
		options: Array<{ value: T; label: string }>;
		value: T;
		label: string;
		onselect: (value: T) => void;
	} = $props();
</script>

<div class="segmented" role="group" aria-label={label}>
	{#each options as option (option.value)}
		<button
			type="button"
			class:is-on={option.value === value}
			aria-pressed={option.value === value}
			onclick={() => onselect(option.value)}
		>
			{option.label}
		</button>
	{/each}
</div>

<style>
	.segmented {
		display: inline-flex;
		padding: 3px;
		background: var(--paper-1);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-md);
	}

	button {
		padding: 7px 14px;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--fg-3);
		font: 500 13px/1 var(--font-sans);
		cursor: pointer;
	}

	button.is-on {
		background: var(--paper-0);
		color: var(--ink-0);
		box-shadow:
			0 1px 2px rgba(20, 19, 15, 0.06),
			0 0 0 1px var(--line-1);
	}
</style>
