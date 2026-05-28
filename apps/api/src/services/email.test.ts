import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Resend SDK before importing the email service.
// The service instantiates `new Resend(...)` at module level, so the mock
// must be hoisted above the import. vi.hoisted() runs before vi.mock() and
// before any imports, making the returned values available in the factory.
// ---------------------------------------------------------------------------

const { mockEmailsSend, constructorCallCount } = vi.hoisted(() => ({
	mockEmailsSend: vi.fn(),
	constructorCallCount: { value: 0 },
}));

vi.mock("resend", () => {
	function MockResend() {
		constructorCallCount.value++;
		return {
			emails: {
				send: mockEmailsSend,
			},
		};
	}
	return {
		Resend: vi.fn(MockResend),
	};
});

// Import after mock is registered.
import { sendEmail } from "./email.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUCCESS_RESPONSE = { data: { id: "email-id-123" }, error: null };

// ---------------------------------------------------------------------------
// sendEmail — happy path
// ---------------------------------------------------------------------------

describe("sendEmail", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("calls resend.emails.send with from, to, subject, and html", async () => {
		mockEmailsSend.mockResolvedValueOnce(SUCCESS_RESPONSE);

		await sendEmail({
			to: "user@example.com",
			subject: "Hello",
			html: "<p>Hello</p>",
		});

		expect(mockEmailsSend).toHaveBeenCalledOnce();
		expect(mockEmailsSend).toHaveBeenCalledWith({
			from: "Kata <noreply@hirokata.dev>",
			to: "user@example.com",
			subject: "Hello",
			html: "<p>Hello</p>",
		});
	});

	it("hardcodes the from address as 'Kata <noreply@hirokata.dev>'", async () => {
		mockEmailsSend.mockResolvedValueOnce(SUCCESS_RESPONSE);

		await sendEmail({
			to: "anyone@example.com",
			subject: "Subject",
			html: "<p>body</p>",
		});

		const callArg = mockEmailsSend.mock.calls[0]![0] as Record<string, unknown>;
		expect(callArg.from).toBe("Kata <noreply@hirokata.dev>");
	});

	it("resolves without returning a value on success", async () => {
		mockEmailsSend.mockResolvedValueOnce(SUCCESS_RESPONSE);

		const result = await sendEmail({
			to: "user@example.com",
			subject: "Verify your Kata email address",
			html: "<p>Click <a href='https://example.com'>here</a> to verify.</p>",
		});

		expect(result).toBeUndefined();
	});

	// -------------------------------------------------------------------------
	// Error propagation — REQ-003 requires all Resend errors to re-throw
	// -------------------------------------------------------------------------

	it("propagates a network error thrown by resend.emails.send", async () => {
		const networkError = new Error("Network failure");
		mockEmailsSend.mockRejectedValueOnce(networkError);

		await expect(
			sendEmail({
				to: "user@example.com",
				subject: "Test",
				html: "<p>Test</p>",
			}),
		).rejects.toThrow("Network failure");
	});

	it("propagates a rate-limit error (Resend 429) thrown by the SDK", async () => {
		const rateLimitError = new Error("Too Many Requests");
		mockEmailsSend.mockRejectedValueOnce(rateLimitError);

		await expect(
			sendEmail({
				to: "user@example.com",
				subject: "Test",
				html: "<p>Test</p>",
			}),
		).rejects.toThrow("Too Many Requests");
	});

	it("propagates an auth error (invalid API key) thrown by the SDK", async () => {
		const authError = new Error("API key is invalid");
		mockEmailsSend.mockRejectedValueOnce(authError);

		await expect(
			sendEmail({
				to: "user@example.com",
				subject: "Test",
				html: "<p>Test</p>",
			}),
		).rejects.toThrow("API key is invalid");
	});

	it("does not swallow errors — the original error instance propagates unchanged", async () => {
		const originalError = new Error("Resend domain not verified");
		mockEmailsSend.mockRejectedValueOnce(originalError);

		let caught: unknown;
		try {
			await sendEmail({ to: "user@example.com", subject: "S", html: "<p>H</p>" });
		} catch (err) {
			caught = err;
		}

		expect(caught).toBe(originalError);
	});

	// -------------------------------------------------------------------------
	// Client instantiation — REQ-003 US-4: singleton, not per-request
	// -------------------------------------------------------------------------

	it("instantiates the Resend client exactly once at module load (singleton)", () => {
		// The Resend constructor is called once when the module is first imported.
		// constructorCallCount is a plain counter that persists across clearAllMocks()
		// calls, so it accurately reflects the total construction count.
		expect(constructorCallCount.value).toBe(1);
	});

	it("reuses the same client for multiple sendEmail calls", async () => {
		mockEmailsSend.mockResolvedValue(SUCCESS_RESPONSE);

		await sendEmail({ to: "a@example.com", subject: "S1", html: "<p>1</p>" });
		await sendEmail({ to: "b@example.com", subject: "S2", html: "<p>2</p>" });
		await sendEmail({ to: "c@example.com", subject: "S3", html: "<p>3</p>" });

		// Still only one Resend instance created (from module load)
		expect(constructorCallCount.value).toBe(1);
		// But emails.send was called three times on that same instance
		expect(mockEmailsSend).toHaveBeenCalledTimes(3);
	});

	// -------------------------------------------------------------------------
	// Verification email use case (US-1)
	// -------------------------------------------------------------------------

	it("sends the verification email with the correct subject and a link in the html", async () => {
		mockEmailsSend.mockResolvedValueOnce(SUCCESS_RESPONSE);
		const verificationUrl = "https://api.hirokata.dev/verify?token=abc123";

		await sendEmail({
			to: "newuser@example.com",
			subject: "Verify your Kata email address",
			html: `<p>Click <a href="${verificationUrl}">here</a> to verify your email address.</p>`,
		});

		const callArg = mockEmailsSend.mock.calls[0]![0] as Record<string, unknown>;
		expect(callArg.to).toBe("newuser@example.com");
		expect(callArg.subject).toBe("Verify your Kata email address");
		expect((callArg.html as string)).toContain(verificationUrl);
	});

	// -------------------------------------------------------------------------
	// Password reset email use case (US-2)
	// -------------------------------------------------------------------------

	it("sends the password reset email with the correct subject and a link in the html", async () => {
		mockEmailsSend.mockResolvedValueOnce(SUCCESS_RESPONSE);
		const resetUrl = "https://api.hirokata.dev/reset-password?token=xyz789";

		await sendEmail({
			to: "user@example.com",
			subject: "Reset your Kata password",
			html: `<p>Click <a href="${resetUrl}">here</a> to reset your password.</p>`,
		});

		const callArg = mockEmailsSend.mock.calls[0]![0] as Record<string, unknown>;
		expect(callArg.to).toBe("user@example.com");
		expect(callArg.subject).toBe("Reset your Kata password");
		expect((callArg.html as string)).toContain(resetUrl);
	});
});
