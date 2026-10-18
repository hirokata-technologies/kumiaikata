<script lang="ts">
	import { tick } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Square from '@lucide/svelte/icons/square';
	import PlanningProposal from './PlanningProposal.svelte';
	import AgentMarkdown from './AgentMarkdown.svelte';
	import { PlanningConversation, type PlanningDeps } from '$lib/kumiai/planning.svelte.js';
	import { agentLabel, type DraftWriter, type PlanningIntent } from '$lib/kumiai/planning.js';

	let {
		intent,
		goalTitle = '',
		writer,
		deps,
		onclose,
		oncreated,
		onuseform
	}: {
		intent: PlanningIntent;
		/** The existing goal's name, when planning projects for it. */
		goalTitle?: string;
		/** Creates the reviewed items (the Roadmap passes the kumiai API). */
		writer: DraftWriter;
		/** Overrides the agents API, for tests. */
		deps?: PlanningDeps;
		onclose: () => void;
		/** Called once everything in the draft exists. */
		oncreated: (goalId: string) => void;
		/** Leave the conversation for the plain form. */
		onuseform: () => void;
	} = $props();

	// The panel is mounted per conversation, so reading the props once is intended.
	// svelte-ignore state_referenced_locally
	const chat = new PlanningConversation(intent, deps);

	let message = $state('');
	let transcriptEl: HTMLElement | undefined = $state();
	let inputEl: HTMLTextAreaElement | undefined = $state();

	const isGoal = $derived(intent.kind === 'goal');
	const entries = $derived(chat.transcript.entries);
	const latestProposal = $derived(chat.transcript.proposalVersion);
	const speaker = $derived(chat.transcript.speaker);

	const PARTICIPANTS = [
		{ id: 'user', label: 'You', initials: 'You' },
		{ id: 'project_manager', label: 'Project Manager', initials: 'PM' },
		{ id: 'strategist', label: 'Strategist', initials: 'St' }
	];

	// Keep the newest message in view as the reply streams in.
	$effect(() => {
		void entries.length;
		void entries.at(-1);
		void tick().then(() => transcriptEl?.scrollTo({ top: transcriptEl.scrollHeight }));
	});

	$effect(() => {
		inputEl?.focus();
		return () => chat.stop();
	});

	async function submit(e?: SubmitEvent) {
		e?.preventDefault();
		const text = message;
		if (!text.trim() || chat.busy) return;
		message = '';
		await chat.send(text);
		inputEl?.focus();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			void submit();
		}
	}

	async function create() {
		const goalId = await chat.create(writer);
		if (goalId) oncreated(goalId);
	}

	function handoffLine(from: string, to: string): string {
		return to === 'strategist'
			? `${agentLabel(from)} brought in the ${agentLabel(to)}`
			: `${agentLabel(from)} handed back to the ${agentLabel(to)}`;
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && !chat.creating) onclose();
	}}
/>

<div
	class="backdrop"
	role="presentation"
	onpointerdown={(e) => {
		if (e.target === e.currentTarget && !chat.creating) onclose();
	}}
>
	<div class="panel" role="dialog" aria-modal="true" aria-labelledby="planning-title">
		<header class="head">
			<div>
				<span class="eyebrow">Planning conversation</span>
				<h2 id="planning-title">
					{isGoal ? 'Plan a new goal' : `New projects for ${goalTitle}`}
				</h2>
			</div>
			<button type="button" class="icon" aria-label="Close" onclick={onclose} disabled={chat.creating}>
				<X size={18} />
			</button>
		</header>

		<ul class="cast" aria-label="Participants">
			{#each PARTICIPANTS as p (p.id)}
				<li class:speaking={speaker === p.id} class="who-{p.id}">
					<span class="avatar" aria-hidden="true">{p.initials}</span>
					{p.label}
				</li>
			{/each}
		</ul>

		<div class="transcript" bind:this={transcriptEl} aria-live="polite">
			{#if chat.phase === 'unavailable'}
				<div class="notice">
					<p>The planning agents are not set up on this server, so this conversation can't start.</p>
					<button type="button" class="k-btn k-btn-secondary" onclick={onuseform}>Use the form instead</button>
				</div>
			{:else if entries.length === 0}
				<div class="intro">
					<ol class="steps">
						<li><b>The Project Manager</b> asks about the outcome you want and why it matters now.</li>
						<li><b>The Strategist</b> shapes it into projects, in order, with impact and effort.</li>
						<li><b>You</b> review the draft, edit anything, and create it.</li>
					</ol>
					<p class="prompt">
						{isGoal
							? 'Start by describing what you want to achieve.'
							: `Start by saying what ${goalTitle} still needs.`}
					</p>
				</div>
			{/if}

			{#each entries as entry (entry.id)}
				{#if entry.kind === 'user'}
					<div class="msg user">
						<p>{entry.text}</p>
					</div>
				{:else if entry.kind === 'agent'}
					<div class="msg agent who-{entry.author}">
						<span class="avatar" aria-hidden="true">
							{entry.author === 'strategist' ? 'St' : 'PM'}
						</span>
						<div class="bubble">
							<span class="name">{agentLabel(entry.author)}</span>
							<AgentMarkdown source={entry.text} />
						</div>
					</div>
				{:else if entry.kind === 'handoff'}
					<div class="handoff"><span>{handoffLine(entry.from, entry.to)}</span></div>
				{:else if entry.kind === 'proposal'}
					{#if entry.version === latestProposal && chat.draft}
						<PlanningProposal
							bind:draft={chat.draft}
							version={entry.version}
							{goalTitle}
							creating={chat.creating}
							error={chat.createError}
							oncreate={create}
						/>
					{:else}
						<div class="handoff"><span>Earlier draft, replaced below</span></div>
					{/if}
				{:else if entry.kind === 'error'}
					<p class="error" role="alert">{entry.message}</p>
				{/if}
			{/each}

			{#if chat.busy}
				<div class="thinking" role="status">
					<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
					{agentLabel(speaker ?? 'project_manager')} is thinking…
				</div>
			{/if}
		</div>

		<form class="composer" onsubmit={submit}>
			<textarea
				bind:this={inputEl}
				bind:value={message}
				{onkeydown}
				rows="2"
				maxlength={8000}
				aria-label="Message"
				disabled={chat.phase === 'unavailable'}
				placeholder={chat.draft
					? 'Ask for changes, or press Create on the draft'
					: isGoal
						? 'e.g. Clinicians should finish notes without typing'
						: 'e.g. We still need a pilot on one ward'}
			></textarea>
			{#if chat.busy}
				<button type="button" class="send" aria-label="Stop" onclick={() => chat.stop()}>
					<Square size={14} />
				</button>
			{:else}
				<button
					type="submit"
					class="send"
					aria-label="Send"
					disabled={!message.trim() || chat.phase === 'unavailable'}
				>
					<ArrowUp size={16} />
				</button>
			{/if}
		</form>
		<p class="foot">
			Prefer to fill it in yourself? <button type="button" class="link" onclick={onuseform}>Use the form</button>
		</p>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 80;
		display: flex;
		justify-content: flex-end;
		background: rgba(20, 19, 15, 0.22);
	}

	.panel {
		display: flex;
		flex-direction: column;
		width: min(560px, 100vw);
		height: 100%;
		background: var(--paper-1);
		border-left: 1px solid var(--line-2);
		box-shadow: var(--shadow-lg);
		animation: slide-in var(--dur-base) var(--ease-out);
	}

	@keyframes slide-in {
		from {
			transform: translateX(24px);
			opacity: 0;
		}
	}

	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		padding: 20px 24px 12px;
		background: var(--paper-0);
	}

	.eyebrow {
		font: 500 11px var(--font-mono);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--fg-3);
	}

	h2 {
		margin: 4px 0 0;
		font: 400 24px/1.2 var(--font-display);
		letter-spacing: -0.01em;
		color: var(--ink-1);
	}

	.icon {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--fg-3);
		cursor: pointer;
	}

	.icon:hover {
		background: var(--paper-2);
		color: var(--ink-1);
	}

	.cast {
		display: flex;
		gap: var(--space-2);
		margin: 0;
		padding: 0 24px 14px;
		list-style: none;
		background: var(--paper-0);
		border-bottom: 1px solid var(--line-1);
	}

	.cast li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 10px 3px 3px;
		border: 1px solid var(--line-1);
		border-radius: var(--radius-pill);
		font: 500 12px var(--font-sans);
		color: var(--fg-3);
		transition:
			border-color var(--dur-fast),
			color var(--dur-fast);
	}

	.cast li.speaking {
		border-color: var(--accent);
		color: var(--ink-1);
	}

	.avatar {
		display: grid;
		flex: none;
		place-items: center;
		min-width: 22px;
		height: 22px;
		padding: 0 5px;
		border-radius: var(--radius-pill);
		font: 600 10px var(--font-mono);
		background: var(--paper-2);
		color: var(--ink-2);
	}

	.who-project_manager .avatar {
		background: var(--ink-1);
		color: var(--paper-0);
	}

	.who-strategist .avatar {
		background: var(--accent);
		color: var(--paper-0);
	}

	.transcript {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: 20px 24px;
		overflow-y: auto;
	}

	/* A scrolling flex column would otherwise squash its children (the draft card first). */
	.transcript > :global(*) {
		flex-shrink: 0;
	}

	.intro {
		margin-top: var(--space-2);
	}

	.steps {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin: 0;
		padding: 16px 16px 16px 36px;
		list-style: decimal;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-lg);
		font: 400 13px/1.5 var(--font-sans);
		color: var(--fg-2);
	}

	.steps b {
		font-weight: 600;
		color: var(--ink-1);
	}

	.prompt {
		margin: var(--space-4) 0 0;
		font: 400 14px var(--font-sans);
		color: var(--fg-3);
	}

	.msg {
		display: flex;
		gap: var(--space-3);
		max-width: 92%;
	}

	.msg.user {
		align-self: flex-end;
		padding: 10px 14px;
		background: var(--ink-1);
		border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg);
		color: var(--paper-0);
	}

	.msg.user p {
		margin: 0;
		font: 400 14px/1.5 var(--font-sans);
		white-space: pre-wrap;
	}

	.msg.agent .avatar {
		margin-top: 2px;
	}

	.bubble {
		min-width: 0;
		padding: 10px 14px;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-sm) var(--radius-lg) var(--radius-lg) var(--radius-lg);
	}

	.who-strategist .bubble {
		border-color: color-mix(in srgb, var(--accent) 30%, transparent);
	}

	.name {
		font: 600 11px var(--font-mono);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--fg-3);
	}

	.who-strategist .name {
		color: var(--accent);
	}

	.handoff {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font: 500 11px var(--font-mono);
		color: var(--fg-3);
	}

	.handoff::before,
	.handoff::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--line-2);
	}

	.error,
	.notice p {
		margin: 0;
		font: 500 13px var(--font-sans);
		color: var(--danger);
	}

	.notice {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
		padding: 16px;
		background: var(--danger-soft);
		border-radius: var(--radius-lg);
	}

	.thinking {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font: 400 13px var(--font-sans);
		color: var(--fg-3);
	}

	.dots {
		display: inline-flex;
		gap: 3px;
	}

	.dots i {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--ink-3);
		animation: pulse 1.2s infinite var(--ease-in-out);
	}

	.dots i:nth-child(2) {
		animation-delay: 0.15s;
	}

	.dots i:nth-child(3) {
		animation-delay: 0.3s;
	}

	@keyframes pulse {
		0%,
		80%,
		100% {
			opacity: 0.25;
		}
		40% {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.panel,
		.dots i {
			animation: none;
		}
	}

	.composer {
		display: flex;
		align-items: flex-end;
		gap: var(--space-2);
		margin: 0 24px;
		padding: 8px 8px 8px 14px;
		background: var(--paper-0);
		border: 1px solid var(--line-3);
		border-radius: var(--radius-lg);
	}

	.composer:focus-within {
		border-color: var(--accent);
	}

	textarea {
		flex: 1;
		min-height: 40px;
		max-height: 160px;
		padding: 4px 0;
		border: none;
		background: transparent;
		resize: none;
		field-sizing: content;
		font: 400 14px/1.5 var(--font-sans);
		color: var(--fg-1);
		outline: none;
	}

	.send {
		display: grid;
		flex: none;
		place-items: center;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: var(--radius-md);
		background: var(--ink-0);
		color: var(--paper-0);
		cursor: pointer;
	}

	.send:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.foot {
		margin: 0;
		padding: 10px 24px 16px;
		font: 400 12px var(--font-sans);
		color: var(--fg-3);
	}

	.link {
		padding: 0;
		border: none;
		background: none;
		font: inherit;
		color: var(--accent);
		text-decoration: underline;
		cursor: pointer;
	}
</style>
