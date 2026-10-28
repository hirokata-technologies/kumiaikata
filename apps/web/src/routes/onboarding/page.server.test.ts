import { describe, expect, it } from 'vitest';

const { load } = await import('./+page.server.js');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (user: unknown) => (load as any)({ locals: { user } });

describe('onboarding/+page.server.ts', () => {
	it('redirects 303 to /login when signed out', () => {
		expect(() => run(null)).toThrowError(expect.objectContaining({ status: 303, location: '/login' }));
	});

	it('redirects 303 to /roadmap when onboarding is already done', () => {
		expect(() => run({ id: 'u1', isOnboardingDone: true })).toThrowError(
			expect.objectContaining({ status: 303, location: '/roadmap' }),
		);
	});

	it('lets a user who has not finished onboarding through', () => {
		expect(() => run({ id: 'u1', isOnboardingDone: false })).not.toThrow();
	});
});
