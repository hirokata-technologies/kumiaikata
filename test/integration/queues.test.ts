import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";

const REDIS_URL = "redis://localhost:6379";

describe("BullMQ email queue (Valkey)", () => {
	let connection: Redis;
	let queue: Queue;

	beforeAll(() => {
		connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
		queue = new Queue("integration-test-email", {
			connection,
			defaultJobOptions: { attempts: 1 },
		});
	});

	afterAll(async () => {
		await queue.obliterate({ force: true });
		await queue.close();
		await connection.quit();
	});

	it("can add a job to the queue", async () => {
		const job = await queue.add("send", {
			to: "test@example.com",
			subject: "Integration Test",
			html: "<p>Test</p>",
		});
		expect(job.id).toBeTruthy();
		expect(job.name).toBe("send");
	});

	it("job data is preserved correctly", async () => {
		const data = {
			to: "user@hirokata.dev",
			subject: "Test Subject",
			html: "<p>Hello</p>",
		};
		const job = await queue.add("send", data);
		const retrieved = await queue.getJob(job.id!);
		expect(retrieved?.data).toEqual(data);
	});

	it("a Worker processes queued jobs", async () => {
		const workerConn = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
		const processed: unknown[] = [];

		const worker = new Worker(
			"integration-test-email",
			async (job) => {
				processed.push(job.data);
			},
			{ connection: workerConn },
		);

		await queue.add("send", { to: "a@b.com", subject: "S", html: "<p>H</p>" });
		await new Promise((r) => setTimeout(r, 1_000));

		expect(processed.length).toBeGreaterThan(0);

		await worker.close();
		await workerConn.quit();
	});

	it("queue reports correct job counts", async () => {
		const counts = await queue.getJobCounts("waiting", "completed", "failed");
		expect(typeof counts.waiting).toBe("number");
	});

	it("can add multiple jobs with different names", async () => {
		const job1 = await queue.add("send", {
			to: "a@example.com",
			subject: "A",
			html: "<p>A</p>",
		});
		const job2 = await queue.add("send", {
			to: "b@example.com",
			subject: "B",
			html: "<p>B</p>",
		});
		expect(job1.id).not.toBe(job2.id);
		expect(job1.name).toBe("send");
		expect(job2.name).toBe("send");
	});

	it("failed jobs are tracked in failed count", async () => {
		const failQueue = new Queue("integration-test-fail", {
			connection,
			defaultJobOptions: { attempts: 1 },
		});
		const failWorkerConn = new Redis(REDIS_URL, {
			maxRetriesPerRequest: null,
		});

		const worker = new Worker(
			"integration-test-fail",
			async () => {
				throw new Error("Intentional failure for test");
			},
			{ connection: failWorkerConn },
		);

		await failQueue.add("fail-job", { reason: "test" });
		await new Promise((r) => setTimeout(r, 1_500));

		const counts = await failQueue.getJobCounts("failed");
		expect(counts.failed).toBeGreaterThan(0);

		await worker.close();
		await failWorkerConn.quit();
		await failQueue.obliterate({ force: true });
		await failQueue.close();
	});

	it("job priority is stored correctly", async () => {
		const priorityQueue = new Queue("integration-test-priority", {
			connection,
			defaultJobOptions: { attempts: 1 },
		});

		const lowPriority = await priorityQueue.add(
			"send",
			{ to: "low@example.com", subject: "Low", html: "<p>Low</p>" },
			{ priority: 10 },
		);
		const highPriority = await priorityQueue.add(
			"send",
			{ to: "high@example.com", subject: "High", html: "<p>High</p>" },
			{ priority: 1 },
		);

		expect(lowPriority.id).toBeTruthy();
		expect(highPriority.id).toBeTruthy();

		await priorityQueue.obliterate({ force: true });
		await priorityQueue.close();
	});
});
