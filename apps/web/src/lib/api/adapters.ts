import type { BoardWithColumnsAndCards, CardSummary } from './types.js';
import type { KataCard, KataColumn, KataLabel, KataProject } from '$lib/types.js';

// --- Client op dedup helpers (TTL-based, used to suppress own SSE echo) ---
const recentOps = new Map<string, number>();
const TTL_MS = 3000;

export function markClientOp(key: string): void {
	recentOps.set(key, Date.now());
	// Lazy GC: prune stale entries on each call
	for (const [k, t] of recentOps) {
		if (Date.now() - t > TTL_MS) recentOps.delete(k);
	}
}

export function wasClientOp(key: string): boolean {
	const t = recentOps.get(key);
	if (!t) return false;
	if (Date.now() - t > TTL_MS) {
		recentOps.delete(key);
		return false;
	}
	return true;
}

function mapCard(c: CardSummary): KataCard {
	return {
		id: c.id,
		title: c.title,
		desc: '', // CardSummary doesn't include description; CardModal will fetch detail on open
		labels: c.labelIds ?? [],
		assignees: c.assigneeIds ?? [],
		projectId: c.projectId ?? null,
		...(c.dueDate && { due: c.dueDate.slice(0, 10) }), // local type uses YYYY-MM-DD
	};
}

export function toLocalColumns(api: BoardWithColumnsAndCards): KataColumn[] {
	return api.columns.map((col) => ({
		id: col.id,
		title: col.title,
		cards: col.cards.map(mapCard),
	}));
}

// Per-event applicators — pure functions, no side effects.

export function applyColumnCreated(
	cols: KataColumn[],
	data: { id: string; title: string; position: string },
): KataColumn[] {
	if (cols.some((c) => c.id === data.id)) return cols;
	return [...cols, { id: data.id, title: data.title, cards: [] }];
}

export function applyColumnUpdated(
	cols: KataColumn[],
	data: { id: string; title: string },
): KataColumn[] {
	return cols.map((c) => (c.id === data.id ? { ...c, title: data.title } : c));
}

export function applyColumnDeleted(cols: KataColumn[], data: { id: string }): KataColumn[] {
	return cols.filter((c) => c.id !== data.id);
}

export function applyCardCreated(
	cols: KataColumn[],
	data: { id: string; columnId: string; title: string },
): KataColumn[] {
	const stub: CardSummary = {
		id: data.id,
		boardId: '',
		columnId: data.columnId,
		title: data.title,
		position: '',
		dueDate: null,
		projectId: null,
		labelIds: [],
		assigneeIds: [],
		attachmentIds: [],
		commentsCount: 0,
		checklistsCount: 0,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
	return cols.map((c) =>
		c.id === data.columnId ? { ...c, cards: [...c.cards, mapCard(stub)] } : c,
	);
}

export function applyCardUpdated(
	cols: KataColumn[],
	data: { id: string; title?: string; dueDate?: string | null; projectId?: string | null },
): KataColumn[] {
	return cols.map((c) => ({
		...c,
		cards: c.cards.map((card) =>
			card.id === data.id
				? {
						...card,
						...(data.title !== undefined && { title: data.title }),
						...(data.dueDate !== undefined && {
							due: data.dueDate ? data.dueDate.slice(0, 10) : undefined,
						}),
						...(data.projectId !== undefined && { projectId: data.projectId }),
					}
				: card,
		),
	}));
}

export function applyCardMoved(
	cols: KataColumn[],
	data: { id: string; columnId: string; position: string },
): KataColumn[] {
	// Remove from current column
	let movedCard: KataCard | null = null;
	const stripped = cols.map((c) => {
		const idx = c.cards.findIndex((card) => card.id === data.id);
		if (idx === -1) return c;
		movedCard = c.cards[idx]!;
		return { ...c, cards: c.cards.filter((_, i) => i !== idx) };
	});
	if (!movedCard) return cols;
	return stripped.map((c) =>
		c.id === data.columnId
			? { ...c, cards: [...c.cards, movedCard!] } // append; precise reorder handled by reorder events
			: c,
	);
}

export function applyCardDeleted(cols: KataColumn[], data: { id: string }): KataColumn[] {
	return cols.map((c) => ({ ...c, cards: c.cards.filter((card) => card.id !== data.id) }));
}

export function applyColumnsReordered(
	cols: KataColumn[],
	data: { orderedIds: string[] },
): KataColumn[] {
	const map = new Map(cols.map((c) => [c.id, c]));
	const reordered = data.orderedIds.map((id) => map.get(id)).filter(Boolean) as KataColumn[];
	// Append any columns not in orderedIds (safety net)
	const included = new Set(data.orderedIds);
	const rest = cols.filter((c) => !included.has(c.id));
	return [...reordered, ...rest];
}

export function applyCardsReordered(
	cols: KataColumn[],
	data: { columnId: string; orderedIds: string[] },
): KataColumn[] {
	return cols.map((c) => {
		if (c.id !== data.columnId) return c;
		const map = new Map(c.cards.map((card) => [card.id, card]));
		const reordered = data.orderedIds.map((id) => map.get(id)).filter(Boolean) as KataCard[];
		const included = new Set(data.orderedIds);
		const rest = c.cards.filter((card) => !included.has(card.id));
		return { ...c, cards: [...reordered, ...rest] };
	});
}

export function applyCardLabelChange(
	cols: KataColumn[],
	data: { cardId: string; labelId: string; op: 'add' | 'remove' },
): KataColumn[] {
	return cols.map((c) => ({
		...c,
		cards: c.cards.map((card) => {
			if (card.id !== data.cardId) return card;
			const labels =
				data.op === 'add'
					? card.labels.includes(data.labelId)
						? card.labels
						: [...card.labels, data.labelId]
					: card.labels.filter((l) => l !== data.labelId);
			return { ...card, labels };
		}),
	}));
}

export function applyLabelCreated(
	labels: KataLabel[],
	data: { id: string; name: string; color: string },
): KataLabel[] {
	if (labels.some((l) => l.id === data.id)) return labels;
	return [...labels, { id: data.id, name: data.name, color: data.color }];
}

export function applyLabelUpdated(
	labels: KataLabel[],
	data: { id: string; name?: string; color?: string },
): KataLabel[] {
	return labels.map((l) =>
		l.id === data.id
			? { ...l, ...(data.name !== undefined && { name: data.name }), ...(data.color !== undefined && { color: data.color }) }
			: l,
	);
}

export function applyLabelDeleted(labels: KataLabel[], data: { id: string }): KataLabel[] {
	return labels.filter((l) => l.id !== data.id);
}

export function applyProjectCreated(
	projects: KataProject[],
	data: { id: string; name: string; color: string },
): KataProject[] {
	if (projects.some((p) => p.id === data.id)) return projects;
	return [...projects, { id: data.id, name: data.name, color: data.color }];
}

export function applyProjectUpdated(
	projects: KataProject[],
	data: { id: string; name?: string; color?: string },
): KataProject[] {
	return projects.map((p) =>
		p.id === data.id
			? { ...p, ...(data.name !== undefined && { name: data.name }), ...(data.color !== undefined && { color: data.color }) }
			: p,
	);
}

export function applyProjectDeleted(projects: KataProject[], data: { id: string }): KataProject[] {
	return projects.filter((p) => p.id !== data.id);
}

export function applyCardAssigneeChange(
	cols: KataColumn[],
	data: { cardId: string; userId: string; op: 'add' | 'remove' },
): KataColumn[] {
	return cols.map((c) => ({
		...c,
		cards: c.cards.map((card) => {
			if (card.id !== data.cardId) return card;
			const assignees =
				data.op === 'add'
					? card.assignees.includes(data.userId)
						? card.assignees
						: [...card.assignees, data.userId]
					: card.assignees.filter((id) => id !== data.userId);
			return { ...card, assignees };
		}),
	}));
}
