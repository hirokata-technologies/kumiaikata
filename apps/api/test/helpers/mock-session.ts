import { vi } from "vitest";

export interface MockUser {
	id: string;
	email: string;
	name?: string;
}

// Module-level holder for the current test user.
// Written by setCurrentUser(), read by the mocked getSession().
let currentUser: MockUser | null = null;

/**
 * Set up vi.mock for apps/api/src/auth/better-auth.ts.
 *
 * Call this at the top of any test file that imports `app` so that
 * `auth.api.getSession` is intercepted before the module graph loads.
 *
 * The mock returns:
 *  - null            when no user is set → routes return 401
 *  - { user, session } when setCurrentUser() has been called
 */
export function mockBetterAuth(): void {
	vi.mock("../../src/auth/better-auth.js", () => ({
		auth: {
			api: {
				getSession: vi.fn(async () => {
					if (!currentUser) return null;
					return {
						user: {
							id: currentUser.id,
							email: currentUser.email,
							name: currentUser.name ?? null,
						},
						session: { id: "test-session" },
					};
				}),
			},
			handler: vi.fn(async () => new Response("not implemented", { status: 501 })),
		},
	}));
}

/**
 * Drive the mocked getSession for the current test.
 * Pass null to simulate an unauthenticated request (→ 401).
 */
export function setCurrentUser(user: MockUser | null): void {
	currentUser = user;
}
