import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Redis } from "ioredis";

const VALKEY_URL = "redis://localhost:6379";

describe("Redis pub/sub (Valkey)", () => {
	let publisher: Redis;
	let subscriber: Redis;

	beforeAll(() => {
		publisher = new Redis(VALKEY_URL);
		subscriber = new Redis(VALKEY_URL);
	});

	afterAll(async () => {
		await publisher.quit();
		await subscriber.quit();
	});

	it("can connect to Valkey", async () => {
		const result = await publisher.ping();
		expect(result).toBe("PONG");
	});

	it("subscriber receives published message on subscribed channel", async () => {
		const channel = `test-channel-${Date.now()}`;
		const received: string[] = [];

		await subscriber.subscribe(channel);
		subscriber.on("message", (_ch: string, msg: string) => received.push(msg));

		await publisher.publish(channel, "hello-kata");
		await new Promise((r) => setTimeout(r, 200));

		expect(received).toContain("hello-kata");
		await subscriber.unsubscribe(channel);
	});

	it("subscriber does NOT receive messages on unsubscribed channels", async () => {
		const channel = `test-channel-other-${Date.now()}`;
		const received: string[] = [];
		subscriber.on("message", (_ch: string, msg: string) => received.push(msg));

		await publisher.publish(channel, "should-not-receive");
		await new Promise((r) => setTimeout(r, 200));

		expect(received).not.toContain("should-not-receive");
	});

	it("can publish JSON board events and receive them", async () => {
		const boardId = `board-${Date.now()}`;
		const event = {
			type: "card.created",
			boardId,
			payload: { id: "card-1" },
		};
		const received: unknown[] = [];

		await subscriber.subscribe(boardId);
		subscriber.on("message", (_ch: string, msg: string) => {
			try {
				received.push(JSON.parse(msg));
			} catch {}
		});

		await publisher.publish(boardId, JSON.stringify(event));
		await new Promise((r) => setTimeout(r, 200));

		expect(received).toHaveLength(1);
		expect(received[0]).toEqual(event);
		await subscriber.unsubscribe(boardId);
	});

	it("multiple subscribers on the same channel all receive the message", async () => {
		const channel = `test-multi-${Date.now()}`;
		const extraSubscriber = new Redis(VALKEY_URL);
		const received1: string[] = [];
		const received2: string[] = [];

		await subscriber.subscribe(channel);
		await extraSubscriber.subscribe(channel);

		subscriber.on("message", (_ch: string, msg: string) =>
			received1.push(msg),
		);
		extraSubscriber.on("message", (_ch: string, msg: string) =>
			received2.push(msg),
		);

		await publisher.publish(channel, "broadcast-message");
		await new Promise((r) => setTimeout(r, 200));

		expect(received1).toContain("broadcast-message");
		expect(received2).toContain("broadcast-message");

		await subscriber.unsubscribe(channel);
		await extraSubscriber.quit();
	});

	it("can publish multiple events in sequence", async () => {
		const channel = `test-sequence-${Date.now()}`;
		const received: string[] = [];

		await subscriber.subscribe(channel);
		subscriber.on("message", (_ch: string, msg: string) => received.push(msg));

		await publisher.publish(channel, "event-1");
		await publisher.publish(channel, "event-2");
		await publisher.publish(channel, "event-3");
		await new Promise((r) => setTimeout(r, 300));

		expect(received).toContain("event-1");
		expect(received).toContain("event-2");
		expect(received).toContain("event-3");
		await subscriber.unsubscribe(channel);
	});

	it("Valkey supports SET/GET for basic key-value operations", async () => {
		const key = `test-key-${Date.now()}`;
		await publisher.set(key, "kata-value", "EX", 10);
		const val = await publisher.get(key);
		expect(val).toBe("kata-value");
		await publisher.del(key);
	});

	it("expired keys are not returned", async () => {
		const key = `test-ttl-${Date.now()}`;
		await publisher.set(key, "temporary", "PX", 100); // 100ms TTL
		await new Promise((r) => setTimeout(r, 200));
		const val = await publisher.get(key);
		expect(val).toBeNull();
	});
});
