// Unit tests for the sign-out logic implemented in MeMenu.svelte.
//
// MeMenu.svelte uses Svelte 5 $state reactivity and imports $app/navigation and
// $lib/auth-client — neither of which is resolvable in the node test environment.
// These tests therefore extract the same algorithm into a plain async function
// with injectable dependencies (authClient and goto) and exercise all branches
// described by REQ-001.
//
// The algorithm under test mirrors the `signOut()` function in MeMenu.svelte
// exactly:
//
//   async function signOut() {
//     if (isSigningOut) return;
//     isSigningOut = true;
//     signOutError = null;
//     try {
//       const result = await authClient.signOut();
//       if (result?.error) {
//         signOutError = 'Could not sign out. Please try again.';
//         return;
//       }
//       await goto('/login');
//     } catch {
//       signOutError = 'Could not sign out. Please try again.';
//     } finally {
//       isSigningOut = false;
//     }
//   }

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Testable extraction of the sign-out algorithm
// ---------------------------------------------------------------------------

interface SignOutDeps {
	authClientSignOut: () => Promise<{ data: unknown; error: unknown } | null | undefined>;
	goto: (path: string) => Promise<void>;
}

interface SignOutState {
	isSigningOut: boolean;
	signOutError: string | null;
}

async function runSignOut(deps: SignOutDeps, state: SignOutState): Promise<void> {
	if (state.isSigningOut) return;
	state.isSigningOut = true;
	state.signOutError = null;
	try {
		const result = await deps.authClientSignOut();
		if (result?.error) {
			state.signOutError = 'Could not sign out. Please try again.';
			return;
		}
		await deps.goto('/login');
	} catch {
		state.signOutError = 'Could not sign out. Please try again.';
	} finally {
		state.isSigningOut = false;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<SignOutState> = {}): SignOutState {
	return { isSigningOut: false, signOutError: null, ...overrides };
}

// ---------------------------------------------------------------------------
// US-1: Successful sign-out
// ---------------------------------------------------------------------------

describe('signOut — successful sign-out (US-1)', () => {
	let authClientSignOut: ReturnType<typeof vi.fn<SignOutDeps['authClientSignOut']>>;
	let goto: ReturnType<typeof vi.fn<SignOutDeps['goto']>>;

	beforeEach(() => {
		authClientSignOut = vi
			.fn<SignOutDeps['authClientSignOut']>()
			.mockResolvedValue({ data: {}, error: null });
		goto = vi.fn<SignOutDeps['goto']>().mockResolvedValue(undefined);
	});

	it('calls authClient.signOut() when invoked (AC-1)', async () => {
		const state = makeState();
		await runSignOut({ authClientSignOut, goto }, state);
		expect(authClientSignOut).toHaveBeenCalledOnce();
	});

	it('navigates to /login after a successful sign-out (AC-2)', async () => {
		const state = makeState();
		await runSignOut({ authClientSignOut, goto }, state);
		expect(goto).toHaveBeenCalledOnce();
		expect(goto).toHaveBeenCalledWith('/login');
	});

	it('sets isSigningOut to false after success (finally block)', async () => {
		const state = makeState();
		await runSignOut({ authClientSignOut, goto }, state);
		expect(state.isSigningOut).toBe(false);
	});

	it('leaves signOutError as null after success', async () => {
		const state = makeState();
		await runSignOut({ authClientSignOut, goto }, state);
		expect(state.signOutError).toBeNull();
	});

	it('also navigates to /login when authClient.signOut() resolves with null', async () => {
		// better-auth may return null on some code paths — treat as success (no error property)
		authClientSignOut.mockResolvedValue(null);
		const state = makeState();
		await runSignOut({ authClientSignOut, goto }, state);
		expect(goto).toHaveBeenCalledWith('/login');
	});

	it('also navigates to /login when authClient.signOut() resolves with undefined', async () => {
		authClientSignOut.mockResolvedValue(undefined);
		const state = makeState();
		await runSignOut({ authClientSignOut, goto }, state);
		expect(goto).toHaveBeenCalledWith('/login');
	});
});

// ---------------------------------------------------------------------------
// US-2: Failed sign-out — error returned in result object
// ---------------------------------------------------------------------------

describe('signOut — failed sign-out via result.error (US-2)', () => {
	let authClientSignOut: ReturnType<typeof vi.fn<SignOutDeps['authClientSignOut']>>;
	let goto: ReturnType<typeof vi.fn<SignOutDeps['goto']>>;

	beforeEach(() => {
		authClientSignOut = vi.fn<SignOutDeps['authClientSignOut']>().mockResolvedValue({
			data: null,
			error: { message: 'Unauthorized', status: 401 },
		});
		goto = vi.fn<SignOutDeps['goto']>().mockResolvedValue(undefined);
	});

	it('sets signOutError to the expected message when result.error is truthy (AC-1)', async () => {
		const state = makeState();
		await runSignOut({ authClientSignOut, goto }, state);
		expect(state.signOutError).toBe('Could not sign out. Please try again.');
	});

	it('does NOT call goto when sign-out fails (AC-2 — user stays on the page)', async () => {
		const state = makeState();
		await runSignOut({ authClientSignOut, goto }, state);
		expect(goto).not.toHaveBeenCalled();
	});

	it('resets isSigningOut to false even when an error is returned (finally block)', async () => {
		const state = makeState();
		await runSignOut({ authClientSignOut, goto }, state);
		expect(state.isSigningOut).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// US-2: Failed sign-out — thrown exception (network error, timeout)
// ---------------------------------------------------------------------------

describe('signOut — failed sign-out via thrown exception (US-2 AC-1 edge)', () => {
	let authClientSignOut: ReturnType<typeof vi.fn<SignOutDeps['authClientSignOut']>>;
	let goto: ReturnType<typeof vi.fn<SignOutDeps['goto']>>;

	beforeEach(() => {
		authClientSignOut = vi
			.fn<SignOutDeps['authClientSignOut']>()
			.mockRejectedValue(new Error('Network failure'));
		goto = vi.fn<SignOutDeps['goto']>().mockResolvedValue(undefined);
	});

	it('sets signOutError when authClient.signOut() throws', async () => {
		const state = makeState();
		await runSignOut({ authClientSignOut, goto }, state);
		expect(state.signOutError).toBe('Could not sign out. Please try again.');
	});

	it('does NOT call goto when sign-out throws', async () => {
		const state = makeState();
		await runSignOut({ authClientSignOut, goto }, state);
		expect(goto).not.toHaveBeenCalled();
	});

	it('resets isSigningOut to false even when the call throws', async () => {
		const state = makeState();
		await runSignOut({ authClientSignOut, goto }, state);
		expect(state.isSigningOut).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// US-2: Duplicate-submit prevention (isSigningOut guard / slow-network edge)
// ---------------------------------------------------------------------------

describe('signOut — duplicate-submit prevention (US-2 slow-network edge)', () => {
	it('returns immediately without calling authClient when isSigningOut is already true', async () => {
		const authClientSignOut = vi.fn().mockResolvedValue({ data: {}, error: null });
		const goto = vi.fn().mockResolvedValue(undefined);
		const state = makeState({ isSigningOut: true });

		await runSignOut({ authClientSignOut, goto }, state);

		expect(authClientSignOut).not.toHaveBeenCalled();
		expect(goto).not.toHaveBeenCalled();
	});

	it('does not mutate isSigningOut or signOutError when already in-progress', async () => {
		const authClientSignOut = vi.fn().mockResolvedValue({ data: {}, error: null });
		const goto = vi.fn().mockResolvedValue(undefined);
		// Simulate state mid-flight: isSigningOut=true, pre-existing error cleared
		const state = makeState({ isSigningOut: true, signOutError: null });

		await runSignOut({ authClientSignOut, goto }, state);

		// State must be unchanged
		expect(state.isSigningOut).toBe(true);
		expect(state.signOutError).toBeNull();
	});

	it('allows a second call once the first completes and isSigningOut resets to false', async () => {
		const authClientSignOut = vi.fn().mockResolvedValue({ data: {}, error: null });
		const goto = vi.fn().mockResolvedValue(undefined);
		const state = makeState();

		// First call
		await runSignOut({ authClientSignOut, goto }, state);
		expect(authClientSignOut).toHaveBeenCalledOnce();

		// After completion isSigningOut must be false, so a second call proceeds
		expect(state.isSigningOut).toBe(false);
		await runSignOut({ authClientSignOut, goto }, state);
		expect(authClientSignOut).toHaveBeenCalledTimes(2);
	});
});

// ---------------------------------------------------------------------------
// US-2: Retry — clicking "Sign out" again clears the error and retries (AC-4)
// ---------------------------------------------------------------------------

describe('signOut — retry after failure clears error and re-attempts (US-2 AC-4)', () => {
	it('clears signOutError at the start of a retry attempt', async () => {
		// First call: fail
		const authClientSignOut = vi
			.fn()
			.mockResolvedValueOnce({ data: null, error: { message: 'Server error' } })
			// Second call: succeed
			.mockResolvedValueOnce({ data: {}, error: null });
		const goto = vi.fn().mockResolvedValue(undefined);
		const state = makeState();

		// First attempt — sets the error
		await runSignOut({ authClientSignOut, goto }, state);
		expect(state.signOutError).toBe('Could not sign out. Please try again.');

		// Second attempt — error must be cleared at entry, then succeed
		await runSignOut({ authClientSignOut, goto }, state);
		expect(state.signOutError).toBeNull();
		expect(goto).toHaveBeenCalledWith('/login');
	});

	it('calls authClient.signOut() again on retry', async () => {
		const authClientSignOut = vi
			.fn()
			.mockResolvedValueOnce({ data: null, error: { message: 'Server error' } })
			.mockResolvedValueOnce({ data: {}, error: null });
		const goto = vi.fn().mockResolvedValue(undefined);
		const state = makeState();

		await runSignOut({ authClientSignOut, goto }, state);
		await runSignOut({ authClientSignOut, goto }, state);

		expect(authClientSignOut).toHaveBeenCalledTimes(2);
	});

	it('does not navigate on first (failed) attempt but does navigate on retry (success)', async () => {
		const authClientSignOut = vi
			.fn()
			.mockResolvedValueOnce({ data: null, error: { message: 'Server error' } })
			.mockResolvedValueOnce({ data: {}, error: null });
		const goto = vi.fn().mockResolvedValue(undefined);
		const state = makeState();

		await runSignOut({ authClientSignOut, goto }, state);
		expect(goto).not.toHaveBeenCalled();

		await runSignOut({ authClientSignOut, goto }, state);
		expect(goto).toHaveBeenCalledOnce();
		expect(goto).toHaveBeenCalledWith('/login');
	});
});

// ---------------------------------------------------------------------------
// Source markup audit — structural properties of MeMenu.svelte
// ---------------------------------------------------------------------------

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const meMenuSource = readFileSync(resolve(__dirname, 'MeMenu.svelte'), 'utf-8');

describe('MeMenu.svelte — sign-out markup structure', () => {
	it('imports goto from $app/navigation', () => {
		expect(meMenuSource).toContain("from '$app/navigation'");
		expect(meMenuSource).toContain('goto');
	});

	it('imports authClient from $lib/auth-client', () => {
		expect(meMenuSource).toContain("from '$lib/auth-client'");
		expect(meMenuSource).toContain('authClient');
	});

	it('declares isSigningOut state', () => {
		expect(meMenuSource).toContain('isSigningOut');
	});

	it('declares signOutError state', () => {
		expect(meMenuSource).toContain('signOutError');
	});

	it('calls authClient.signOut() inside the signOut function', () => {
		expect(meMenuSource).toContain('authClient.signOut()');
	});

	it('calls goto with /login on success', () => {
		expect(meMenuSource).toContain("goto('/login')");
	});

	it('sign-out button has disabled attribute bound to isSigningOut (AC-slow-network guard)', () => {
		expect(meMenuSource).toContain('disabled={isSigningOut}');
	});

	it('renders a role="alert" element for inline sign-out errors (US-2 AC-1)', () => {
		expect(meMenuSource).toContain('role="alert"');
	});

	it('conditionally renders the error element only when signOutError is set (US-2 AC-1)', () => {
		// {#if signOutError} block must be present
		expect(meMenuSource).toContain('{#if signOutError}');
	});

	it('sign-out button is not an anchor element — uses <button> (US-2 slow-network edge)', () => {
		// The sign-out action must be a button (can be disabled), not an <a>
		expect(meMenuSource).not.toContain('href="/login"');
	});

	it('shows a loading label while signing out', () => {
		expect(meMenuSource).toContain('Signing out');
	});
});
