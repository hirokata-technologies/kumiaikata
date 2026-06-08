import type { BoardState } from '$lib/types.js';

export interface BoardContextCard {
	title: string;
	labels: string[]; // resolved label names, not ids
}

export interface BoardContextColumn {
	name: string;
	cards: BoardContextCard[];
}

export interface BoardContext {
	columns: BoardContextColumn[];
}

/**
 * Serializes a BoardState into a minimal analysis payload.
 * Card label ids are resolved to their human-readable names; unknown ids are
 * included as "(unknown: <id>)" so mismatches are visible to the AI and in logs.
 * All columns are included (even empty ones) so the AI sees the full board structure.
 * Null/undefined columns or cards arrays are treated as empty to avoid throws on
 * malformed board state.
 */
export function serializeBoardContext(state: BoardState): BoardContext {
	const labelName = new Map((state.labels ?? []).map((l) => [l.id, l.name]));
	return {
		columns: (state.columns ?? []).map((col) => ({
			name: col.title,
			cards: (col.cards ?? []).map((card) => ({
				title: card.title,
				labels: (card.labels ?? []).map((id) => labelName.get(id) ?? `(unknown: ${id})`)
			}))
		}))
	};
}

/** Total card count across all columns — used to guard empty-board analysis. */
export function countCards(ctx: BoardContext): number {
	return ctx.columns.reduce((sum, c) => sum + c.cards.length, 0);
}
