<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ModalShell from './ModalShell.svelte';
	import Segmented from './Segmented.svelte';
	import { MONTH_NAMES } from '$lib/kumiai/target-window.js';
	import { isoWeekStart, weekCalendarRows, type PeriodSelection } from '$lib/kumiai/period.js';
	import type { TargetWindowKind } from '$lib/kumiai/types.js';

	let {
		mode,
		subject,
		current,
		onselect,
		onclear,
		onclose
	}: {
		/** `target` sets one project's target window; `filter` picks a period to filter by. */
		mode: 'target' | 'filter';
		/** What is being targeted, shown under the heading. */
		subject: string;
		current: PeriodSelection | null;
		onselect: (period: PeriodSelection) => void;
		onclear: () => void;
		onclose: () => void;
	} = $props();

	function startView(): { kind: TargetWindowKind; year: number; month: number } {
		const now = new Date();
		if (!current) return { kind: 'week', year: now.getFullYear(), month: now.getMonth() + 1 };
		if (current.kind === 'week') {
			const monday = isoWeekStart(current.year, current.number);
			return { kind: 'week', year: monday.getFullYear(), month: monday.getMonth() + 1 };
		}
		return {
			kind: current.kind,
			year: current.year,
			month: current.kind === 'month' ? current.number : now.getMonth() + 1
		};
	}

	const start = startView();
	let viewKind = $state<TargetWindowKind>(start.kind);
	let viewYear = $state(start.year);
	let viewMonth = $state(start.month);

	const rows = $derived(weekCalendarRows(viewYear, viewMonth));
	const heading = $derived(mode === 'filter' ? 'Filter by period' : 'Set target');
	const title = $derived(viewKind === 'week' ? `${MONTH_NAMES[viewMonth - 1]} ${viewYear}` : String(viewYear));

	function step(dir: 1 | -1) {
		if (viewKind !== 'week') {
			viewYear += dir;
			return;
		}
		let m = viewMonth + dir;
		if (m < 1) {
			m = 12;
			viewYear -= 1;
		} else if (m > 12) {
			m = 1;
			viewYear += 1;
		}
		viewMonth = m;
	}

	const isOn = (kind: TargetWindowKind, year: number, number: number) =>
		current?.kind === kind && current.year === year && current.number === number;
</script>

<ModalShell label={heading} {onclose} width={320}>
	<div class="eyebrow">{heading}</div>
	<div class="subject" class:wrap={mode === 'filter'}>
		{mode === 'filter' ? 'Shows projects targeted inside the period you pick' : subject}
	</div>

	<div class="mode">
		<Segmented
			label="Granularity"
			value={viewKind}
			options={[
				{ value: 'week', label: 'Week' },
				{ value: 'month', label: 'Month' },
				{ value: 'quarter', label: 'Quarter' }
			]}
			onselect={(k) => (viewKind = k)}
		/>
	</div>

	<div class="nav">
		<button type="button" class="step" aria-label="Previous" onclick={() => step(-1)}>
			<ChevronLeft size={15} />
		</button>
		<span class="nav-title">{title}</span>
		<button type="button" class="step" aria-label="Next" onclick={() => step(1)}>
			<ChevronRight size={15} />
		</button>
	</div>

	{#if viewKind === 'week'}
		<div class="weeks">
			<div class="week-row head">
				<span></span>
				{#each ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as d, i (i)}<span class="dow">{d}</span>{/each}
			</div>
			{#each rows as row (row.no + ':' + row.days[0].n)}
				<button
					type="button"
					class="week-row week-pick"
					class:is-on={isOn('week', row.year, row.no)}
					onclick={() => onselect({ kind: 'week', year: row.year, number: row.no })}
				>
					<span class="week-no">W{row.no}</span>
					{#each row.days as day, i (i)}
						<span class="day" class:dim={day.dim}>{day.n}</span>
					{/each}
				</button>
			{/each}
		</div>
	{:else if viewKind === 'month'}
		<div class="grid months">
			{#each MONTH_NAMES as name, i (name)}
				<button
					type="button"
					class="cell"
					class:is-on={isOn('month', viewYear, i + 1)}
					onclick={() => onselect({ kind: 'month', year: viewYear, number: i + 1 })}
				>
					{name.slice(0, 3)}
				</button>
			{/each}
		</div>
	{:else}
		<div class="grid quarters">
			{#each [1, 2, 3, 4] as q (q)}
				<button
					type="button"
					class="cell quarter"
					class:is-on={isOn('quarter', viewYear, q)}
					onclick={() => onselect({ kind: 'quarter', year: viewYear, number: q })}
				>
					<span class="q-label">Q{q}</span>
					<span class="q-sub">
						{MONTH_NAMES.slice((q - 1) * 3, q * 3)
							.map((m) => m.slice(0, 3))
							.join(' · ')}
					</span>
				</button>
			{/each}
		</div>
	{/if}

	<div class="foot">
		<button type="button" class="clear" onclick={onclear}>
			{mode === 'filter' ? 'Clear filter' : 'Clear target'}
		</button>
		<button type="button" class="k-btn k-btn-secondary k-btn-sm" onclick={onclose}>Done</button>
	</div>
</ModalShell>

<style>
	.subject {
		margin: 4px 0 14px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font: 400 13px var(--font-sans);
		color: var(--fg-3);
		text-wrap: pretty;
	}

	.subject.wrap {
		white-space: normal;
	}

	.mode {
		margin-bottom: 14px;
	}

	.mode :global(.segmented) {
		display: flex;
	}

	.mode :global(.segmented button) {
		flex: 1;
		padding: 7px 0;
		font-size: 12px;
	}

	.nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
	}

	.nav-title {
		font: 600 13px var(--font-sans);
		color: var(--fg-1);
	}

	.step {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--fg-2);
		cursor: pointer;
	}

	.step:hover {
		background: var(--paper-1);
	}

	.week-row {
		display: grid;
		grid-template-columns: 34px repeat(7, 1fr);
		gap: 2px;
		align-items: center;
	}

	.week-row.head {
		margin-bottom: 6px;
	}

	.dow {
		text-align: center;
		font: 600 10px var(--font-sans);
		color: var(--fg-4);
	}

	.week-pick {
		width: 100%;
		margin-bottom: 1px;
		padding: 5px 0;
		border: none;
		border-radius: var(--radius-md);
		background: transparent;
		cursor: pointer;
	}

	.week-pick:hover {
		background: var(--paper-1);
	}

	.week-pick.is-on {
		background: var(--accent-soft);
	}

	.week-no {
		text-align: center;
		font: 500 11px var(--font-mono);
		color: var(--fg-3);
	}

	.is-on .week-no {
		color: var(--accent);
	}

	.day {
		padding: 5px 0;
		text-align: center;
		font: 400 12px var(--font-sans);
		color: var(--fg-1);
	}

	.day.dim {
		color: var(--fg-4);
	}

	.grid {
		display: grid;
	}

	.months {
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
	}

	.quarters {
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-2);
	}

	.cell {
		padding: 10px 0;
		border: 1px solid var(--line-2);
		border-radius: 6px;
		background: var(--paper-0);
		color: var(--fg-2);
		font: 500 12px var(--font-sans);
		cursor: pointer;
	}

	.cell.is-on {
		background: var(--ink-0);
		border-color: var(--ink-0);
		color: var(--paper-0);
	}

	.quarter {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
		padding: 12px;
		border-radius: var(--radius-md);
	}

	.q-label {
		font: 600 13px var(--font-sans);
	}

	.q-sub {
		font: 400 10px var(--font-mono);
		color: var(--fg-4);
	}

	.is-on .q-sub {
		color: var(--paper-2);
	}

	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px solid var(--line-1);
	}

	.clear {
		padding: 0;
		border: none;
		background: transparent;
		color: var(--fg-3);
		font: 500 12px var(--font-sans);
		cursor: pointer;
	}
</style>
