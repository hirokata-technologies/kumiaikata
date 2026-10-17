import { describe, it, expect, vi } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import {
	EMAIL_SEND_FAILED,
	clearEmailSendFailure,
	failedVerificationEmailHook,
	markEmailSendFailed,
} from "./email-failure.js";

// A real Better Auth instance on the in-memory adapter, wired the same way as
// better-auth.ts: the callback flags the request when sending fails, the after-hook turns
// the flag into an error response. This proves the failure reaches the client, which a
// mock of Better Auth could not.
function createAuth(send: () => Promise<void>) {
	const sendVerificationEmail = vi.fn(async ({ user }: { user: { email: string } }) => {
		try {
			await send();
			clearEmailSendFailure(user.email);
		} catch {
			markEmailSendFailed(user.email);
		}
	});
	const auth = betterAuth({
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		secret: "test-secret-test-secret-test-secret-0000",
		baseURL: "http://localhost:3000",
		emailAndPassword: { enabled: true, requireEmailVerification: true, autoSignIn: false },
		emailVerification: { sendVerificationEmail, sendOnSignUp: true },
		hooks: { after: failedVerificationEmailHook },
	});
	return { auth, sendVerificationEmail };
}

const post = (path: string, body: unknown) =>
	new Request(`http://localhost:3000/api/auth${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: "http://localhost:3000" },
		body: JSON.stringify(body),
	});

const signUpBody = { name: "Test User", email: "test@hirokata.dev", password: "correct horse battery" };

describe("failed verification emails", () => {
	it("sign-up succeeds when the email is sent", async () => {
		const { auth } = createAuth(async () => {});
		const res = await auth.handler(post("/sign-up/email", signUpBody));
		expect(res.status).toBe(200);
	});

	it("sign-up answers 502 EMAIL_SEND_FAILED when the email cannot be sent", async () => {
		const { auth, sendVerificationEmail } = createAuth(async () => {
			throw new Error("Resend rejected the email");
		});
		const res = await auth.handler(post("/sign-up/email", signUpBody));
		const body = (await res.json()) as { code?: string };

		expect(sendVerificationEmail).toHaveBeenCalledOnce();
		expect(res.status).toBe(502);
		expect(body.code).toBe(EMAIL_SEND_FAILED);
	});

	it("keeps the account after a failed send so the verification email can be re-requested", async () => {
		let failing = true;
		const { auth, sendVerificationEmail } = createAuth(async () => {
			if (failing) throw new Error("Resend rejected the email");
		});
		await auth.handler(post("/sign-up/email", signUpBody));

		// Signing up again is a conflict (the account exists), so the client must resend.
		failing = false;
		const resend = await auth.handler(
			post("/send-verification-email", { email: signUpBody.email, callbackURL: "/login?verified=true" }),
		);
		expect(resend.status).toBe(200);
		expect(sendVerificationEmail).toHaveBeenCalledTimes(2);
	});

	it("resending answers 502 EMAIL_SEND_FAILED while sending keeps failing", async () => {
		const { auth } = createAuth(async () => {
			throw new Error("Resend rejected the email");
		});
		await auth.handler(post("/sign-up/email", signUpBody));

		const res = await auth.handler(
			post("/send-verification-email", { email: signUpBody.email, callbackURL: "/login?verified=true" }),
		);
		const body = (await res.json()) as { code?: string };

		expect(res.status).toBe(502);
		expect(body.code).toBe(EMAIL_SEND_FAILED);
	});

	it("matches the address case-insensitively", async () => {
		const { auth } = createAuth(async () => {
			throw new Error("Resend rejected the email");
		});
		await auth.handler(post("/sign-up/email", signUpBody));

		// Sending failed for "test@hirokata.dev"; a resend typed with different casing is
		// the same address and must still report the failure.
		const res = await auth.handler(
			post("/send-verification-email", { email: "Test@Hirokata.dev", callbackURL: "/" }),
		);
		expect(res.status).toBe(502);
	});

	it("a successful send clears an earlier failure that was never reported", async () => {
		markEmailSendFailed(signUpBody.email);
		const { auth } = createAuth(async () => {});

		const res = await auth.handler(post("/sign-up/email", signUpBody));

		expect(res.status).toBe(200);
	});

	it("reports a failure only once", async () => {
		const { auth } = createAuth(async () => {
			throw new Error("Resend rejected the email");
		});
		const first = await auth.handler(post("/sign-up/email", signUpBody));
		expect(first.status).toBe(502);

		// Nothing is flagged for this address any more: a request that never reaches the
		// send callback (unknown address, so no email is attempted) answers normally.
		const res = await auth.handler(
			post("/send-verification-email", { email: "nobody@hirokata.dev", callbackURL: "/" }),
		);
		expect(res.status).toBe(200);
	});

	it("ignores a failure that is older than the expiry window", async () => {
		vi.useFakeTimers();
		try {
			markEmailSendFailed(signUpBody.email);
			vi.advanceTimersByTime(31_000);

			const { auth } = createAuth(async () => {});
			const res = await auth.handler(post("/sign-up/email", signUpBody));
			expect(res.status).toBe(200);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not flag one request because another one failed", async () => {
		let failing = true;
		const { auth } = createAuth(async () => {
			if (failing) throw new Error("Resend rejected the email");
		});
		const first = await auth.handler(post("/sign-up/email", signUpBody));
		failing = false;
		const second = await auth.handler(
			post("/send-verification-email", { email: signUpBody.email, callbackURL: "/login?verified=true" }),
		);

		expect(first.status).toBe(502);
		expect(second.status).toBe(200);
	});
});
