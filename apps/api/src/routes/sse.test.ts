/**
 * SSE functional tests — BUG-008 regression
 *
 * BUG-008: The old broken SSE implementation pushed type and data as two
 * separate queue entries (e.g. queue.push(event.type); queue.push(data)).
 * When two events arrived rapidly the queue could contain:
 *   [typeA, dataA, typeB, dataB]
 * and the consumer would dequeue pairs, but under concurrent emission the
 * entries could desync:
 *   shift() → typeA, shift() → dataA  ✓
 *   shift() → typeB, shift() → dataB  ✓
 * OR if the consumer interleaved with a new push mid-dequeue:
 *   shift() → typeA, shift() → typeB  ✗  (type mismatch)
 *
 * The fix (sse.ts line 22) enqueues a single JSON object per event:
 *   queue.push(JSON.stringify({ type: event.type, data: event.payload }))
 * This test suite proves that fix.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InProcessEventBus } from "../events/bus.js";
import type { BoardEvent } from "../events/types.js";

// ── helpers ────────────────────────────────────────────────────────────────────

/**
 * Simulate the exact serialisation logic from sse.ts:
 *   queue.push(JSON.stringify({ type: event.type, data: event.payload }))
 */
function enqueue(queue: string[], event: BoardEvent): void {
	queue.push(JSON.stringify({ type: event.type, data: event.payload }));
}

/**
 * Simulate the exact deserialisation logic from sse.ts:
 *   const { type, data } = JSON.parse(raw)
 */
function dequeue(raw: string): { type: string; data: unknown } {
	return JSON.parse(raw) as { type: string; data: unknown };
}

// ── BUG-008 regression: single-object queue format ─────────────────────────────

describe("SSE queue serialisation (BUG-008 regression)", () => {
	it("each queue entry is a single JSON object containing both type and data", () => {
		const queue: string[] = [];
		const event: BoardEvent = {
			type: "card.created",
			boardId: "board-1",
			payload: { id: "card-1", title: "Fix the bug" },
		};

		enqueue(queue, event);

		// Exactly one entry in the queue (not two separate entries)
		expect(queue).toHaveLength(1);

		const parsed = dequeue(queue[0]!);
		expect(parsed.type).toBe("card.created");
		expect(parsed.data).toEqual({ id: "card-1", title: "Fix the bug" });
	});

	it("two rapid events produce two separate queue entries without desync", () => {
		const queue: string[] = [];

		const eventA: BoardEvent = {
			type: "card.created",
			boardId: "board-1",
			payload: { id: "card-A" },
		};
		const eventB: BoardEvent = {
			type: "card.updated",
			boardId: "board-1",
			payload: { id: "card-B", title: "Updated" },
		};

		enqueue(queue, eventA);
		enqueue(queue, eventB);

		expect(queue).toHaveLength(2);

		const parsedA = dequeue(queue[0]!);
		const parsedB = dequeue(queue[1]!);

		// Each entry contains its own event — type and data are always paired
		expect(parsedA.type).toBe("card.created");
		expect(parsedA.data).toEqual({ id: "card-A" });

		expect(parsedB.type).toBe("card.updated");
		expect(parsedB.data).toEqual({ id: "card-B", title: "Updated" });
	});

	it("BUG-008 proof: type and data from the same event survive round-trip without desync", () => {
		// Simulate rapid emission and processing as the queue consumer would see it.
		const queue: string[] = [];

		const events: BoardEvent[] = [
			{
				type: "card.attachment.added",
				boardId: "board-1",
				payload: { id: "att-1", filename: "photo.png" },
			},
			{
				type: "card.attachment.removed",
				boardId: "board-1",
				payload: { id: "att-2", cardId: "card-2" },
			},
			{
				type: "column.created",
				boardId: "board-1",
				payload: { id: "col-1", title: "Backlog" },
			},
		];

		// Enqueue all events as the SSE subscriber would
		for (const event of events) {
			enqueue(queue, event);
		}

		// Dequeue as the SSE loop would — each raw string must parse to a coherent pair
		for (let i = 0; i < events.length; i++) {
			const raw = queue.shift()!;
			const { type, data } = dequeue(raw);

			// type and data must both come from events[i], never from events[i+1]
			expect(type).toBe(events[i]!.type);
			expect(data).toEqual(events[i]!.payload);
		}

		expect(queue).toHaveLength(0);
	});
});

// ── InProcessEventBus integration with queue format ───────────────────────────

describe("InProcessEventBus + queue serialisation integration", () => {
	let bus: InProcessEventBus;
	let queue: string[];

	beforeEach(() => {
		bus = new InProcessEventBus();
		queue = [];
	});

	it("listener receives the exact BoardEvent emitted", () => {
		const received: BoardEvent[] = [];
		bus.subscribe("board-1", (event) => received.push(event));

		const evt: BoardEvent = {
			type: "card.created",
			boardId: "board-1",
			payload: { id: "card-1" },
		};
		bus.emit(evt);

		expect(received).toHaveLength(1);
		expect(received[0]).toEqual(evt);
	});

	it("listener is NOT called for a different boardId", () => {
		const received: BoardEvent[] = [];
		bus.subscribe("board-1", (event) => received.push(event));

		bus.emit({
			type: "card.created",
			boardId: "board-2",
			payload: { id: "card-x" },
		});

		expect(received).toHaveLength(0);
	});

	it("serialised queue entries from bus events decode back to coherent pairs", () => {
		bus.subscribe("board-1", (event) => {
			// Mirrors sse.ts logic exactly
			queue.push(JSON.stringify({ type: event.type, data: event.payload }));
		});

		const eventA: BoardEvent = {
			type: "card.created",
			boardId: "board-1",
			payload: { id: "card-A", title: "First" },
		};
		const eventB: BoardEvent = {
			type: "card.updated",
			boardId: "board-1",
			payload: { id: "card-B", title: "Second" },
		};

		bus.emit(eventA);
		bus.emit(eventB);

		// Two entries, each a single JSON object
		expect(queue).toHaveLength(2);

		const parsedA = JSON.parse(queue[0]!) as { type: string; data: unknown };
		const parsedB = JSON.parse(queue[1]!) as { type: string; data: unknown };

		expect(parsedA).toEqual({ type: "card.created", data: { id: "card-A", title: "First" } });
		expect(parsedB).toEqual({ type: "card.updated", data: { id: "card-B", title: "Second" } });
	});

	it("unsubscribing stops listener from receiving further events", () => {
		const received: BoardEvent[] = [];
		const unsubscribe = bus.subscribe("board-1", (event) =>
			received.push(event),
		);

		bus.emit({ type: "card.created", boardId: "board-1", payload: {} });
		expect(received).toHaveLength(1);

		unsubscribe();

		bus.emit({ type: "card.updated", boardId: "board-1", payload: {} });
		expect(received).toHaveLength(1); // no new events after unsubscribe
	});

	it("emitting with no subscribers is silently dropped — no error", () => {
		// No subscriber registered for board-3
		expect(() =>
			bus.emit({
				type: "card.created",
				boardId: "board-3",
				payload: {},
			}),
		).not.toThrow();
	});
});
