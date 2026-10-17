import * as Sentry from '@sentry/sveltekit';
import { authClient } from '$lib/auth-client';

/** Error code the API answers with when a verification email could not be sent. */
export const EMAIL_SEND_FAILED = 'EMAIL_SEND_FAILED';

/** Seconds the resend button stays disabled after an email went out. */
export const RESEND_COOLDOWN_SECONDS = 30;

export const SEND_FAILED_MESSAGE =
	"We couldn't send the verification email. Please try again in a moment.";
const GENERIC_ERROR = 'Something went wrong. Please try again.';

export type ResendResult = { ok: true } | { ok: false; message: string };

/** Ask the API to send the verification email again. Never throws. */
export async function resendVerificationEmail(email: string): Promise<ResendResult> {
	try {
		const { error } = await authClient.sendVerificationEmail({
			email: email.trim(),
			callbackURL: '/login?verified=true',
		});
		if (!error) return { ok: true };
		return {
			ok: false,
			message: error.code === EMAIL_SEND_FAILED ? SEND_FAILED_MESSAGE : GENERIC_ERROR,
		};
	} catch (err) {
		Sentry.captureException(err);
		return { ok: false, message: GENERIC_ERROR };
	}
}
