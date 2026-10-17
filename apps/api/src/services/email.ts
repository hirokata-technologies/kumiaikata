import { Resend } from "resend";
import { env } from "../env.js";

const resend = new Resend(env.RESEND_API_KEY);

const FROM = "Kata <noreply@hirokata.dev>";

/**
 * Send a transactional email via Resend.
 *
 * @param options.to      - Recipient email address
 * @param options.subject - Email subject line
 * @param options.html    - HTML body content
 * @throws                - Re-throws any Resend SDK error (network, rate limit, auth, etc.)
 */
export async function sendEmail(options: {
	to: string;
	subject: string;
	html: string;
}): Promise<void> {
	// The SDK resolves with `{ data, error }` for API-level failures (invalid key, unverified
	// sender domain, rate limit) instead of rejecting, so check `error` explicitly.
	const { error } = await resend.emails.send({
		from: FROM,
		to: options.to,
		subject: options.subject,
		html: options.html,
	});
	if (error) {
		throw new Error(`Resend rejected the email (${error.name}): ${error.message}`);
	}
}
