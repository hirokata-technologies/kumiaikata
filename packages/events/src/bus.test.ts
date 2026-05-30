import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Use vi.hoisted so mock variables are initialized before vi.mock factories run.
// vi.mock is hoisted by vitest, but top-level const/let are not — vi.hoisted
// solves the "Cannot access before initialization" temporal dead zone issue.
// ---------------------------------------------------------------------------

const {
  mockPublish,
  mockSubscribe,
  mockOn,
  mockUnsubscribe,
  mockDisconnect,
  mockCreateSubscriber,
} = vi.hoisted(() => {
  const mockPublish = vi.fn().mockResolvedValue(1);
  const mockSubscribe = vi.fn().mockResolvedValue(undefined);
  const mockOn = vi.fn();
  const mockUnsubscribe = vi.fn().mockResolvedValue(undefined);
  const mockDisconnect = vi.fn();
  const mockCreateSubscriber = vi.fn(() => ({
    subscribe: mockSubscribe,
    on: mockOn,
    unsubscribe: mockUnsubscribe,
    disconnect: mockDisconnect,
  }));
  return { mockPublish, mockSubscribe, mockOn, mockUnsubscribe, mockDisconnect, mockCreateSubscriber };
});

vi.mock("@kata/redis", () => ({
  redis: { publish: mockPublish },
  createSubscriber: mockCreateSubscriber,
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER the mock declarations
// ---------------------------------------------------------------------------

import { eventBus } from "./bus.js";
import type { BoardEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(boardId: string, type: BoardEvent["type"] = "column.created"): BoardEvent {
  return { type, boardId, payload: { id: "col-1" } } as BoardEvent;
}

// ---------------------------------------------------------------------------
// emit
// ---------------------------------------------------------------------------

describe("eventBus.emit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default return values after clearAllMocks
    mockPublish.mockResolvedValue(1);
  });

  it("calls redis.publish with the boardId as the channel", () => {
    const event = makeEvent("board-abc");
    eventBus.emit(event);
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [channel] = mockPublish.mock.calls[0] as [string, string];
    expect(channel).toBe("board-abc");
  });

  it("calls redis.publish with JSON-serialized event as the message", () => {
    const event = makeEvent("board-xyz", "card.created");
    eventBus.emit(event);
    const [, message] = mockPublish.mock.calls[0] as [string, string];
    expect(JSON.parse(message)).toEqual(event);
  });

  it("fire-and-forgets — emit returns void (undefined)", () => {
    const event = makeEvent("board-1");
    const result = eventBus.emit(event);
    expect(result).toBeUndefined();
  });

  it("publishes different events to their respective boardId channels", () => {
    const event1 = makeEvent("board-A", "card.updated");
    const event2 = makeEvent("board-B", "column.deleted");
    eventBus.emit(event1);
    eventBus.emit(event2);
    expect(mockPublish).toHaveBeenCalledTimes(2);
    const call1 = mockPublish.mock.calls[0] as [string, string];
    const call2 = mockPublish.mock.calls[1] as [string, string];
    expect(call1[0]).toBe("board-A");
    expect(call2[0]).toBe("board-B");
  });
});

// ---------------------------------------------------------------------------
// subscribe
// ---------------------------------------------------------------------------

describe("eventBus.subscribe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore mock implementations after clearAllMocks resets them
    mockSubscribe.mockResolvedValue(undefined);
    mockUnsubscribe.mockResolvedValue(undefined);
    mockCreateSubscriber.mockImplementation(() => ({
      subscribe: mockSubscribe,
      on: mockOn,
      unsubscribe: mockUnsubscribe,
      disconnect: mockDisconnect,
    }));
  });

  it("calls createSubscriber() to get a dedicated connection", () => {
    eventBus.subscribe("board-1", vi.fn());
    expect(mockCreateSubscriber).toHaveBeenCalledTimes(1);
  });

  it("calls sub.subscribe(boardId) on the new subscriber", () => {
    eventBus.subscribe("board-42", vi.fn());
    expect(mockSubscribe).toHaveBeenCalledWith("board-42");
  });

  it("attaches a 'message' listener via sub.on", () => {
    eventBus.subscribe("board-1", vi.fn());
    expect(mockOn).toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("message listener calls user listener when the channel matches boardId", () => {
    const userListener = vi.fn();
    eventBus.subscribe("board-99", userListener);

    // Capture the handler that was passed to sub.on("message", handler)
    const handler = mockOn.mock.calls[0]?.[1] as (_ch: string, _msg: string) => void;
    const event = makeEvent("board-99");
    handler("board-99", JSON.stringify(event));

    expect(userListener).toHaveBeenCalledTimes(1);
    expect(userListener).toHaveBeenCalledWith(event);
  });

  it("message listener calls user listener with the parsed BoardEvent", () => {
    const userListener = vi.fn();
    eventBus.subscribe("board-10", userListener);

    const handler = mockOn.mock.calls[0]?.[1] as (_ch: string, _msg: string) => void;
    const event = makeEvent("board-10");
    handler("board-10", JSON.stringify(event));

    expect(userListener).toHaveBeenCalledWith(event);
  });

  it("message listener silently ignores malformed JSON", () => {
    const userListener = vi.fn();
    eventBus.subscribe("board-1", userListener);

    const handler = mockOn.mock.calls[0]?.[1] as (_ch: string, _msg: string) => void;

    expect(() => handler("board-1", "not-valid-json{{{")).not.toThrow();
    expect(userListener).not.toHaveBeenCalled();
  });

  it("message listener silently ignores empty message", () => {
    const userListener = vi.fn();
    eventBus.subscribe("board-1", userListener);

    const handler = mockOn.mock.calls[0]?.[1] as (_ch: string, _msg: string) => void;

    expect(() => handler("board-1", "")).not.toThrow();
    expect(userListener).not.toHaveBeenCalled();
  });

  it("returns an unsubscribe function", () => {
    const unsub = eventBus.subscribe("board-1", vi.fn());
    expect(typeof unsub).toBe("function");
  });

  it("unsubscribe function calls sub.unsubscribe(boardId)", () => {
    const unsub = eventBus.subscribe("board-7", vi.fn());
    unsub();
    expect(mockUnsubscribe).toHaveBeenCalledWith("board-7");
  });

  it("unsubscribe function calls sub.disconnect()", () => {
    const unsub = eventBus.subscribe("board-7", vi.fn());
    unsub();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("multiple subscriptions each get their own subscriber connection", () => {
    eventBus.subscribe("board-A", vi.fn());
    eventBus.subscribe("board-A", vi.fn());
    eventBus.subscribe("board-B", vi.fn());

    // createSubscriber should be called once per subscribe call
    expect(mockCreateSubscriber).toHaveBeenCalledTimes(3);
  });

  it("listener receives parsed BoardEvent object (not raw string)", () => {
    const userListener = vi.fn();
    eventBus.subscribe("board-1", userListener);

    const handler = mockOn.mock.calls[0]?.[1] as (_ch: string, _msg: string) => void;
    const event = makeEvent("board-1", "label.created");
    handler("board-1", JSON.stringify(event));

    const received = userListener.mock.calls[0]?.[0] as BoardEvent;
    expect(received).toEqual(event);
    expect(typeof received).toBe("object");
  });
});
