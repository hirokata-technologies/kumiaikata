import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Use vi.hoisted so mock variables are initialized before vi.mock factories run.
// ---------------------------------------------------------------------------

const { mockEmailsSend, MockResend, MockWorker, MockRedis } = vi.hoisted(() => {
  const mockEmailsSend = vi.fn().mockResolvedValue({ data: { id: "email-1" }, error: null });
  const MockResend = vi.fn().mockImplementation(function () {
    return { emails: { send: mockEmailsSend } };
  });
  const MockWorker = vi.fn().mockImplementation(function () {
    return { on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
  });
  const MockRedis = vi.fn().mockImplementation(function () {
    return {};
  });
  return { mockEmailsSend, MockResend, MockWorker, MockRedis };
});

vi.mock("resend", () => ({ Resend: MockResend }));
vi.mock("bullmq", () => ({ Worker: MockWorker }));
vi.mock("ioredis", () => ({ Redis: MockRedis }));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are declared
// ---------------------------------------------------------------------------

import { emailWorker } from "./email-worker.js";
import type { EmailJobData } from "./email-queue.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JobLike = { data: EmailJobData };

// The Worker constructor is called once at module-load time.
// Save the processor before any clearAllMocks() wipes the call history.
const workerConstructorArgs = MockWorker.mock.calls[0] as [
  string,
  (job: JobLike) => Promise<void>,
  { connection: unknown },
];

const capturedProcessor = workerConstructorArgs[1];

// ---------------------------------------------------------------------------
// Worker construction
// ---------------------------------------------------------------------------

describe("emailWorker construction", () => {
  it("creates a Worker with name 'email'", () => {
    expect(workerConstructorArgs[0]).toBe("email");
  });

  it("creates a Worker with a connection option", () => {
    expect(workerConstructorArgs[2].connection).toBeDefined();
  });

  it("creates exactly one Worker instance (singleton at module level)", () => {
    expect(MockWorker).toHaveBeenCalledTimes(1);
  });

  it("emailWorker is defined (module export exists)", () => {
    expect(emailWorker).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Processor function
// ---------------------------------------------------------------------------

describe("email processor function", () => {
  beforeEach(() => {
    mockEmailsSend.mockClear();
    mockEmailsSend.mockResolvedValue({ data: { id: "email-1" }, error: null });
    MockResend.mockClear();
    MockResend.mockImplementation(function () {
      return { emails: { send: mockEmailsSend } };
    });
  });

  it("calls resend.emails.send with the correct FROM address", async () => {
    const job: JobLike = {
      data: { to: "user@hirokata.dev", subject: "Hello", html: "<p>Hi</p>" },
    };

    await capturedProcessor(job);

    expect(mockEmailsSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Kata <noreply@hirokata.dev>" }),
    );
  });

  it("calls resend.emails.send with the job's 'to' address", async () => {
    const job: JobLike = {
      data: { to: "recipient@example.com", subject: "Subject", html: "<p>Body</p>" },
    };

    await capturedProcessor(job);

    expect(mockEmailsSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: "recipient@example.com" }),
    );
  });

  it("calls resend.emails.send with the job's subject", async () => {
    const job: JobLike = {
      data: { to: "a@b.com", subject: "Welcome to Kata", html: "<p>Welcome</p>" },
    };

    await capturedProcessor(job);

    expect(mockEmailsSend).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Welcome to Kata" }),
    );
  });

  it("calls resend.emails.send with the job's html content", async () => {
    const job: JobLike = {
      data: { to: "a@b.com", subject: "Hi", html: "<h1>Hello World</h1>" },
    };

    await capturedProcessor(job);

    expect(mockEmailsSend).toHaveBeenCalledWith(
      expect.objectContaining({ html: "<h1>Hello World</h1>" }),
    );
  });

  it("calls resend.emails.send with all four required fields", async () => {
    const job: JobLike = {
      data: { to: "bob@acme.com", subject: "Invite", html: "<p>You are invited</p>" },
    };

    await capturedProcessor(job);

    expect(mockEmailsSend).toHaveBeenCalledWith({
      from: "Kata <noreply@hirokata.dev>",
      to: "bob@acme.com",
      subject: "Invite",
      html: "<p>You are invited</p>",
    });
  });

  it("propagates errors thrown by resend.emails.send", async () => {
    const sendError = new Error("Resend API error");
    mockEmailsSend.mockRejectedValueOnce(sendError);

    const job: JobLike = {
      data: { to: "fail@example.com", subject: "Fail", html: "<p>fail</p>" },
    };

    await expect(capturedProcessor(job)).rejects.toThrow("Resend API error");
  });

  it("resolves successfully when resend.emails.send succeeds", async () => {
    const job: JobLike = {
      data: { to: "ok@example.com", subject: "OK", html: "<p>ok</p>" },
    };

    await expect(capturedProcessor(job)).resolves.toBeUndefined();
  });

  it("FROM address is always 'Kata <noreply@hirokata.dev>' regardless of job data", async () => {
    const jobs: JobLike[] = [
      { data: { to: "a@x.com", subject: "S1", html: "<p>1</p>" } },
      { data: { to: "b@y.com", subject: "S2", html: "<p>2</p>" } },
    ];

    for (const job of jobs) {
      await capturedProcessor(job);
      const lastCall = mockEmailsSend.mock.calls.at(-1)!;
      const payload = lastCall[0] as { from: string };
      expect(payload.from).toBe("Kata <noreply@hirokata.dev>");
    }
  });
});
