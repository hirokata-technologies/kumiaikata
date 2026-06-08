import { describe, it, expect } from 'vitest';
import { serializeBoardContext, countCards } from './board-context.js';
import type { BoardContext } from './board-context.js';
import type { BoardState } from '$lib/types.js';

// ---------------------------------------------------------------------------
// serializeBoardContext
// ---------------------------------------------------------------------------

describe('serializeBoardContext', () => {
	it('returns columns with resolved label names (happy path)', () => {
		const state: BoardState = {
			columns: [
				{
					id: 'col-1',
					title: 'In Progress',
					cards: [
						{ id: 'c-1', title: 'Build login', desc: '', labels: ['label-a', 'label-b'], assignees: [] }
					]
				}
			],
			labels: [
				{ id: 'label-a', name: 'Frontend', color: '#f00' },
				{ id: 'label-b', name: 'Backend', color: '#0f0' }
			],
			projects: []
		};

		const result = serializeBoardContext(state);

		expect(result.columns).toHaveLength(1);
		expect(result.columns[0].name).toBe('In Progress');
		expect(result.columns[0].cards).toHaveLength(1);
		expect(result.columns[0].cards[0].title).toBe('Build login');
		expect(result.columns[0].cards[0].labels).toEqual(['Frontend', 'Backend']);
	});

	it('includes all columns even when empty', () => {
		const state: BoardState = {
			columns: [
				{ id: 'col-1', title: 'Todo', cards: [] },
				{ id: 'col-2', title: 'Done', cards: [] }
			],
			labels: [],
			projects: []
		};

		const result = serializeBoardContext(state);

		expect(result.columns).toHaveLength(2);
		expect(result.columns[0].name).toBe('Todo');
		expect(result.columns[0].cards).toEqual([]);
		expect(result.columns[1].name).toBe('Done');
	});

	it('returns an empty columns array when state.columns is an empty array', () => {
		const state: BoardState = { columns: [], labels: [], projects: [] };
		const result = serializeBoardContext(state);
		expect(result.columns).toEqual([]);
	});

	it('treats null/undefined columns as empty (graceful fallback)', () => {
		// BoardState type requires columns to be present, but test the runtime guard
		// by casting to simulate a malformed payload.
		const state = { columns: null, labels: [], projects: [] } as unknown as BoardState;
		const result = serializeBoardContext(state);
		expect(result.columns).toEqual([]);
	});

	it('treats null/undefined labels as empty (graceful fallback)', () => {
		const state = {
			columns: [{ id: 'col-1', title: 'Todo', cards: [] }],
			labels: null,
			projects: []
		} as unknown as BoardState;

		const result = serializeBoardContext(state);
		expect(result.columns[0].name).toBe('Todo');
	});

	it('treats null/undefined cards within a column as empty (graceful fallback)', () => {
		const state = {
			columns: [{ id: 'col-1', title: 'Todo', cards: null }],
			labels: [],
			projects: []
		} as unknown as BoardState;

		const result = serializeBoardContext(state);
		expect(result.columns[0].cards).toEqual([]);
	});

	it('uses "(unknown: <id>)" for label ids not present in the labels map', () => {
		const state: BoardState = {
			columns: [
				{
					id: 'col-1',
					title: 'Backlog',
					cards: [
						{ id: 'c-1', title: 'Fix bug', desc: '', labels: ['label-missing'], assignees: [] }
					]
				}
			],
			labels: [],
			projects: []
		};

		const result = serializeBoardContext(state);
		expect(result.columns[0].cards[0].labels).toEqual(['(unknown: label-missing)']);
	});

	it('resolves known labels and falls back for unknown ones in the same card', () => {
		const state: BoardState = {
			columns: [
				{
					id: 'col-1',
					title: 'Todo',
					cards: [
						{
							id: 'c-1',
							title: 'Mixed labels',
							desc: '',
							labels: ['known-id', 'ghost-id'],
							assignees: []
						}
					]
				}
			],
			labels: [{ id: 'known-id', name: 'Design', color: '#00f' }],
			projects: []
		};

		const result = serializeBoardContext(state);
		expect(result.columns[0].cards[0].labels).toEqual(['Design', '(unknown: ghost-id)']);
	});

	it('returns a card with an empty labels array when a card has no labels', () => {
		const state: BoardState = {
			columns: [
				{
					id: 'col-1',
					title: 'Todo',
					cards: [{ id: 'c-1', title: 'No labels card', desc: '', labels: [], assignees: [] }]
				}
			],
			labels: [],
			projects: []
		};

		const result = serializeBoardContext(state);
		expect(result.columns[0].cards[0].labels).toEqual([]);
	});

	it('handles null/undefined card.labels as empty (graceful fallback)', () => {
		const state = {
			columns: [
				{
					id: 'col-1',
					title: 'Todo',
					cards: [{ id: 'c-1', title: 'Card', desc: '', labels: null, assignees: [] }]
				}
			],
			labels: [],
			projects: []
		} as unknown as BoardState;

		const result = serializeBoardContext(state);
		expect(result.columns[0].cards[0].labels).toEqual([]);
	});

	it('serializes multiple columns with multiple cards correctly', () => {
		const state: BoardState = {
			columns: [
				{
					id: 'col-1',
					title: 'Todo',
					cards: [
						{ id: 'c-1', title: 'Task A', desc: '', labels: ['l1'], assignees: [] },
						{ id: 'c-2', title: 'Task B', desc: '', labels: [], assignees: [] }
					]
				},
				{
					id: 'col-2',
					title: 'Done',
					cards: [
						{ id: 'c-3', title: 'Task C', desc: '', labels: ['l1', 'l2'], assignees: [] }
					]
				}
			],
			labels: [
				{ id: 'l1', name: 'Alpha', color: '#f00' },
				{ id: 'l2', name: 'Beta', color: '#0f0' }
			],
			projects: []
		};

		const result = serializeBoardContext(state);

		expect(result.columns).toHaveLength(2);
		expect(result.columns[0].cards).toHaveLength(2);
		expect(result.columns[0].cards[0].labels).toEqual(['Alpha']);
		expect(result.columns[0].cards[1].labels).toEqual([]);
		expect(result.columns[1].cards[0].labels).toEqual(['Alpha', 'Beta']);
	});

	it('does not include projects in the serialized output', () => {
		const state: BoardState = {
			columns: [],
			labels: [],
			projects: [{ id: 'p-1', name: 'Project X', color: '#abc' }]
		};
		const result = serializeBoardContext(state);
		expect(result).not.toHaveProperty('projects');
	});

	it('omits card.desc and card.assignees from the serialized card', () => {
		const state: BoardState = {
			columns: [
				{
					id: 'col-1',
					title: 'Todo',
					cards: [{ id: 'c-1', title: 'Card', desc: 'Some description', labels: [], assignees: ['u-1'] }]
				}
			],
			labels: [],
			projects: []
		};
		const result = serializeBoardContext(state);
		const card = result.columns[0].cards[0];
		expect(card).not.toHaveProperty('desc');
		expect(card).not.toHaveProperty('assignees');
	});
});

// ---------------------------------------------------------------------------
// countCards
// ---------------------------------------------------------------------------

describe('countCards', () => {
	it('returns 0 for an empty board (no columns)', () => {
		const ctx: BoardContext = { columns: [] };
		expect(countCards(ctx)).toBe(0);
	});

	it('returns 0 when all columns are empty', () => {
		const ctx: BoardContext = {
			columns: [
				{ name: 'Todo', cards: [] },
				{ name: 'Done', cards: [] }
			]
		};
		expect(countCards(ctx)).toBe(0);
	});

	it('returns the correct total for a single column with cards', () => {
		const ctx: BoardContext = {
			columns: [
				{
					name: 'Todo',
					cards: [
						{ title: 'A', labels: [] },
						{ title: 'B', labels: [] }
					]
				}
			]
		};
		expect(countCards(ctx)).toBe(2);
	});

	it('sums cards across multiple columns', () => {
		const ctx: BoardContext = {
			columns: [
				{ name: 'Todo', cards: [{ title: 'A', labels: [] }, { title: 'B', labels: [] }] },
				{ name: 'In Progress', cards: [{ title: 'C', labels: [] }] },
				{ name: 'Done', cards: [{ title: 'D', labels: [] }, { title: 'E', labels: [] }, { title: 'F', labels: [] }] }
			]
		};
		expect(countCards(ctx)).toBe(6);
	});

	it('returns exactly 500 for a board at the limit boundary', () => {
		const cards = Array.from({ length: 500 }, (_, i) => ({ title: `Card ${i}`, labels: [] }));
		const ctx: BoardContext = { columns: [{ name: 'All', cards }] };
		expect(countCards(ctx)).toBe(500);
	});

	it('returns 501 for a board just over the limit boundary', () => {
		const cards = Array.from({ length: 501 }, (_, i) => ({ title: `Card ${i}`, labels: [] }));
		const ctx: BoardContext = { columns: [{ name: 'All', cards }] };
		expect(countCards(ctx)).toBe(501);
	});
});
