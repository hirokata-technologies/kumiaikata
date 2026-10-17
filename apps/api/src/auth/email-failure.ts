import { APIError, createAuthMiddleware } from "better-auth/api";

/** Error code the client receives when a verification email could not be sent. */
export const EMAIL_SEND_FAILED = "EMAIL_SEND_FAILED";

// Better Auth runs `sendVerificationEmail` through `runInBackgroundOrAwait`, which catches
// and logs anything the callback throws, so the endpoint would answer 200 even though no
// email went out. The callback records the failure here instead, and the after-hook below
// turns it into an error response.
//
// Failures are keyed by email address rather than by request: the callback receives the
// original request from some endpoints and a clone from others (sign-up), so request
// identity does not line up with the hook's. A failure is consumed by the first matching
// response and expires after a few seconds, which is far longer than the callback takes
// to run before the hook fires.
const FAILURE_TTL_MS = 30_000;
const failedEmails = new Map<string, number>();

const keyOf = (email: string) => email.trim().toLowerCase();

export function markEmailSendFailed(email: string): void {
	const now = Date.now();
	for (const [key, failedAt] of failedEmails) {
		if (now - failedAt > FAILURE_TTL_MS) failedEmails.delete(key);
	}
	failedEmails.set(keyOf(email), now);
}

/** A successful send supersedes any earlier failure that was never reported. */
export function clearEmailSendFailure(email: string): void {
	failedEmails.delete(keyOf(email));
}

function takeEmailSendFailure(email: unknown): boolean {
	if (typeof email !== "string") return false;
	const key = keyOf(email);
	const failedAt = failedEmails.get(key);
	if (failedAt === undefined) return false;
	failedEmails.delete(key);
	return Date.now() - failedAt <= FAILURE_TTL_MS;
}

// Endpoints whose whole point is to send a verification email. Sign-in also sends one for
// unverified users when `sendOnSignIn` is enabled, but it already answers EMAIL_NOT_VERIFIED.
const VERIFICATION_ENDPOINTS = new Set(["/sign-up/email", "/send-verification-email"]);

export const failedVerificationEmailHook = createAuthMiddleware(async (ctx) => {
	if (!VERIFICATION_ENDPOINTS.has(ctx.path)) return;
	const body = ctx.body as { email?: unknown } | undefined;
	if (!takeEmailSendFailure(body?.email)) return;
	throw new APIError("BAD_GATEWAY", {
		code: EMAIL_SEND_FAILED,
		message: "We couldn't send the verification email.",
	});
});
