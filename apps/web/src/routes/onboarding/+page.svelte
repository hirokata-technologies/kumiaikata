<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { Check, ArrowLeft, ArrowRight } from '@lucide/svelte';
	import {
		AI_DESCS,
		AI_LABELS,
		EXAMPLES,
		LAST_STEP,
		DEFINED_LEVELS,
		GENERATED_LEVELS,
		PM_DESCS,
		PM_LABELS,
		PRIORITIES,
		SPLIT,
		STEPS,
		STRUCTURE_READ_SECONDS,
		TARGETS,
		TEAM,
		TITLES,
		canAdvance,
		tipsFor,
	} from '$lib/onboarding';

	let step = $state(0);
	let pm = $state<number | null>(null);
	let ai = $state<number | null>(null);
	let exIdx = $state<number | 'custom' | null>(null);
	let custom = $state('');
	let priority = $state<(typeof PRIORITIES)[number]>('High');
	let target = $state(1);
	let kept = $state([true, true, true]);
	let approved = $state(false);
	let revOpen = $state(false);
	let revText = $state('');
	let rev = $state('');
	let readLeft = $state(STRUCTURE_READ_SECONDS);
	let finishing = $state(false);
	let error = $state('');

	const novicePM = $derived(pm === 0);
	const noviceAI = $derived(ai === 0);
	const ex = $derived(exIdx == null ? null : exIdx === 'custom' ? EXAMPLES[0] : EXAMPLES[exIdx]);
	const goal = $derived(exIdx === 'custom' ? custom.trim() : (ex?.goal ?? ''));
	const refined = $derived(exIdx === 'custom' ? custom.trim() : (ex?.refined ?? ''));
	const keptReqs = $derived(ex ? ex.reqs.filter((_, i) => kept[i]) : []);
	const plan = $derived(ex?.plan ?? { title: '', note: '', tasks: [] });
	const planNote = $derived(rev ? `Revised for your note "${rev}". ${plan.note}` : plan.note);
	const tips = $derived(tipsFor(step, novicePM, noviceAI));
	const canNext = $derived(
		canAdvance(step, {
			pm,
			ai,
			goal,
			hasExample: exIdx != null,
			keptCount: keptReqs.length,
			approved,
			structureRead: readLeft === 0,
		}),
	);

	const subs = $derived([
		'Two questions. Setup adjusts to your answers.',
		novicePM
			? 'You define two things: a goal and a project. Your AI team creates the rest.'
			: 'You define the goal and project. The PM and Strategist create the rest.',
		'Two AI leads and a roster of agents. You make the calls.',
		'Pick one to try, or write your own. The PM will sharpen it.',
		'The PM proposed a project for this goal. Set priority and a target.',
		'The PM drafted these. Keep what is right.',
		'The Strategist planned the first requirement. Approve it to release tasks to agents.',
		'Tasks are queued. The PM reports progress on the board.',
	]);

	const tailor = $derived(
		pm == null || ai == null
			? ''
			: `${novicePM ? 'New to project management' : 'Experienced with projects'}, ${noviceAI ? 'new to AI agents' : 'used to delegating to AI'}.`,
	);

	const summary = $derived([
		{ k: 'Goal', v: refined },
		{ k: 'Project', v: ex?.project ?? '' },
		{ k: 'Priority', v: priority },
		{ k: 'Target', v: TARGETS[target] },
		{ k: 'Requirements', v: keptReqs.join('; ') },
		{ k: 'Plan', v: `${plan.title} (approved, ${plan.tasks.length} tasks released)` },
	]);

	// Counts down only while step 2 is on screen; once it hits zero it stays unlocked.
	$effect(() => {
		if (step !== 1 || readLeft === 0) return;
		const id = setInterval(() => {
			readLeft -= 1;
			if (readLeft === 0) clearInterval(id);
		}, 1000);
		return () => clearInterval(id);
	});

	function go(n: number) {
		step = Math.max(0, Math.min(LAST_STEP, n));
	}

	function restart() {
		step = 0;
		pm = ai = exIdx = null;
		custom = '';
		priority = 'High';
		target = 1;
		kept = [true, true, true];
		approved = revOpen = false;
		readLeft = STRUCTURE_READ_SECONDS;
		revText = rev = '';
	}

	function sendRevision() {
		const text = revText.trim();
		if (!text) return;
		rev = text;
		revText = '';
		revOpen = false;
		approved = false;
	}

	function onCustomInput() {
		if (custom.trim()) exIdx = 'custom';
		else if (exIdx === 'custom') exIdx = null;
	}

	/** Flags the user as onboarded, then leaves the guide. Only reachable from the last step ("Open workspace"); onboarding cannot be skipped. */
	async function finish() {
		if (finishing) return;
		finishing = true;
		error = '';
		try {
			const res = await fetch('/api/users/me/onboarding/complete', { method: 'POST' });
			if (!res.ok) throw new Error();
		} catch {
			error = 'Could not save your progress. Try again.';
			finishing = false;
			return;
		}
		await invalidateAll();
		await goto('/week');
	}

	function next() {
		if (!canNext) return;
		if (step === LAST_STEP) void finish();
		else go(step + 1);
	}
</script>

<svelte:head>
	<title>Set up your workspace · Kumiaikata</title>
</svelte:head>

<div class="shell">
	<aside class="rail">
		<div class="brand">
			<img src="/logo-mark.png" alt="" width="28" height="28" />
			<span class="brand-name">KUMIAIKATA</span>
		</div>
		<div class="eyebrow rail-label">Setup</div>
		<ol class="steps">
			{#each STEPS as label, i (label)}
				{@const done = i < step}
				<li>
					<button
						type="button"
						class="step"
						class:current={i === step}
						class:done
						disabled={!done}
						onclick={() => go(i)}
						aria-current={i === step ? 'step' : undefined}
					>
						<span class="dot">
							{#if done}<Check size={14} />{:else}{i + 1}{/if}
						</span>
						<span class="step-label">{label}</span>
					</button>
				</li>
			{/each}
		</ol>
		<div class="grow"></div>
		{#if step > 0 && tailor}
			<div class="tailor">
				<div class="eyebrow">Tailored for</div>
				<p>{tailor}</p>
				<button type="button" class="link" onclick={() => go(0)}>Change</button>
			</div>
		{/if}
	</aside>

	<div class="main">
		<div class="scroll">
			<div class="content">
				<div class="eyebrow">Step {step + 1} of {STEPS.length}</div>
				<h1>{TITLES[step]}</h1>
				<p class="sub">{subs[step]}</p>

				{#if step === 0}
					<div class="stack-28">
						<div>
							<div class="q">How familiar are you with project management?</div>
							<div class="grid-2">
								{#each PM_LABELS as label, i (label)}
									<button type="button" class="opt card-opt" class:on={pm === i} onclick={() => (pm = i)}>
										<span class="opt-title">{label}</span>
										<span class="opt-desc">{PM_DESCS[i]}</span>
									</button>
								{/each}
							</div>
						</div>
						<div>
							<div class="q">Have you delegated work to AI agents before?</div>
							<div class="grid-2">
								{#each AI_LABELS as label, i (label)}
									<button type="button" class="opt card-opt" class:on={ai === i} onclick={() => (ai = i)}>
										<span class="opt-title">{label}</span>
										<span class="opt-desc">{AI_DESCS[i]}</span>
									</button>
								{/each}
							</div>
						</div>
					</div>
				{:else if step === 1}
					<div class="stack-24">
						<section>
							<div class="eyebrow group-label">You define</div>
							<div class="levels">
								{#each DEFINED_LEVELS as l, i (l.name)}
									<div class="level">
										<div>
											<div class="level-name">{l.name}</div>
											<div class="mono-sm">{l.q}</div>
										</div>
										<div>
											<div class="level-desc"><span class="order">{i + 1}</span>{l.desc}</div>
											{#if novicePM}<div class="eg">e.g. {l.eg}</div>{/if}
										</div>
									</div>
								{/each}
							</div>
						</section>
						<section>
							<div class="eyebrow group-label">Created for you</div>
							<div class="levels generated">
								{#each GENERATED_LEVELS as l (l.name)}
									<div class="level">
										<div>
											<div class="level-name">{l.name}</div>
											<div class="mono-sm">{l.q}</div>
										</div>
										<div>
											<div class="level-desc">{l.desc}</div>
											<div class="by">Created by the {l.by}</div>
											{#if novicePM}<div class="eg">e.g. {l.eg}</div>{/if}
										</div>
									</div>
								{/each}
							</div>
						</section>
					</div>
				{:else if step === 2}
					<div class="stack-24">
						<div class="grid-2">
							{#each TEAM as t (t.name)}
								<div class="person">
									<span class="avatar" style:background={t.bg} style:color={t.fg}>{t.ini}</span>
									<div>
										<div class="person-name">{t.name}</div>
										<div class="role">{t.role}</div>
										<div class="person-does">{t.does}</div>
									</div>
								</div>
							{/each}
						</div>
						{#if noviceAI}
							<div class="grid-2">
								{#each SPLIT as g (g.title)}
									<div class="split">
										<div class="split-title">{g.title}</div>
										{#each g.items as item (item)}<div class="split-item">{item}</div>{/each}
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{:else if step === 3}
					<div class="stack-10">
						{#each EXAMPLES as e, i (e.goal)}
							<button
								type="button"
								class="opt row-opt"
								class:on={exIdx === i}
								onclick={() => {
									exIdx = i;
									custom = '';
								}}>{e.goal}</button
							>
						{/each}
						<div class="eyebrow own-label">Or write your own</div>
						<input
							class="text-input"
							class:on={exIdx === 'custom'}
							bind:value={custom}
							oninput={onCustomInput}
							placeholder="What outcome do you want?"
							aria-label="Your own goal"
						/>
					</div>
				{:else if step === 4 && ex}
					<div class="stack-20">
						<div class="panel">
							<div class="eyebrow">Goal, sharpened by the PM</div>
							<div class="refined">{refined}</div>
							<div class="rule"></div>
							<div class="eyebrow">Proposed project</div>
							<div class="project">{ex.project}</div>
							<div class="project-why">{ex.projectWhy}</div>
							<div class="meters">
								<div>
									<div class="meter-label">Impact {ex.impact}</div>
									<div class="bar"><div class="fill accent" style:width="{ex.impact}%"></div></div>
								</div>
								<div>
									<div class="meter-label">Effort {ex.effort}</div>
									<div class="bar"><div class="fill" style:width="{ex.effort * 10}%"></div></div>
								</div>
								<span class="mono-sm">PM estimate</span>
							</div>
						</div>
						<div class="grid-2 gap-20">
							<div>
								<div class="q-sm">Priority</div>
								<div class="pills">
									{#each PRIORITIES as p (p)}
										<button type="button" class="opt pill" class:on={priority === p} onclick={() => (priority = p)}>{p}</button>
									{/each}
								</div>
							</div>
							<div>
								<div class="q-sm">Target</div>
								<div class="pills">
									{#each TARGETS as label, i (label)}
										<button type="button" class="opt pill" class:on={target === i} onclick={() => (target = i)}>{label}</button>
									{/each}
								</div>
							</div>
						</div>
					</div>
				{:else if step === 5 && ex}
					<div class="stack-10">
						{#each ex.reqs as r, i (r)}
							<div class="req" class:removed={!kept[i]}>
								<span class="mono-sm">REQ-00{i + 1}</span>
								<span class="req-title">{r}</span>
								<button type="button" class="small-btn" onclick={() => (kept[i] = !kept[i])}>
									{kept[i] ? 'Remove' : 'Restore'}
								</button>
							</div>
						{/each}
						<div class="mono-md">{keptReqs.length} of {ex.reqs.length} kept</div>
					</div>
				{:else if step === 6}
					<div class="panel">
						<div class="plan-head">
							<span class="avatar sm" style:background="var(--accent)" style:color="var(--paper-0)">ST</span>
							<span class="plan-who">AI Project Strategist</span>
							<span class="grow"></span>
							<span class="mono-sm">PLAN-001 · {rev ? 'v2' : 'v1'}</span>
							<span class="badge" class:ok={approved}>{approved ? 'Plan approved' : 'Awaiting approval'}</span>
						</div>
						<div class="project">{plan.title}</div>
						<div class="project-why">{planNote}</div>
						<ul class="tasks">
							{#each plan.tasks as t (t.title)}
								<li>
									<span class="task-title">{t.title}</span>
									<span class="agent-chip">{t.agent}</span>
								</li>
							{/each}
						</ul>
						<div class="actions">
							<button
								type="button"
								class="btn-primary"
								class:ok={approved}
								onclick={() => {
									approved = true;
									revOpen = false;
								}}>{approved ? 'Approved' : 'Approve plan'}</button
							>
							<button type="button" class="btn-outline" onclick={() => (revOpen = !revOpen)}>Ask for changes</button>
						</div>
						{#if revOpen}
							<div class="actions">
								<input
									class="text-input grow"
									bind:value={revText}
									placeholder="What should change?"
									aria-label="What should change?"
									onkeydown={(e) => e.key === 'Enter' && sendRevision()}
								/>
								<button type="button" class="btn-primary" onclick={sendRevision}>Send</button>
							</div>
						{/if}
					</div>
				{:else if step === 7}
					<div class="summary">
						{#each summary as r (r.k)}
							<div class="summary-row">
								<span class="eyebrow">{r.k}</span>
								<span class="summary-val">{r.v}</span>
							</div>
						{/each}
						<button type="button" class="link restart" onclick={restart}>Restart setup</button>
					</div>
				{/if}

				{#if tips.length}
					<div class="tips">
						{#each tips as t (t.title)}
							<div class="tip">
								<div class="tip-title">{t.title}</div>
								<div class="tip-body">{t.body}</div>
							</div>
						{/each}
					</div>
				{/if}

				{#if error}<p class="error" role="alert">{error}</p>{/if}
			</div>
		</div>

		<footer class="footer">
			{#if step > 0}
				<button type="button" class="btn-outline" onclick={() => go(step - 1)}>
					<ArrowLeft size={16} /> Back
				</button>
			{/if}
			<span class="grow"></span>
			<button type="button" class="btn-primary next" disabled={!canNext || finishing} onclick={next}>
				{step === LAST_STEP ? 'Open workspace' : step === 1 && readLeft > 0 ? `Continue in ${readLeft}s` : 'Continue'}
				<ArrowRight size={16} />
			</button>
		</footer>
	</div>
</div>

<style>
	.shell {
		height: 100vh;
		display: flex;
		background: var(--paper-0);
		color: var(--fg-2);
		overflow: hidden;
	}
	.grow {
		flex: 1;
	}

	/* Rail */
	.rail {
		width: 300px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		padding: 28px 20px;
		background: var(--paper-1);
		border-right: 1px solid var(--line-1);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 8px;
	}
	.brand-name {
		font: 700 13px var(--font-sans);
		letter-spacing: 0.06em;
		color: var(--ink-0);
	}
	.rail-label {
		padding: 40px 8px 12px;
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.step {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 9px 8px;
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		text-align: left;
		cursor: default;
		color: var(--fg-4);
	}
	.step.done {
		cursor: pointer;
		color: var(--fg-2);
	}
	.step.current {
		color: var(--fg-1);
	}
	.step-label {
		font: 500 14px var(--font-sans);
	}
	.step.current .step-label {
		font-weight: 600;
	}
	.dot {
		width: 24px;
		height: 24px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		font: 600 11px var(--font-mono);
		color: var(--fg-4);
		box-shadow: inset 0 0 0 1px var(--line-3);
	}
	.step.current .dot {
		background: var(--accent);
		color: var(--paper-0);
		box-shadow: none;
	}
	.step.done .dot {
		background: var(--ink-0);
		color: var(--paper-0);
		box-shadow: none;
	}
	.tailor {
		padding: 14px;
		border: 1px solid var(--line-1);
		border-radius: 10px;
		background: var(--paper-0);
	}
	.tailor p {
		margin: 6px 0 0;
		font: 400 13px/1.5 var(--font-sans);
		color: var(--fg-2);
	}

	/* Main */
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.scroll {
		flex: 1;
		overflow: auto;
		padding: 56px 80px 40px;
	}
	.content {
		max-width: 680px;
	}
	h1 {
		margin: 8px 0 0;
		font: 500 34px var(--font-display);
		letter-spacing: -0.015em;
		color: var(--ink-1);
	}
	.sub {
		margin: 8px 0 32px;
		font: 400 15px/1.55 var(--font-sans);
		color: var(--fg-3);
		text-wrap: pretty;
	}
	.footer {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px 80px;
		border-top: 1px solid var(--line-1);
	}

	/* Layout helpers */
	.stack-10 {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.stack-20 {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.stack-24 {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
	.stack-28 {
		display: flex;
		flex-direction: column;
		gap: 28px;
	}
	.grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.grid-2.gap-20 {
		gap: 20px;
	}

	/* Type */
	.q {
		margin-bottom: 12px;
		font: 600 15px var(--font-sans);
		color: var(--fg-1);
	}
	.q-sm {
		margin-bottom: 10px;
		font: 600 14px var(--font-sans);
		color: var(--fg-1);
	}
	.mono-sm {
		font: 400 11px var(--font-mono);
		color: var(--fg-4);
	}
	.mono-md {
		margin-top: 4px;
		font: 400 12px var(--font-mono);
		color: var(--fg-3);
	}

	/* Selectable options */
	.opt {
		border: 1px solid var(--line-2);
		background: var(--paper-0);
		color: var(--fg-1);
		cursor: pointer;
	}
	.opt.on {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent);
	}
	.card-opt {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 16px;
		border-radius: 10px;
		text-align: left;
	}
	.opt-title {
		font: 600 14px var(--font-sans);
	}
	.opt-desc {
		font: 400 13px/1.45 var(--font-sans);
		color: var(--fg-3);
	}
	.row-opt {
		padding: 14px 16px;
		border-radius: 10px;
		text-align: left;
		font: 500 14px var(--font-sans);
	}
	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.pill {
		padding: 8px 14px;
		border-radius: 999px;
		font: 500 13px var(--font-sans);
	}
	.own-label {
		margin-top: 14px;
	}
	.text-input {
		height: 44px;
		padding: 0 14px;
		border-radius: var(--radius-md);
		border: 1px solid var(--line-3);
		background: var(--paper-0);
		font: 400 14px var(--font-sans);
		color: var(--fg-1);
		outline: none;
	}
	.text-input:focus-visible,
	.text-input.on {
		border-color: var(--accent);
	}

	/* How work is structured */
	.levels {
		border-top: 1px solid var(--line-1);
	}
	.level {
		display: grid;
		grid-template-columns: 160px 1fr;
		gap: 20px;
		padding: 16px 0;
		border-bottom: 1px solid var(--line-1);
	}
	.level-name {
		font: 500 20px var(--font-display);
		color: var(--ink-1);
	}
	.level-desc {
		font: 400 14px/1.5 var(--font-sans);
		color: var(--fg-2);
	}
	.group-label {
		margin-bottom: 8px;
	}
	.order {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		margin-right: 8px;
		border-radius: 50%;
		background: var(--ink-0);
		color: var(--paper-0);
		font: 600 11px var(--font-sans);
	}
	.generated .level-name {
		color: var(--fg-2);
	}
	.by {
		margin-top: 6px;
		font: 400 12px var(--font-mono);
		color: var(--fg-3);
	}
	.eg {
		margin-top: 6px;
		font: 400 12px var(--font-mono);
		color: var(--fg-3);
	}

	/* Team */
	.person {
		display: flex;
		gap: 12px;
		padding: 16px;
		border: 1px solid var(--line-1);
		border-radius: var(--radius-lg);
		background: var(--paper-0);
		box-shadow: var(--shadow-sm);
	}
	.avatar {
		width: 36px;
		height: 36px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		font: 600 11px var(--font-sans);
	}
	.avatar.sm {
		width: 28px;
		height: 28px;
		font-size: 10px;
	}
	.person-name {
		font: 600 14px var(--font-sans);
		color: var(--fg-1);
	}
	.role {
		margin-top: 3px;
		font: 600 10px var(--font-sans);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg-3);
	}
	.person-does {
		margin-top: 6px;
		font: 400 13px/1.45 var(--font-sans);
		color: var(--fg-2);
	}
	.split {
		padding: 16px;
		border-radius: 10px;
		background: var(--paper-1);
	}
	.split-title {
		margin-bottom: 8px;
		font: 600 13px var(--font-sans);
		color: var(--fg-1);
	}
	.split-item {
		font: 400 13px/1.7 var(--font-sans);
		color: var(--fg-2);
	}

	/* Project / plan panel */
	.panel {
		padding: 20px;
		border: 1px solid var(--line-1);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}
	.refined {
		margin-top: 6px;
		font: 500 19px/1.4 var(--font-display);
		color: var(--ink-1);
		text-wrap: pretty;
	}
	.rule {
		height: 1px;
		margin: 18px 0;
		background: var(--line-1);
	}
	.project {
		margin-top: 6px;
		font: 600 17px var(--font-sans);
		color: var(--fg-1);
	}
	.project-why {
		margin-top: 4px;
		font: 400 14px/1.5 var(--font-sans);
		color: var(--fg-2);
		text-wrap: pretty;
	}
	.meters {
		display: flex;
		align-items: flex-end;
		gap: 32px;
		margin-top: 16px;
	}
	.meter-label {
		margin-bottom: 6px;
		font: 600 10px var(--font-sans);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg-4);
	}
	.bar {
		width: 120px;
		height: 5px;
		border-radius: 999px;
		overflow: hidden;
		background: var(--paper-2);
	}
	.fill {
		height: 100%;
		background: var(--ink-3);
	}
	.fill.accent {
		background: var(--accent);
	}

	/* Requirements */
	.req {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px 16px;
		border: 1px solid var(--line-1);
		border-radius: 10px;
		background: var(--paper-0);
	}
	.req.removed {
		background: var(--paper-1);
	}
	.req-title {
		flex: 1;
		font: 500 14px var(--font-sans);
		color: var(--fg-1);
	}
	.req.removed .req-title {
		color: var(--fg-4);
		text-decoration: line-through;
	}
	.small-btn {
		padding: 6px 12px;
		border: 1px solid var(--line-2);
		border-radius: 6px;
		background: var(--paper-0);
		font: 500 12px var(--font-sans);
		color: var(--fg-2);
		cursor: pointer;
	}

	/* Plan */
	.plan-head {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 14px;
	}
	.plan-who {
		font: 500 13px var(--font-sans);
		color: var(--fg-2);
	}
	.badge {
		padding: 3px 9px;
		border-radius: 999px;
		background: var(--warning-soft);
		color: var(--warning);
		font: 500 11px var(--font-sans);
	}
	.badge.ok {
		background: var(--success-soft);
		color: var(--success);
	}
	.tasks {
		list-style: none;
		margin: 14px 0 0;
		padding: 0;
		border-top: 1px solid var(--line-1);
	}
	.tasks li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
		border-bottom: 1px solid var(--line-1);
	}
	.task-title {
		flex: 1;
		font: 400 13px var(--font-sans);
		color: var(--fg-1);
	}
	.agent-chip {
		padding: 3px 8px;
		border-radius: 999px;
		background: var(--paper-1);
		font: 500 11px var(--font-mono);
		color: var(--fg-2);
	}
	.actions {
		display: flex;
		gap: 10px;
		margin-top: 16px;
	}
	.actions .text-input {
		height: 40px;
		padding: 0 12px;
	}

	/* Summary */
	.summary {
		border-top: 1px solid var(--line-1);
	}
	.summary-row {
		display: grid;
		grid-template-columns: 140px 1fr;
		gap: 16px;
		padding: 12px 0;
		border-bottom: 1px solid var(--line-1);
	}
	.summary-row .eyebrow {
		padding-top: 2px;
	}
	.summary-val {
		font: 400 14px/1.5 var(--font-sans);
		color: var(--fg-1);
	}
	.restart {
		margin-top: 16px;
	}

	/* Tips */
	.tips {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 12px;
		margin-top: 28px;
	}
	.tip {
		padding: 16px;
		border-radius: 10px;
		background: var(--paper-1);
	}
	.tip-title {
		font: 600 13px var(--font-sans);
		color: var(--fg-1);
	}
	.tip-body {
		margin-top: 4px;
		font: 400 13px/1.5 var(--font-sans);
		color: var(--fg-2);
		text-wrap: pretty;
	}
	.error {
		margin: 16px 0 0;
		font: 500 13px var(--font-sans);
		color: var(--danger);
	}

	/* Buttons */
	.btn-primary,
	.btn-outline {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px;
		border-radius: var(--radius-md);
		font: 500 14px var(--font-sans);
		cursor: pointer;
	}
	.btn-primary {
		border: none;
		background: var(--ink-0);
		color: var(--paper-0);
	}
	.btn-primary.ok {
		background: var(--success);
	}
	.btn-primary.next {
		padding: 10px 18px;
	}
	.btn-outline {
		border: 1px solid var(--line-2);
		background: var(--paper-0);
		color: var(--fg-1);
	}
	.btn-primary:disabled {
		background: var(--paper-2);
		color: var(--fg-4);
		cursor: not-allowed;
	}
	.link {
		padding: 0;
		border: none;
		background: transparent;
		font: 500 13px var(--font-sans);
		color: var(--accent);
		cursor: pointer;
	}
	.link:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.tailor .link {
		margin-top: 8px;
	}

	button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	@media (max-width: 900px) {
		.shell {
			flex-direction: column;
			overflow: auto;
		}
		.rail {
			width: auto;
			border-right: none;
			border-bottom: 1px solid var(--line-1);
		}
		.steps,
		.rail-label,
		.tailor {
			display: none;
		}
		.scroll,
		.footer {
			padding-inline: 20px;
		}
		.grid-2 {
			grid-template-columns: 1fr;
		}
		.level {
			grid-template-columns: 1fr;
			gap: 6px;
		}
	}
</style>
