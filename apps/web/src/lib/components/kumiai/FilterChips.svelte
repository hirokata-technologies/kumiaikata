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

<div class="chips" role="group" aria-label={label}>
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
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	button {
		padding: 6px 12px;
		border: 1px solid var(--line-2);
		border-radius: var(--radius-pill);
		background: var(--paper-0);
		color: var(--fg-2);
		font: 500 12px var(--font-sans);
		cursor: pointer;
	}

	button.is-on {
		background: var(--ink-0);
		border-color: var(--ink-0);
		color: var(--paper-0);
	}
</style>
