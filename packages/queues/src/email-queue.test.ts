import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Use vi.hoisted so mock variables are initialized before vi.mock factories run.
// ---------------------------------------------------------------------------

const { mockQueueAdd, MockQueue } = vi.hoisted(() => {
  const mockQueueAdd = vi.fn().mockResolvedValue({ id: "job-1", name: "send" });
  const MockQueue = vi.fn().mockImplementation(function (name: string, opts: unknown) {
    return { name, opts, add: mockQueueAdd };
  });
  return { mockQueueAdd, MockQueue };
});

vi.mock("bullmq", () => ({ Queue: MockQueue }));
vi.mock("ioredis", () => ({
  Redis: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER the mocks
// ---------------------------------------------------------------------------

import { emailQueue } from "./email-queue.js";
import type { EmailJobData } from "./email-queue.js";

// ---------------------------------------------------------------------------
// Capture constructor args once at import time, before any clearAllMocks
// ---------------------------------------------------------------------------

// The Queue constructor is called once at module-load time.
// Save the captured args so that beforeEach's clearAllMocks doesn't lose them.
const queueConstructorArgs = MockQueue.mock.calls[0] as [
  string,
  {
    connection: unknown;
    defaultJobOptions: {
      attempts: number;
      backoff: { type: string; delay: number };
    };
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("emailQueue construction", () => {
  it("creates the Queue with name 'email'", () => {
    expect(queueConstructorArgs[0]).toBe("email");
  });

  it("Queue instance has name 'email'", () => {
    expect((emailQueue as unknown as { name: string }).name).toBe("email");
  });

  it("defaultJobOptions has attempts: 3", () => {
    expect(queueConstructorArgs[1].defaultJobOptions.attempts).toBe(3);
  });

  it("defaultJobOptions has exponential backoff type", () => {
    expect(queueConstructorArgs[1].defaultJobOptions.backoff.type).toBe("exponential");
  });

  it("defaultJobOptions has backoff delay of 5000ms", () => {
    expect(queueConstructorArgs[1].defaultJobOptions.backoff.delay).toBe(5_000);
  });

  it("Queue is constructed with a connection option", () => {
    expect(queueConstructorArgs[1].connection).toBeDefined();
  });
});

describe("emailQueue.add", () => {
  beforeEach(() => {
    mockQueueAdd.mockClear();
    mockQueueAdd.mockResolvedValue({ id: "job-1", name: "send" });
  });

  it("delegates to the underlying Queue add method", async () => {
    const data: EmailJobData = {
      to: "user@hirokata.dev",
      subject: "Hello",
      html: "<p>Hello!</p>",
    };
    await emailQueue.add("send", data);
    expect(mockQueueAdd).toHaveBeenCalledWith("send", data);
  });

  it("returns the result from the Queue add method", async () => {
    const data: EmailJobData = { to: "a@b.com", subject: "Hi", html: "<p>Hi</p>" };
    const result = await emailQueue.add("send", data);
    expect(result).toEqual({ id: "job-1", name: "send" });
  });
});

// ---------------------------------------------------------------------------
// EmailJobData type shape — verified via structural assignment
// ---------------------------------------------------------------------------

describe("EmailJobData shape", () => {
  it("has to, subject, and html string fields", () => {
    const job: EmailJobData = {
      to: "recipient@example.com",
      subject: "Test subject",
      html: "<h1>Test</h1>",
    };
    expect(job.to).toBe("recipient@example.com");
    expect(job.subject).toBe("Test subject");
    expect(job.html).toBe("<h1>Test</h1>");
  });
});
