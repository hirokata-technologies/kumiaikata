import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendVerificationEmail, captureException } = vi.hoisted(() => ({
	sendVerificationEmail: vi.fn(),
	captureException: vi.fn(),
}));

vi.mock('$lib/auth-client', () => ({ authClient: { sendVerificationEmail } }));
vi.mock('@sentry/sveltekit', () => ({ captureException }));

import {
	EMAIL_SEND_FAILED,
	SEND_FAILED_MESSAGE,
	resendVerificationEmail,
} from './resend-verification';

describe('resendVerificationEmail', () => {
	beforeEach(() => vi.clearAllMocks());

	it('requests a new email for the trimmed address and lands on the verified banner', async () => {
		sendVerificationEmail.mockResolvedValueOnce({ data: { status: true }, error: null });

		const result = await resendVerificationEmail('  user@hirokata.dev ');

		expect(result).toEqual({ ok: true });
		expect(sendVerificationEmail).toHaveBeenCalledWith({
			email: 'user@hirokata.dev',
			callbackURL: '/login?verified=true',
		});
	});

	it('explains that the email could not be sent when the API answers EMAIL_SEND_FAILED', async () => {
		sendVerificationEmail.mockResolvedValueOnce({ data: null, error: { code: EMAIL_SEND_FAILED } });

		expect(await resendVerificationEmail('user@hirokata.dev')).toEqual({
			ok: false,
			message: SEND_FAILED_MESSAGE,
		});
	});

	it('falls back to a generic message for any other API error', async () => {
		sendVerificationEmail.mockResolvedValueOnce({ data: null, error: { code: 'TOO_MANY_REQUESTS' } });

		const result = await resendVerificationEmail('user@hirokata.dev');

		expect(result).toEqual({ ok: false, message: 'Something went wrong. Please try again.' });
	});

	it('reports network failures to Sentry instead of throwing', async () => {
		const failure = new Error('network down');
		sendVerificationEmail.mockRejectedValueOnce(failure);

		const result = await resendVerificationEmail('user@hirokata.dev');

		expect(result.ok).toBe(false);
		expect(captureException).toHaveBeenCalledWith(failure);
	});
});
