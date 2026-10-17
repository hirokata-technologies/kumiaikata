<script lang="ts">
	import type { PageProps } from './$types';
	import { invalidateAll } from '$app/navigation';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import PageHeader from '$lib/components/kumiai/PageHeader.svelte';
	import FilterChips from '$lib/components/kumiai/FilterChips.svelte';
	import Pill from '$lib/components/kumiai/Pill.svelte';
	import BarSlider from '$lib/components/kumiai/BarSlider.svelte';
	import TargetPicker from '$lib/components/kumiai/TargetPicker.svelte';
	import LoadError from '$lib/components/kumiai/LoadError.svelte';
	import { projectPriorityPill, quadrantOf, QUADRANT_LABELS, statusPill } from '$lib/kumiai/index.js';
	import { buildProjectViews, displayId, shortId } from '$lib/kumiai/derive.js';
	import { saveProject } from '$lib/kumiai/actions.js';
	import { formatTargetWindow } from '$lib/kumiai/target-window.js';
	import {
		currentPeriod,
		matchesPeriod,
		periodLabel,
		toTargetWindow,
		type PeriodSelection
	} from '$lib/kumiai/period.js';
	import type { TargetWindowKind } from '$lib/kumiai/types.js';

	let { data }: PageProps = $props();

	type FilterKind = 'all' | 'none' | TargetWindowKind;

	/** The plot keeps an 11% margin on every side so dots at the extremes stay inside it. */
	const MARGIN = 0.11;
	const SPAN = 1 - 2 * MARGIN;

	let filterKind = $state<FilterKind>('all');
	let filterPeriod = $state<PeriodSelection>(currentPeriod('quarter', new Date()));
	let pickerFor = $state<'filter' | 'target' | null>(null);
	let pickerKind = $state<TargetWindowKind>('quarter');
	let selId = $state<string | null>(null);
	let dragId = $state<string | null>(null);
	/** Scores changed here but not yet saved or refetched. */
	let draft = $state<Record<string, { impact?: number; effort?: number }>>({});
	let plot: HTMLElement | undefined = $state();
	let error = $state<string | null>(null);

	const views = $derived(
		buildProjectViews(data.workspace).map((v) => ({
			...v,
			impact: draft[v.project.id]?.impact ?? v.project.impact,
			effort: draft[v.project.id]?.effort ?? v.project.effort
		}))
	);
	const live = $derived(
		views.filter((v) => {
			if (v.project.status === 'done') return false;
			if (filterKind === 'all') return true;
			if (filterKind === 'none') return !v.project.targetWindow;
			return matchesPeriod(v.project.targetWindow, { ...filterPeriod, kind: filterKind });
		})
	);
	const selected = $derived(live.find((v) => v.project.id === selId) ?? live[0] ?? null);
	const filterOptions = $derived([
		{ value: 'all', label: 'All' },
		{ value: 'quarter', label: filterKind === 'quarter' ? periodLabel(filterPeriod) : 'By quarter' },
		{ value: 'month', label: filterKind === 'month' ? periodLabel(filterPeriod) : 'By month' },
		{ value: 'week', label: filterKind === 'week' ? periodLabel(filterPeriod) : 'By week' },
		{ value: 'none', label: 'No target' }
	]);
	const pickerCurrent = $derived<PeriodSelection | null>(
		pickerFor === 'target'
			? selected?.project.targetWindow
				? {
						kind: selected.project.targetWindow.kind,
						year: selected.project.targetWindow.year,
						number: selected.project.targetWindow.number
					}
				: null
			: { ...filterPeriod, kind: pickerKind }
	);

	const xPct = (effort: number) => ((effort - 1) / 9) * (SPAN * 100) + MARGIN * 100;
	const yPct = (impact: number) => 100 - (((impact - 1) / 99) * (SPAN * 100) + MARGIN * 100);

	function pointToScores(e: PointerEvent): { impact: number; effort: number } | null {
		if (!plot) return null;
		const r = plot.getBoundingClientRect();
		const fx = Math.min(1, Math.max(0, (e.clientX - r.left - r.width * MARGIN) / (r.width * SPAN)));
		const fy = Math.min(1, Math.max(0, 1 - (e.clientY - r.top - r.height * MARGIN) / (r.height * SPAN)));
		return { effort: Math.round(fx * 9) + 1, impact: Math.round(fy * 99) + 1 };
	}

	async function commit(id: string, patch: { impact?: number; effort?: number }) {
		error = await saveProject(id, patch);
		await invalidateAll();
		delete draft[id];
	}

	function onFilter(value: string) {
		if (value === 'quarter' || value === 'month' || value === 'week') {
			pickerKind = value;
			pickerFor = 'filter';
			return;
		}
		filterKind = value as FilterKind;
	}
</script>

<svelte:head>
	<title>Impact &amp; effort — Kata</title>
</svelte:head>

{#if data.failed}<LoadError />{/if}

<PageHeader
	eyebrow="Prioritisation"
	title="Impact & effort"
	sub="Impact runs 1 to 100, effort 1 to 10. Drag a project to re-score it; the quadrants split at the midpoints."
/>

<div class="filters">
	<FilterChips label="Target period" value={filterKind} options={filterOptions} onselect={onFilter} />
	<span class="count">{live.length} {live.length === 1 ? 'project' : 'projects'} plotted</span>
</div>

{#if error}<p class="error" role="alert">{error}</p>{/if}

<div class="layout">
	<div class="plot-card">
		<div class="plot-wrap">
			<div class="axis-y"><span>Impact</span></div>
			<div class="plot-col">
				<div class="plot" bind:this={plot}>
					<div class="mid-h"></div>
					<div class="mid-v"></div>
					<span class="quad tl">Quick wins</span>
					<span class="quad tr">Big bets</span>
					<span class="quad bl">Fill-ins</span>
					<span class="quad br">Money pits</span>
					{#each live as view (view.project.id)}
						{@const on = selected?.project.id === view.project.id}
						<button
							type="button"
							class="dot"
							class:is-on={on}
							style:left="{xPct(view.effort)}%"
							style:top="{yPct(view.impact)}%"
							style:z-index={on ? 5 : 1}
							aria-label="{view.project.title}: impact {view.impact}, effort {view.effort}"
							onclick={() => (selId = view.project.id)}
							onpointerdown={(e) => {
								e.preventDefault();
								e.currentTarget.setPointerCapture(e.pointerId);
								dragId = view.project.id;
								selId = view.project.id;
							}}
							onpointermove={(e) => {
								if (dragId !== view.project.id) return;
								const scores = pointToScores(e);
								if (scores) draft[view.project.id] = scores;
							}}
							onpointerup={() => {
								if (dragId !== view.project.id) return;
								dragId = null;
								const scores = draft[view.project.id];
								if (scores) void commit(view.project.id, scores);
							}}
							onpointercancel={() => {
								dragId = null;
								delete draft[view.project.id];
							}}
						>
							<span
								class="dot-colour"
								style:background={projectPriorityPill(view.project.priority).dotHex}
							></span>
							<span class="dot-label">{shortId(view.project.id)}</span>
						</button>
					{/each}
					{#if live.length === 0}
						<div class="plot-empty">No project matches this filter.</div>
					{/if}
				</div>
				<div class="axis-x">
					<span>effort 1</span>
					<span class="axis-name">Effort</span>
					<span>effort 10</span>
				</div>
			</div>
		</div>
	</div>

	{#if selected}
		{@const p = selected.project}
		<aside class="detail">
			<div class="eyebrow">{QUADRANT_LABELS[quadrantOf(selected.impact, selected.effort)]}</div>
			<div class="tags">
				<span class="id" title={p.id}>{displayId(p.id)}</span>
				<Pill variant="priority" pill={projectPriorityPill(p.priority)} />
			</div>
			<h3>{p.title}</h3>
			<div class="goal">{selected.goal?.title ?? ''}</div>

			<div class="control">
				<div class="control-head">
					<span class="eyebrow">Impact</span>
					<span class="value">{selected.impact}</span>
				</div>
				<BarSlider
					kind="impact"
					label="Impact"
					value={selected.impact}
					onchange={(v) => (draft[p.id] = { ...draft[p.id], impact: v })}
					oncommit={(v) => void commit(p.id, { impact: v })}
				/>
			</div>
			<div class="control">
				<div class="control-head">
					<span class="eyebrow">Effort</span>
					<span class="value">{selected.effort} / 10</span>
				</div>
				<BarSlider
					kind="effort"
					label="Effort"
					value={selected.effort}
					onchange={(v) => (draft[p.id] = { ...draft[p.id], effort: v })}
					oncommit={(v) => void commit(p.id, { effort: v })}
				/>
			</div>

			<dl class="facts">
				<div>
					<dt>Status</dt>
					<dd>{statusPill(p.status).label}</dd>
				</div>
				<div>
					<dt>Target</dt>
					<dd>
						<button type="button" class="target" onclick={() => (pickerFor = 'target')}>
							<span>{p.targetWindow ? formatTargetWindow(p.targetWindow) : 'none'}</span>
							<CalendarDays size={14} />
						</button>
					</dd>
				</div>
				<div>
					<dt>Requirements</dt>
					<dd class="mono">{selected.reqsDone} / {selected.reqsTotal}</dd>
				</div>
			</dl>
			<a class="k-btn k-btn-primary open" href="/projects/{p.id}">Open project</a>
		</aside>
	{/if}
</div>

{#if pickerFor}
	<TargetPicker
		mode={pickerFor}
		subject={selected ? `${displayId(selected.project.id)} · ${selected.project.title}` : ''}
		current={pickerCurrent}
		onselect={(period) => {
			if (pickerFor === 'filter') {
				filterKind = period.kind;
				filterPeriod = period;
			} else if (selected) {
				void saveProject(selected.project.id, { targetWindow: toTargetWindow(period) }).then(
					(failure) => {
						error = failure;
						return invalidateAll();
					}
				);
			}
			pickerFor = null;
		}}
		onclear={() => {
			if (pickerFor === 'filter') {
				filterKind = 'all';
			} else if (selected) {
				void saveProject(selected.project.id, { targetWindow: null }).then((failure) => {
					error = failure;
					return invalidateAll();
				});
			}
			pickerFor = null;
		}}
		onclose={() => (pickerFor = null)}
	/>
{/if}

<style>
	.filters {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: 18px;
	}

	.count {
		margin-left: 4px;
		font: 400 12px var(--font-mono);
		color: var(--fg-4);
	}

	.error {
		margin: 0 0 var(--space-4);
		font: 500 13px var(--font-sans);
		color: var(--danger);
	}

	.layout {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: var(--space-5);
	}

	.plot-card {
		flex: 1 1 440px;
		min-width: 0;
		padding: 22px 24px 18px;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}

	.plot-wrap {
		display: flex;
		gap: 14px;
	}

	.axis-y {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
	}

	.axis-y span,
	.axis-name {
		font: 600 11px var(--font-sans);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--fg-3);
	}

	.axis-y span {
		writing-mode: vertical-rl;
		transform: rotate(180deg);
	}

	.plot-col {
		flex: 1;
		min-width: 0;
	}

	.plot {
		position: relative;
		height: 460px;
		border: 1px solid var(--line-2);
		border-radius: var(--radius-md);
		background: var(--paper-0);
		touch-action: none;
	}

	.mid-h,
	.mid-v {
		position: absolute;
		background: var(--line-2);
	}

	.mid-h {
		left: 0;
		right: 0;
		top: 50%;
		height: 1px;
	}

	.mid-v {
		top: 0;
		bottom: 0;
		left: 50%;
		width: 1px;
	}

	.quad {
		position: absolute;
		font: 600 11px var(--font-sans);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg-4);
	}

	.tl {
		left: 14px;
		top: 12px;
	}

	.tr {
		right: 14px;
		top: 12px;
	}

	.bl {
		left: 14px;
		bottom: 12px;
	}

	.br {
		right: 14px;
		bottom: 12px;
	}

	.dot {
		position: absolute;
		transform: translate(-50%, -50%);
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 5px 10px 5px 7px;
		border: 1px solid var(--line-2);
		border-radius: var(--radius-pill);
		background: var(--paper-0);
		box-shadow: var(--shadow-sm);
		cursor: grab;
		touch-action: none;
	}

	.dot.is-on {
		border-color: var(--ink-0);
		box-shadow: var(--shadow-md);
	}

	.dot-colour {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.dot-label {
		white-space: nowrap;
		font: 500 11px var(--font-mono);
		color: var(--fg-2);
	}

	.plot-empty {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font: 400 13px var(--font-sans);
		color: var(--fg-4);
	}

	.axis-x {
		display: flex;
		justify-content: space-between;
		margin-top: var(--space-2);
		font: 400 11px var(--font-mono);
		color: var(--fg-4);
	}

	.detail {
		flex: 1 1 300px;
		max-width: 360px;
		padding: 22px;
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}

	.detail .eyebrow {
		margin-bottom: 10px;
	}

	.tags {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.id {
		font: 500 11px var(--font-mono);
		color: var(--fg-4);
	}

	h3 {
		margin: 10px 0 4px;
		font: 400 22px var(--font-display);
		letter-spacing: -0.01em;
		color: var(--ink-1);
	}

	.goal {
		font: 400 13px var(--font-sans);
		color: var(--fg-3);
	}

	.control {
		margin-top: 22px;
	}

	.control-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: var(--space-2);
	}

	.control-head .eyebrow {
		margin: 0;
	}

	.value {
		font: 400 20px var(--font-display);
		color: var(--ink-0);
	}

	.facts {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 22px 0 0;
		padding-top: 18px;
		border-top: 1px solid var(--line-1);
	}

	.facts div {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	dt {
		font: 400 13px var(--font-sans);
		color: var(--fg-3);
	}

	dd {
		margin: 0;
		font: 500 13px var(--font-sans);
		color: var(--fg-1);
	}

	dd.mono {
		font-family: var(--font-mono);
	}

	.target {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 5px 9px;
		border: 1px solid var(--line-2);
		border-radius: 6px;
		background: transparent;
		color: var(--fg-1);
		font: 500 13px var(--font-mono);
		cursor: pointer;
	}

	.target:hover {
		background: var(--paper-1);
	}

	.target :global(svg) {
		color: var(--fg-3);
	}

	.open {
		width: 100%;
		margin-top: 20px;
	}
</style>
