<script lang="ts">
	import { untrack } from 'svelte';
	import { Layers, Folder, FolderMinus } from '@lucide/svelte';
	import type { KataCard, KataLabel, KataProject, MemberInfo } from '$lib/types.js';
	import { parseISO, daysBetween } from '$lib/data.js';
	import {
		RM_DIMS, RM_MONTHS, RM_WEEK_DAYS, RM_DEFAULT_SPAN,
		rmStartOfDay, rmDaysInMonth, rmAddDays, rmIso, rmFullDate, rmWeekRange,
		packLane, loadSchedule, saveSchedule,
		type ScheduleMap, type RoadmapDensity, type RoadmapLayout,
	} from '$lib/roadmap.js';
	import DueBadge from './DueBadge.svelte';
	import LabelChip from './LabelChip.svelte';
	import AvatarChip from './AvatarChip.svelte';

	let {
		cards,
		boardId,
		density = 'comfortable',
		layout = 'swimlane',
		showCompleted = true,
		cardStyle = 'detailed',
		query = '',
		activeProjectId = null,
		statusOf,
		statusTitleOf,
		spanBars = true,
		overdueRail = true,
		heat = true,
		showMist = true,
		boardProjects,
		boardLabels,
		boardMembers,
		onCardOpen,
	}: {
		cards: KataCard[];
		boardId: string;
		density?: RoadmapDensity;
		layout?: RoadmapLayout;
		showCompleted?: boolean;
		cardStyle?: 'detailed' | 'minimal';
		query?: string;
		activeProjectId?: string | null;
		statusOf: (cardId: string) => string | undefined;
		statusTitleOf: (columnId: string) => string;
		spanBars?: boolean;
		overdueRail?: boolean;
		heat?: boolean;
		showMist?: boolean;
		boardProjects: KataProject[];
		boardLabels: KataLabel[];
		boardMembers: MemberInfo[];
		onCardOpen?: (id: string) => void;
	} = $props();

	const D = $derived(RM_DIMS[density] ?? RM_DIMS.comfortable);

	const projectMap = $derived(new Map(boardProjects.map((p) => [p.id, p])));
	const labelMap = $derived(new Map(boardLabels.map((l) => [l.id, l])));
	const memberMap = $derived(new Map(boardMembers.map((m) => [m.id, m])));

	function projectOf(card: KataCard): KataProject | null {
		return card.projectId ? projectMap.get(card.projectId) ?? null : null;
	}
	function toneOf(card: KataCard): string {
		return projectOf(card)?.color ?? 'var(--fg-4)';
	}
	function firstAssignee(card: KataCard): MemberInfo | null {
		const id = card.assignees[0];
		if (!id) return null;
		return memberMap.get(id) ?? { id, name: 'Unknown', email: '', imageUrl: null };
	}
	function isDone(cardId: string): boolean {
		const col = statusOf(cardId) ?? '';
		// Real boards give the Done column a random id with title "Done"; the seed
		// uses the literal id 'done'. Accept either.
		return col === 'done' || statusTitleOf(col).trim().toLowerCase() === 'done';
	}

	// --- Schedule: cardId → {start, due}. Seeded from due dates (default span),
	//     overridden by anything the user has dragged (persisted locally). ---
	let sched = $state<ScheduleMap>(untrack(() => loadSchedule(boardId)));

	// Reconcile when the card set changes: seed any newly-dated card, drop the gone.
	$effect(() => {
		const next: ScheduleMap = { ...untrack(() => sched) };
		const ids = new Set<string>();
		let changed = false;
		for (const c of cards) {
			ids.add(c.id);
			if (!c.due) continue;
			if (!next[c.id]) {
				const due = parseISO(c.due);
				next[c.id] = { start: rmIso(rmAddDays(due, -RM_DEFAULT_SPAN)), due: c.due };
				changed = true;
			}
		}
		for (const id of Object.keys(next)) {
			if (!ids.has(id)) { delete next[id]; changed = true; }
		}
		if (changed) sched = next;
	});

	$effect(() => {
		saveSchedule(boardId, sched);
	});

	function setSchedOne(id: string, start: string, due: string) {
		sched = { ...sched, [id]: { start, due } };
	}

	function matches(card: KataCard): boolean {
		if (!query) return true;
		const q = query.toLowerCase();
		return card.title.toLowerCase().includes(q)
			|| (card.desc || '').toLowerCase().includes(q)
			|| card.labels.some((l) => labelMap.get(l)?.name.toLowerCase().includes(q));
	}

	// Cards that have a due date + a schedule entry, honoring "show completed".
	const dated = $derived(
		cards.filter((c) => {
			if (!c.due || !sched[c.id]) return false;
			if (!showCompleted && isDone(c.id)) return false;
			return true;
		}),
	);

	// Month-aligned range covering every start/due plus today, with placement math.
	const geom = $derived.by(() => {
		const today = rmStartOfDay(new Date());
		let lo = today, hi = today;
		for (const c of dated) {
			const s = parseISO(sched[c.id].start), d = parseISO(sched[c.id].due);
			if (s < lo) lo = s; if (d < lo) lo = d;
			if (d > hi) hi = d; if (s > hi) hi = s;
		}
		const months: { year: number; month: number; days: number }[] = [];
		let y = lo.getFullYear(), m = lo.getMonth();
		while (y < hi.getFullYear() || (y === hi.getFullYear() && m <= hi.getMonth())) {
			months.push({ year: y, month: m, days: rmDaysInMonth(y, m) });
			m += 1; if (m > 11) { m = 0; y += 1; }
		}
		if (!months.length) {
			months.push({ year: today.getFullYear(), month: today.getMonth(), days: rmDaysInMonth(today.getFullYear(), today.getMonth()) });
		}

		const monthW = D.monthW;
		const dateX = (d: Date): number => {
			let x = 0;
			for (const mm of months) {
				if (d.getFullYear() === mm.year && d.getMonth() === mm.month) {
					return x + ((d.getDate() - 1) / mm.days) * monthW;
				}
				x += monthW;
			}
			return d < new Date(months[0].year, months[0].month, 1) ? 0 : months.length * monthW;
		};
		const totalW = months.length * monthW;
		const pxToDate = (x: number): Date => {
			const cx = Math.max(0, Math.min(totalW - 0.001, x));
			const idx = Math.min(months.length - 1, Math.floor(cx / monthW));
			const frac = (cx - idx * monthW) / monthW;
			const mm = months[idx];
			const day = Math.max(1, Math.min(mm.days, Math.round(frac * mm.days) + 1));
			return new Date(mm.year, mm.month, day);
		};

		// Week-boundary marks for snapping + gridlines.
		const weekMarks: Date[] = [];
		for (const mm of months) {
			for (const d of RM_WEEK_DAYS) if (d <= mm.days) weekMarks.push(new Date(mm.year, mm.month, d));
		}
		const lastM = months[months.length - 1];
		weekMarks.push(new Date(lastM.year, lastM.month + 1, 1));
		const markTimes = weekMarks.map((d) => d.getTime());
		const snap = (date: Date): Date => {
			const t = date.getTime();
			let best = weekMarks[0], bd = Infinity;
			for (let i = 0; i < weekMarks.length; i++) {
				const diff = Math.abs(markTimes[i] - t);
				if (diff < bd) { bd = diff; best = weekMarks[i]; }
			}
			return best;
		};

		const contentW = totalW + D.cardW + 40;
		return { months, dateX, pxToDate, snap, weekMarks, totalW, contentW, todayX: dateX(today), today };
	});

	// Lane definitions.
	type LaneDef = { id: string; name: string; tone: string; iconKind: 'unified' | 'folder' | 'none'; unified?: boolean; none?: boolean };
	const laneDefs = $derived.by((): LaneDef[] => {
		if (layout === 'unified') {
			return [{ id: '__all', name: 'All tasks', tone: 'var(--accent)', iconKind: 'unified', unified: true }];
		}
		const defs: LaneDef[] = boardProjects.map((p) => ({ id: p.id, name: p.name, tone: p.color, iconKind: 'folder' }));
		if (dated.some((c) => !c.projectId)) {
			defs.push({ id: '__none', name: 'No project', tone: 'var(--fg-4)', iconKind: 'none', none: true });
		}
		return defs;
	});

	// Build per-lane positioned bars.
	type Placed = { card: KataCard; sched: { start: string; due: string }; left: number; width: number; row: number };
	type Lane = { def: LaneDef; placed: Placed[]; height: number; span: { left: number; width: number } | null; dimLane: boolean; count: number };

	const lanes = $derived.by((): Lane[] => {
		const g = geom;
		return laneDefs.map((def) => {
			let laneCards: KataCard[];
			if (def.unified) laneCards = dated;
			else if (def.none) laneCards = dated.filter((c) => !c.projectId);
			else laneCards = dated.filter((c) => c.projectId === def.id);

			const items = laneCards.map((c) => {
				const s = sched[c.id];
				const left = g.dateX(parseISO(s.start));
				const right = g.dateX(parseISO(s.due));
				const width = Math.max(D.minW, right - left);
				return { card: c, sched: s, left, width, row: 0 } as Placed;
			});
			const { items: placed, rows } = packLane(items, D.gap);
			const height = laneCards.length
				? rows * (D.cardH + D.gap) - D.gap + D.pad * 2
				: Math.max(D.cardH + D.pad * 2, 76);

			let span: { left: number; width: number } | null = null;
			if (laneCards.length) {
				const minL = Math.min(...items.map((i) => i.left));
				const maxR = Math.max(...items.map((i) => g.dateX(parseISO(i.sched.due))));
				span = { left: minL, width: Math.max(8, maxR - minL) };
			}
			const dimLane = !!activeProjectId && !def.unified && def.id !== activeProjectId;
			return { def, placed, height, span, dimLane, count: laneCards.length };
		});
	});

	// Density heat — task load per week segment.
	type HeatBucket = { left: number; width: number; n: number; a: Date; b: Date; cards: KataCard[]; h: number };
	const heatBuckets = $derived.by((): HeatBucket[] => {
		if (!heat) return [];
		const g = geom;
		const out: HeatBucket[] = [];
		let max = 1;
		for (let i = 0; i < g.weekMarks.length - 1; i++) {
			const a = g.weekMarks[i], b = g.weekMarks[i + 1];
			const active: KataCard[] = [];
			for (const c of dated) {
				const s = parseISO(sched[c.id].start), d = parseISO(sched[c.id].due);
				if (s < b && d >= a) active.push(c);
			}
			max = Math.max(max, active.length);
			out.push({ left: g.dateX(a), width: Math.max(2, g.dateX(b) - g.dateX(a) - 2), n: active.length, a, b, cards: active, h: 0 });
		}
		for (const o of out) o.h = o.n / max;
		return out;
	});

	// Week-label positions per month (centers of the 4 segments).
	const weekLabels = $derived.by(() => {
		const g = geom;
		const out: { x: number; label: string }[] = [];
		g.months.forEach((mm, mi) => {
			const segEnds = [...RM_WEEK_DAYS.slice(1), mm.days + 1];
			RM_WEEK_DAYS.forEach((d, wi) => {
				if (d > mm.days) return;
				const center = (d + segEnds[wi]) / 2;
				out.push({ x: mi * D.monthW + ((center - 1) / mm.days) * D.monthW, label: 'W' + (wi + 1) });
			});
		});
		return out;
	});

	const gridStyle = $derived(
		`--rail:${D.rail}px;--content:${geom.contentW}px;--month-w:${D.monthW}px;--card-w:${D.cardW}px;--card-h:${D.cardH}px;`,
	);

	function statusKey(cardId: string): string {
		const col = statusOf(cardId) ?? '';
		if (isDone(cardId)) return 'done';
		const title = statusTitleOf(col).toLowerCase();
		if (/progress|doing/.test(title) || col === 'in-progress') return 'doing';
		if (/backlog/.test(title) || col === 'backlog') return 'backlog';
		return 'todo';
	}

	// --- Drag + resize ----------------------------------------------------------
	let dragId = $state<string | null>(null);
	type DragState = {
		id: string; mode: 'move' | 'start' | 'due'; trackLeft: number; grabOffset: number;
		start0: string; due0: string; durDays: number; moved: boolean;
	};
	let drag: DragState | null = null;

	function onDragMove(e: PointerEvent) {
		const d = drag;
		if (!d) return;
		d.moved = true;
		const g = geom;
		const x = e.clientX - d.trackLeft;
		if (d.mode === 'move') {
			const ns = g.snap(g.pxToDate(x - d.grabOffset));
			const nd = rmAddDays(ns, d.durDays);
			setSchedOne(d.id, rmIso(ns), rmIso(nd));
		} else if (d.mode === 'start') {
			let ns = g.snap(g.pxToDate(x));
			const due = parseISO(d.due0);
			if (daysBetween(ns, due) < 7) ns = rmAddDays(due, -7);
			setSchedOne(d.id, rmIso(ns), d.due0);
		} else {
			let nd = g.snap(g.pxToDate(x));
			const start = parseISO(d.start0);
			if (daysBetween(start, nd) < 7) nd = rmAddDays(start, 7);
			setSchedOne(d.id, d.start0, rmIso(nd));
		}
	}

	function onDragUp() {
		const d = drag;
		drag = null;
		dragId = null;
		document.body.classList.remove('rm-dragging-body');
		window.removeEventListener('pointermove', onDragMove);
		window.removeEventListener('pointerup', onDragUp);
		// A press without movement on the body = a click → open the card.
		if (d && !d.moved && d.mode === 'move') onCardOpen?.(d.id);
	}

	function onDown(e: PointerEvent, card: KataCard, mode: 'move' | 'start' | 'due') {
		e.preventDefault();
		const trackEl = (e.currentTarget as HTMLElement).closest('.rm-track') as HTMLElement | null;
		if (!trackEl) return;
		const rect = trackEl.getBoundingClientRect();
		const s = sched[card.id];
		if (!s) return;
		const startX = geom.dateX(parseISO(s.start));
		drag = {
			id: card.id, mode, trackLeft: rect.left,
			grabOffset: (e.clientX - rect.left) - startX,
			start0: s.start, due0: s.due,
			durDays: daysBetween(parseISO(s.start), parseISO(s.due)),
			moved: false,
		};
		dragId = card.id;
		tip = null;
		document.body.classList.add('rm-dragging-body');
		window.addEventListener('pointermove', onDragMove);
		window.addEventListener('pointerup', onDragUp);
	}

	$effect(() => () => {
		window.removeEventListener('pointermove', onDragMove);
		window.removeEventListener('pointerup', onDragUp);
	});

	// --- Hover tooltips ---------------------------------------------------------
	type Tip = { card: KataCard; rect: DOMRect };
	let tip = $state<Tip | null>(null);
	let heatTip = $state<{ bucket: HeatBucket; rect: DOMRect } | null>(null);

	function onHover(card: KataCard, el: HTMLElement) {
		if (drag) return;
		tip = { card, rect: el.getBoundingClientRect() };
	}

	const tipStyle = $derived.by(() => {
		if (!tip) return '';
		const W = 280;
		let left = tip.rect.left + tip.rect.width / 2 - W / 2;
		left = Math.max(12, Math.min(window.innerWidth - W - 12, left));
		const below = tip.rect.top < 210;
		return below
			? `left:${left}px;top:${tip.rect.bottom + 10}px;`
			: `left:${left}px;top:${tip.rect.top - 10}px;transform:translateY(-100%);`;
	});

	// Heat tooltip — group the week's active tasks by assignee.
	type HeatGroup = { id: string; member: MemberInfo; cards: KataCard[] };
	const heatGroups = $derived.by((): HeatGroup[] => {
		if (!heatTip) return [];
		const groups: HeatGroup[] = [];
		const byId = new Map<string, HeatGroup>();
		for (const c of heatTip.bucket.cards) {
			const aids = c.assignees.length ? c.assignees : ['__unassigned'];
			for (const aid of aids) {
				let g = byId.get(aid);
				if (!g) {
					const member = aid === '__unassigned'
						? { id: '__unassigned', name: 'Unassigned', email: '', imageUrl: null }
						: memberMap.get(aid) ?? { id: aid, name: 'Unknown', email: '', imageUrl: null };
					g = { id: aid, member, cards: [] };
					byId.set(aid, g);
					groups.push(g);
				}
				g.cards.push(c);
			}
		}
		groups.sort((x, y) => y.cards.length - x.cards.length);
		return groups;
	});

	const heatTipStyle = $derived.by(() => {
		if (!heatTip) return '';
		const W = 288;
		let left = heatTip.rect.left + heatTip.rect.width / 2 - W / 2;
		left = Math.max(12, Math.min(window.innerWidth - W - 12, left));
		return `left:${left}px;top:${heatTip.rect.bottom + 10}px;width:${W}px;`;
	});
</script>

<div class="rm-stage">
	{#if showMist}<div class="rm-mist" aria-hidden="true"></div>{/if}

	<div class="rm-scroll">
		<div class="rm-grid" style={gridStyle} data-density={density} data-cardstyle={cardStyle}>
			<!-- Ruler -->
			<div class="rm-ruler">
				<div class="rm-corner">
					<span class="rm-corner-eyebrow">{layout === 'unified' ? 'Timeline' : 'Projects'}</span>
				</div>
				<div class="rm-ruler-track">
					{#each geom.months as mm, i (i)}
						<div class="rm-mcell" data-alt={i % 2} style="left:{i * D.monthW}px;width:{D.monthW}px;">
							<span class="rm-mname">{RM_MONTHS[mm.month].slice(0, 3)}</span>
							<span class="rm-myear">{mm.year}</span>
						</div>
					{/each}
					{#each weekLabels as w, i (i)}
						<span class="rm-wlabel" style="left:{w.x}px;">{w.label}</span>
					{/each}
					<div class="rm-today-pill" style="left:{geom.todayX}px;">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
						Today
					</div>
				</div>
			</div>

			<!-- Density heat -->
			{#if heat}
				<div class="rm-heat">
					<div class="rm-heat-corner"><span class="rm-heat-label">Load / week</span></div>
					<div class="rm-heat-track">
						{#each heatBuckets as b, i (i)}
							<div
								class="rm-heat-bar"
								class:is-empty={!b.n}
								style="left:{b.left}px;width:{b.width}px;"
								onmouseenter={(e) => b.n && (heatTip = { bucket: b, rect: e.currentTarget.getBoundingClientRect() })}
								onmouseleave={() => (heatTip = null)}
								role="presentation"
							>
								<span style="height:{Math.round(b.h * 100)}%;opacity:{0.25 + b.h * 0.55};"></span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Lanes -->
			<div class="rm-lanes">
				<div class="rm-overlay">
					{#if overdueRail}<div class="rm-overdue" style="width:{geom.todayX}px;"></div>{/if}
					{#each geom.months as mm, i (`${mm.year}-${mm.month}`)}
						<div class="rm-band" data-alt={i % 2} style="left:{i * D.monthW}px;width:{D.monthW}px;"></div>
					{/each}
					{#each geom.weekMarks as d, i (i)}
						<div class="rm-gridline" class:is-month={d.getDate() === 1} class:is-week={d.getDate() !== 1} style="left:{geom.dateX(d)}px;"></div>
					{/each}
					<div class="rm-today-line" style="left:{geom.todayX}px;"></div>
				</div>

				{#each lanes as lane (lane.def.id)}
					<div class="rm-lane" class:rm-lane-unified={lane.def.unified} class:is-dim={lane.dimLane}>
						<div class="rm-rail">
							<span class="rm-rail-icon" class:is-none={lane.def.none} style="--pc:{lane.def.tone};">
								{#if lane.def.iconKind === 'unified'}<Layers size={17} />
								{:else if lane.def.iconKind === 'none'}<FolderMinus size={17} />
								{:else}<Folder size={17} />{/if}
							</span>
							<div class="rm-rail-text">
								<span class="rm-rail-name">{lane.def.name}</span>
								<span class="rm-rail-sub"><span class="rm-rail-bar" style="--pc:{lane.def.tone};"></span>{lane.count} {lane.count === 1 ? 'task' : 'tasks'}</span>
							</div>
						</div>
						<div class="rm-track" style="height:{lane.height}px;">
							{#if spanBars && lane.span && !lane.def.unified}
								<div class="rm-spanbar" style="left:{lane.span.left}px;width:{lane.span.width}px;--pc:{lane.def.tone};"></div>
							{/if}
							{#if lane.count === 0}
								<div class="rm-lane-empty">No scheduled tasks</div>
							{/if}
							{#each lane.placed as it (it.card.id)}
								{@const card = it.card}
								{@const proj = projectOf(card)}
								{@const done = isDone(card.id)}
								{@const showProj = !!lane.def.unified || !!lane.def.none}
								{@const me = firstAssignee(card)}
								{@const label0 = card.labels[0] ? labelMap.get(card.labels[0]) : null}
								<div
									class="rm-card"
									class:is-done={done}
									class:is-dim={!matches(card)}
									class:is-dragging={dragId === card.id}
									style="left:{it.left}px;width:{it.width}px;top:{D.pad + it.row * (D.cardH + D.gap)}px;height:{D.cardH}px;--pc:{toneOf(card)};"
									onpointerdown={(e) => onDown(e, card, 'move')}
									onmouseenter={(e) => onHover(card, e.currentTarget)}
									onmouseleave={() => (tip = null)}
									role="button"
									tabindex="0"
								>
									<span class="rm-bar-handle rm-bar-handle-l" onpointerdown={(e) => { e.stopPropagation(); onDown(e, card, 'start'); }} role="presentation"><i></i></span>
									<span class="rm-bar-handle rm-bar-handle-r" onpointerdown={(e) => { e.stopPropagation(); onDown(e, card, 'due'); }} role="presentation"><i></i></span>
									<span class="rm-card-dot"></span>
									{#if done}
										<svg class="rm-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
									{/if}
									{#if showProj && proj}
										<div class="rm-card-top"><span class="rm-card-proj"><span class="rm-card-proj-dot"></span><span class="rm-card-proj-name">{proj.name}</span></span></div>
									{/if}
									<div class="rm-card-title">{card.title}</div>
									<div class="rm-card-meta">
										<div class="rm-card-meta-l">
											<DueBadge iso={it.sched.due} {done} />
											{#if cardStyle !== 'minimal' && label0}<LabelChip label={label0} />{/if}
										</div>
										{#if me}<AvatarChip id={me.id} name={me.name} imageUrl={me.imageUrl} size={20} />{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>

<!-- Hover tooltip -->
{#if tip && !dragId}
	{@const card = tip.card}
	{@const proj = projectOf(card)}
	{@const s = sched[card.id]}
	{@const done = isDone(card.id)}
	{@const me = firstAssignee(card)}
	<div class="rm-tip" style="{tipStyle}--pc:{toneOf(card)};">
		{#if proj}
			<div class="rm-tip-proj"><span class="rm-tip-proj-dot"></span>{proj.name}</div>
		{/if}
		<div class="rm-tip-title">{card.title}</div>
		{#if card.desc}<div class="rm-tip-desc">{card.desc}</div>{/if}
		<div class="rm-tip-sep"></div>
		<div class="rm-tip-window">
			<span class="rm-tip-win-from">{rmFullDate(s.start)}</span>
			<span class="rm-tip-win-arrow">→</span>
			<span class="rm-tip-win-to">{rmFullDate(s.due)}</span>
		</div>
		<div class="rm-tip-meta">
			<span class="kc-status kc-status-{statusKey(card.id)}"><span class="kc-status-dot"></span>{statusTitleOf(statusOf(card.id) ?? '')}</span>
			{#if card.due}<DueBadge iso={s.due} {done} />{/if}
			{#if me}<AvatarChip id={me.id} name={me.name} imageUrl={me.imageUrl} size={22} />{/if}
		</div>
		{#if card.labels.length > 0}
			<div class="rm-tip-row">
				{#each card.labels as l (l)}
					{@const lab = labelMap.get(l)}
					{#if lab}<LabelChip label={lab} />{/if}
				{/each}
			</div>
		{/if}
	</div>
{/if}

<!-- Heat-strip tooltip -->
{#if heatTip && !dragId}
	<div class="rm-heattip" style={heatTipStyle}>
		<div class="rm-heattip-head">
			<span class="rm-heattip-week">{rmWeekRange(heatTip.bucket.a, heatTip.bucket.b)}</span>
			<span class="rm-heattip-count">{heatTip.bucket.n} active</span>
		</div>
		<div class="rm-heattip-groups">
			{#each heatGroups as g (g.id)}
				<div class="rm-heattip-group">
					<div class="rm-heattip-person">
						<AvatarChip id={g.member.id} name={g.member.name} imageUrl={g.member.imageUrl} size={22} />
						<span class="rm-heattip-name">{g.member.name}</span>
						<span class="rm-heattip-pcount">{g.cards.length}</span>
					</div>
					<ul class="rm-heattip-tickets">
						{#each g.cards as c (c.id)}
							{@const proj = projectOf(c)}
							<li class="rm-heattip-ticket" class:is-done={isDone(c.id)}>
								<span class="rm-heattip-tdot" style="background:{proj ? proj.color : 'var(--fg-4)'};"></span>
								<span class="rm-heattip-ttitle">{c.title}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	/* ---- Page shell ---- */
	.rm-stage {
		flex: 1;
		min-width: 0;
		position: relative;
		display: flex;
		flex-direction: column;
	}
	.rm-mist {
		position: absolute;
		inset: 0;
		background-image: url('/mist.svg');
		background-repeat: repeat-x;
		background-position: center 30%;
		background-size: 1100px auto;
		opacity: 0.05;
		pointer-events: none;
		z-index: 0;
	}
	:global([data-theme='dark']) .rm-mist { opacity: 0.04; filter: invert(1); }

	.rm-scroll {
		position: relative;
		z-index: 1;
		flex: 1;
		min-height: 0;
		overflow: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--line-2) transparent;
	}
	.rm-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
	.rm-scroll::-webkit-scrollbar-thumb {
		background: var(--line-2);
		border-radius: 999px;
		border: 3px solid var(--paper-1);
	}
	.rm-scroll::-webkit-scrollbar-corner { background: transparent; }

	.rm-grid {
		position: relative;
		width: calc(var(--rail) + var(--content));
		min-height: 100%;
		--ruler-h: 60px;
	}

	/* ---- Month ruler (sticky top) ---- */
	.rm-ruler {
		position: sticky;
		top: 0;
		z-index: 6;
		display: flex;
		height: var(--ruler-h);
		background: var(--paper-1);
		border-bottom: 1px solid var(--line-2);
	}
	.rm-corner {
		position: sticky;
		left: 0;
		z-index: 7;
		width: var(--rail);
		flex: 0 0 var(--rail);
		background: var(--paper-1);
		border-right: 1px solid var(--line-2);
		display: flex;
		align-items: center;
		padding: 0 18px;
	}
	.rm-corner-eyebrow {
		font: 600 10px var(--font-sans);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--fg-4);
	}
	.rm-ruler-track {
		position: relative;
		width: var(--content);
		flex: 0 0 var(--content);
	}
	.rm-mcell {
		position: absolute;
		top: 0;
		bottom: 0;
		display: flex;
		flex-direction: column;
		justify-content: flex-start;
		padding-top: 9px;
		padding-left: 16px;
		border-left: 1px solid var(--line-1);
	}
	.rm-mcell[data-alt='1'] { background: rgba(20, 19, 15, 0.018); }
	:global([data-theme='dark']) .rm-mcell[data-alt='1'] { background: rgba(244, 241, 234, 0.022); }
	.rm-mname {
		font: 500 18px var(--font-display);
		color: var(--fg-1);
		letter-spacing: -0.01em;
		line-height: 1.05;
	}
	.rm-myear {
		font: 500 10.5px var(--font-mono);
		color: var(--fg-4);
		letter-spacing: 0.04em;
		margin-top: 2px;
	}

	.rm-today-pill {
		position: absolute;
		top: 60%;
		transform: translate(-50%, -50%);
		z-index: 2;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 9px 3px 7px;
		background: var(--accent);
		color: var(--paper-0);
		border-radius: 999px;
		font: 600 10.5px var(--font-sans);
		letter-spacing: 0.02em;
		white-space: nowrap;
		box-shadow: var(--shadow-sm);
	}
	.rm-today-pill svg { width: 11px; height: 11px; }

	/* ---- Lanes region ---- */
	.rm-lanes { position: relative; }
	.rm-overlay {
		position: absolute;
		top: 0;
		left: var(--rail);
		width: var(--content);
		height: 100%;
		z-index: 0;
		pointer-events: none;
	}
	.rm-band { position: absolute; top: 0; bottom: 0; }
	.rm-band[data-alt='1'] { background: rgba(20, 19, 15, 0.018); }
	:global([data-theme='dark']) .rm-band[data-alt='1'] { background: rgba(244, 241, 234, 0.022); }
	.rm-gridline {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--line-1);
	}
	.rm-gridline.is-month { background: var(--line-2); }
	.rm-gridline.is-week { background: var(--line-1); opacity: 0.55; }
	.rm-today-line {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--accent);
		transform: translateX(-1px);
		opacity: 0.5;
	}
	.rm-today-line::before {
		content: '';
		position: absolute;
		top: 0;
		left: -3px;
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: var(--accent);
	}

	.rm-lane {
		position: relative;
		z-index: 1;
		display: flex;
		border-bottom: 1px solid var(--line-1);
	}
	.rm-lane:last-child { border-bottom: none; }
	.rm-lane.is-dim { opacity: 0.4; }

	.rm-rail {
		position: sticky;
		left: 0;
		z-index: 5;
		width: var(--rail);
		flex: 0 0 var(--rail);
		background: var(--paper-1);
		border-right: 1px solid var(--line-2);
		padding: 16px 16px 16px 18px;
		display: flex;
		align-items: flex-start;
		gap: 11px;
	}
	.rm-rail-icon {
		--pc: var(--fg-3);
		width: 32px;
		height: 32px;
		flex: 0 0 auto;
		border-radius: 9px;
		background: var(--pc);
		color: var(--paper-0);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15);
		margin-top: 1px;
	}
	.rm-rail-icon :global(svg) { width: 17px; height: 17px; stroke-width: 2; }
	.rm-rail-icon.is-none {
		background: transparent;
		border: 1px dashed var(--line-3);
		color: var(--fg-4);
	}
	.rm-rail-text { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
	.rm-rail-name {
		font: 500 16px var(--font-display);
		color: var(--fg-1);
		letter-spacing: -0.012em;
		line-height: 1.15;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rm-rail-sub {
		font: 500 11px var(--font-sans);
		color: var(--fg-3);
		font-variant-numeric: tabular-nums;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.rm-rail-bar {
		width: 22px;
		height: 3px;
		border-radius: 999px;
		background: var(--pc, var(--fg-4));
		opacity: 0.85;
	}

	.rm-track {
		position: relative;
		width: var(--content);
		flex: 0 0 var(--content);
	}

	/* ---- Timeline card ---- */
	.rm-card {
		position: absolute;
		width: var(--card-w);
		height: var(--card-h);
		background: var(--paper-0);
		border: 1px solid var(--line-1);
		border-left: 3px solid var(--pc, var(--accent));
		border-radius: 9px;
		box-shadow: var(--shadow-sm);
		padding: 9px 11px 9px 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		overflow: visible;
		cursor: grab;
		user-select: none;
		touch-action: none;
		transition: box-shadow var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			transform var(--dur-fast) var(--ease-out),
			opacity var(--dur-fast) var(--ease-out);
	}
	.rm-card:hover {
		box-shadow: var(--shadow-md);
		border-color: var(--line-2);
		border-left-color: var(--pc, var(--accent));
		transform: translateY(-2px);
		z-index: 4;
	}
	.rm-card.is-dim { opacity: 0.22; }
	.rm-card.is-done {
		background: var(--paper-1);
		box-shadow: none;
		border-left-color: var(--success);
	}
	.rm-card.is-done .rm-card-title {
		color: var(--fg-3);
		text-decoration: line-through;
		text-decoration-color: var(--fg-4);
	}

	.rm-card-dot {
		position: absolute;
		right: -5px;
		top: -5px;
		width: 9px;
		height: 9px;
		border-radius: 999px;
		background: var(--pc, var(--accent));
		border: 2px solid var(--paper-0);
		box-shadow: var(--shadow-sm);
	}
	.rm-card.is-done .rm-card-dot { background: var(--success); }

	.rm-card-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.rm-card-proj {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		font: 500 10px var(--font-sans);
		color: var(--fg-3);
	}
	.rm-card-proj-dot {
		width: 5px;
		height: 5px;
		border-radius: 999px;
		background: var(--pc, var(--fg-4));
		flex: 0 0 auto;
	}
	.rm-card-proj-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rm-card-title {
		font: 500 13px/1.32 var(--font-sans);
		color: var(--fg-1);
		letter-spacing: -0.006em;
		text-wrap: pretty;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.rm-card-meta {
		margin-top: auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.rm-card-meta-l { display: flex; align-items: center; gap: 5px; min-width: 0; flex-wrap: nowrap; overflow: hidden; }

	.rm-check {
		position: absolute;
		top: 8px;
		right: 9px;
		width: 14px;
		height: 14px;
		color: var(--success);
	}
	.rm-card.is-done .rm-card-meta-l { padding-right: 16px; }

	/* Density tuning */
	.rm-grid[data-density='compact'] .rm-card { padding: 7px 9px 7px 10px; gap: 4px; }
	.rm-grid[data-density='compact'] .rm-card-title { font-size: 12px; }
	.rm-grid[data-density='compact'] .rm-card-proj { font-size: 9.5px; }
	.rm-grid[data-density='spacious'] .rm-card { padding: 11px 13px 11px 14px; gap: 8px; }
	.rm-grid[data-density='spacious'] .rm-card-title { font-size: 14px; }

	.rm-grid[data-cardstyle='minimal'] .rm-card-proj-name { display: none; }

	.rm-lane-unified .rm-rail-name { font-size: 15px; }

	.rm-lane-empty {
		position: absolute;
		left: 16px;
		top: 50%;
		transform: translateY(-50%);
		font: 400 12px var(--font-sans);
		font-style: italic;
		color: var(--fg-4);
	}

	/* ---- Span bars: drag + resize ---- */
	.rm-card.is-dragging {
		cursor: grabbing;
		z-index: 7;
		box-shadow: var(--shadow-lg);
		border-color: var(--pc, var(--accent));
		transition: none;
	}
	:global(body.rm-dragging-body) { cursor: grabbing; user-select: none; }
	:global(body.rm-dragging-body) .rm-tip { display: none; }

	.rm-bar-handle {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: ew-resize;
		z-index: 3;
		opacity: 0;
		transition: opacity var(--dur-fast);
	}
	.rm-bar-handle-l { left: 0; }
	.rm-bar-handle-r { right: 0; }
	.rm-bar-handle i {
		width: 3px;
		height: 46%;
		max-height: 26px;
		border-radius: 999px;
		background: var(--pc, var(--accent));
	}
	.rm-card:hover .rm-bar-handle,
	.rm-card.is-dragging .rm-bar-handle { opacity: 0.85; }

	/* ---- Project span capsule ---- */
	.rm-spanbar {
		position: absolute;
		top: 7px;
		bottom: 7px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--pc) 7%, transparent);
		border: 1px dashed color-mix(in srgb, var(--pc) 26%, transparent);
		z-index: 0;
		pointer-events: none;
	}
	:global([data-theme='dark']) .rm-spanbar {
		background: color-mix(in srgb, var(--pc) 14%, transparent);
	}

	/* ---- Overdue rail ---- */
	.rm-overdue {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		background: rgba(155, 59, 46, 0.045);
		border-right: 1px dashed rgba(155, 59, 46, 0.28);
	}
	:global([data-theme='dark']) .rm-overdue {
		background: rgba(155, 59, 46, 0.1);
		border-right-color: rgba(220, 156, 144, 0.35);
	}

	/* ---- Week labels ---- */
	.rm-wlabel {
		position: absolute;
		bottom: 6px;
		transform: translateX(-50%);
		font: 600 8.5px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--fg-4);
		opacity: 0.7;
		pointer-events: none;
	}

	/* ---- Density heat strip ---- */
	.rm-heat {
		position: sticky;
		top: var(--ruler-h);
		z-index: 5;
		display: flex;
		height: 32px;
		background: var(--paper-1);
		border-bottom: 1px solid var(--line-1);
	}
	.rm-heat-corner {
		position: sticky;
		left: 0;
		z-index: 6;
		width: var(--rail);
		flex: 0 0 var(--rail);
		background: var(--paper-1);
		border-right: 1px solid var(--line-2);
		display: flex;
		align-items: center;
		padding: 0 18px;
	}
	.rm-heat-label {
		font: 600 8.5px var(--font-sans);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--fg-4);
		white-space: nowrap;
	}
	.rm-heat-track { position: relative; width: var(--content); flex: 0 0 var(--content); }
	.rm-heat-bar {
		position: absolute;
		top: 5px;
		bottom: 5px;
		display: flex;
		align-items: flex-end;
	}
	.rm-heat-bar > span {
		display: block;
		width: 100%;
		background: var(--accent);
		border-radius: 3px 3px 1px 1px;
		min-height: 2px;
	}
	.rm-heat-bar:not(.is-empty) { cursor: pointer; }
	.rm-heat-bar:not(.is-empty):hover > span { opacity: 1 !important; }

	/* ---- Tooltip ---- */
	.rm-tip {
		position: fixed;
		z-index: 80;
		width: 280px;
		background: var(--paper-0);
		border: 1px solid var(--line-2);
		border-radius: var(--radius-lg, 14px);
		box-shadow: var(--shadow-lg);
		padding: 14px 16px;
		pointer-events: none;
		animation: rm-tip-in 140ms var(--ease-out);
	}
	@keyframes rm-tip-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
	.rm-tip-proj {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: 600 10px var(--font-sans);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--fg-3);
		margin-bottom: 8px;
	}
	.rm-tip-proj-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--pc, var(--fg-4)); }
	.rm-tip-title {
		font: 500 16px/1.3 var(--font-display);
		color: var(--fg-1);
		letter-spacing: -0.01em;
		text-wrap: pretty;
	}
	.rm-tip-desc {
		font: 400 12.5px/1.5 var(--font-sans);
		color: var(--fg-3);
		margin-top: 7px;
		text-wrap: pretty;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.rm-tip-window {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 12px;
		font: 500 12.5px var(--font-sans);
		color: var(--fg-2);
		font-variant-numeric: tabular-nums;
	}
	.rm-tip-win-arrow { color: var(--fg-4); }
	.rm-tip-win-to { color: var(--fg-1); font-weight: 600; }
	.rm-tip-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 12px;
		flex-wrap: wrap;
	}
	.rm-tip-sep { height: 1px; background: var(--line-1); margin: 12px -16px 0; }
	.rm-tip-meta {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 12px;
		font: 500 11.5px var(--font-sans);
		color: var(--fg-3);
	}
	.rm-tip-meta :global(.avatar) { margin-left: auto; }

	/* status pill (mirrors KanbanCard) */
	.kc-status {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font: 500 10.5px var(--font-sans);
		letter-spacing: -0.005em;
		padding: 2px 8px 2px 7px;
		border-radius: 999px;
		background: var(--paper-2);
		color: var(--fg-2);
		white-space: nowrap;
		border: 1px solid var(--line-1);
	}
	.kc-status-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--fg-3); flex-shrink: 0; }
	.kc-status-backlog .kc-status-dot { background: var(--fg-4); }
	.kc-status-todo .kc-status-dot { background: var(--accent); }
	.kc-status-doing {
		background: rgba(176, 122, 42, 0.1);
		color: var(--warning);
		border-color: rgba(176, 122, 42, 0.22);
	}
	.kc-status-doing .kc-status-dot { background: var(--warning); }
	.kc-status-done {
		background: rgba(63, 107, 74, 0.08);
		color: var(--success);
		border-color: rgba(63, 107, 74, 0.22);
	}
	.kc-status-done .kc-status-dot { background: var(--success); }

	/* ---- Heat-strip tooltip ---- */
	.rm-heattip {
		position: fixed;
		z-index: 85;
		background: var(--paper-0);
		border: 1px solid var(--line-2);
		border-radius: var(--radius-lg, 14px);
		box-shadow: var(--shadow-lg);
		padding: 12px 14px 13px;
		pointer-events: none;
		animation: rm-tip-in 140ms var(--ease-out);
	}
	.rm-heattip-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		padding-bottom: 9px;
		margin-bottom: 9px;
		border-bottom: 1px solid var(--line-1);
	}
	.rm-heattip-week {
		font: 500 14px var(--font-display);
		color: var(--fg-1);
		letter-spacing: -0.01em;
		font-variant-numeric: tabular-nums;
	}
	.rm-heattip-count {
		font: 600 9.5px var(--font-sans);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--fg-3);
		white-space: nowrap;
	}
	.rm-heattip-groups { display: flex; flex-direction: column; gap: 12px; }
	.rm-heattip-person { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
	.rm-heattip-name { font: 600 12.5px var(--font-sans); color: var(--fg-1); }
	.rm-heattip-pcount {
		margin-left: auto;
		font: 500 10.5px var(--font-mono);
		color: var(--fg-3);
		background: var(--paper-2);
		padding: 1px 7px;
		border-radius: 999px;
	}
	.rm-heattip-tickets {
		list-style: none;
		margin: 0;
		padding: 0 0 0 5px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.rm-heattip-ticket {
		display: flex;
		align-items: center;
		gap: 8px;
		font: 400 12.5px/1.35 var(--font-sans);
		color: var(--fg-2);
	}
	.rm-heattip-tdot { width: 6px; height: 6px; border-radius: 999px; flex: 0 0 auto; }
	.rm-heattip-ttitle {
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rm-heattip-ticket.is-done .rm-heattip-ttitle {
		color: var(--fg-4);
		text-decoration: line-through;
		text-decoration-color: var(--fg-4);
	}
</style>
