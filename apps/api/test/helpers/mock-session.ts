/**
 * Auth test helpers.
 *
 * The actual vi.mock for better-auth and @kata/events is registered in
 * test/setup-mocks.ts (a vitest setupFile). It must live there so it is in
 * place before the test file's static imports resolve — vi.mock inside a
 * regular function cannot be hoisted past ESM import statements.
 *
 * These helpers only manipulate the shared state that the mock factory reads.
 */

export interface MockUser {
	id: string;
	email: string;
	name?: string;
}

declare global {
	// eslint-disable-next-line no-var
	var __kataTestUser: MockUser | null;
}

/**
 * No-op — kept for backward compatibility with existing test files that call
 * mockBetterAuth() at the top. The real mock is always active via setup-mocks.ts.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-function
export function mockBetterAuth(): void {}

/**
 * Set the user returned by the mocked auth.api.getSession().
 * Pass null to simulate an unauthenticated request (routes return 401).
 */
export function setCurrentUser(user: MockUser | null): void {
	globalThis.__kataTestUser = user;
}
