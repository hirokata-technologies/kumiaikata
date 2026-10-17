<script lang="ts">
	import ModalShell from './ModalShell.svelte';

	let {
		projectTitle,
		busy = false,
		onsubmit,
		oncancel
	}: {
		projectTitle: string;
		busy?: boolean;
		onsubmit: (reason: string) => void;
		oncancel: () => void;
	} = $props();

	let reason = $state('');
	const canSubmit = $derived(reason.trim().length > 0 && !busy);

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (canSubmit) onsubmit(reason.trim());
	}
</script>

<ModalShell label="Block project" onclose={oncancel}>
	<form onsubmit={submit}>
		<h2>What is it waiting on?</h2>
		<p class="blurb">{projectTitle} can only be blocked with a reason, so the next person knows what unblocks it.</p>
		<label for="blocked-reason">Reason</label>
		<!-- svelte-ignore a11y_autofocus -->
		<textarea
			id="blocked-reason"
			bind:value={reason}
			rows="3"
			maxlength={2000}
			autofocus
			placeholder="e.g. No agent covers the hl7 capability"
		></textarea>
		<div class="actions">
			<button type="button" class="k-btn k-btn-secondary" onclick={oncancel}>Cancel</button>
			<button type="submit" class="k-btn k-btn-primary" disabled={!canSubmit}>Mark blocked</button>
		</div>
	</form>
</ModalShell>

<style>
	h2 {
		margin: 0;
		font: 400 24px var(--font-display);
		letter-spacing: -0.01em;
		color: var(--fg-1);
	}

	.blurb {
		margin: 6px 0 18px;
		font: 400 13px var(--font-sans);
		color: var(--fg-3);
	}

	label {
		display: block;
		margin-bottom: 6px;
		font: 500 13px var(--font-sans);
		color: var(--fg-2);
	}

	textarea {
		width: 100%;
		resize: vertical;
		padding: 10px 12px;
		border: 1px solid var(--line-3);
		border-radius: var(--radius-md);
		background: var(--paper-0);
		color: var(--fg-1);
		font: 400 14px var(--font-sans);
		outline: none;
	}

	textarea:focus-visible {
		border-color: var(--accent);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 22px;
	}
</style>
