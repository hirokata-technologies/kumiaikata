import { describe, it, expect, vi, afterEach } from "vitest";
import { InProcessEventBus } from "./bus.js";
import type { BoardEvent } from "./types.js";

function makeEvent(boardId: string): BoardEvent {
	return { type: "column.created", boardId, payload: {} };
}

describe("InProcessEventBus", () => {
	it("delivers an emitted event to a subscriber for the same boardId", () => {
		const bus = new InProcessEventBus();
		const listener = vi.fn();
		bus.subscribe("board-1", listener);

		const event = makeEvent("board-1");
		bus.emit(event);

		expect(listener).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalledWith(event);
	});

	it("does NOT deliver an event to a subscriber for a different boardId", () => {
		const bus = new InProcessEventBus();
		const listener = vi.fn();
		bus.subscribe("board-2", listener);

		bus.emit(makeEvent("board-1"));

		expect(listener).not.toHaveBeenCalled();
	});

	it("stops delivering events after unsubscription", () => {
		const bus = new InProcessEventBus();
		const listener = vi.fn();
		const unsubscribe = bus.subscribe("board-1", listener);

		unsubscribe();
		bus.emit(makeEvent("board-1"));

		expect(listener).not.toHaveBeenCalled();
	});

	it("calls all subscribers for the same boardId exactly once each", () => {
		const bus = new InProcessEventBus();
		const listenerA = vi.fn();
		const listenerB = vi.fn();
		bus.subscribe("board-1", listenerA);
		bus.subscribe("board-1", listenerB);

		bus.emit(makeEvent("board-1"));

		expect(listenerA).toHaveBeenCalledOnce();
		expect(listenerB).toHaveBeenCalledOnce();
	});

	it("emits no error when there are no subscribers for the boardId", () => {
		const bus = new InProcessEventBus();
		expect(() => bus.emit(makeEvent("board-orphan"))).not.toThrow();
	});

	it("does not emit MaxListenersExceededWarning with more than 10 subscribers (US-4 AC 5)", () => {
		const bus = new InProcessEventBus();
		const warnings: string[] = [];

		const warningHandler = (warning: Error) => {
			if (warning.name === "MaxListenersExceededWarning") {
				warnings.push(warning.message);
			}
		};
		process.on("warning", warningHandler);

		// Add 50 subscribers — default Node.js limit is 10; setMaxListeners(0) removes the cap.
		const unsubs: Array<() => void> = [];
		for (let i = 0; i < 50; i++) {
			unsubs.push(bus.subscribe("board-1", vi.fn()));
		}

		// Allow any pending microtasks to flush
		process.removeListener("warning", warningHandler);

		// Clean up
		for (const unsub of unsubs) unsub();

		expect(warnings).toHaveLength(0);
	});

	it("delivers events to multiple distinct boardIds independently", () => {
		const bus = new InProcessEventBus();
		const l1 = vi.fn();
		const l2 = vi.fn();
		bus.subscribe("board-A", l1);
		bus.subscribe("board-B", l2);

		bus.emit(makeEvent("board-A"));

		expect(l1).toHaveBeenCalledOnce();
		expect(l2).not.toHaveBeenCalled();
	});
});
