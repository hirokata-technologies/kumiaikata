import { vi } from "vitest";

// ── Shared mock state ─────────────────────────────────────────────────────────
// globalThis allows the state to be shared between this setup file's mock
// factory closures and the setCurrentUser() helper in mock-session.ts.
// Each vitest worker gets its own globalThis, so tests are fully isolated.
declare global {
	// eslint-disable-next-line no-var
	var __kataTestUser: { id: string; email: string; name?: string } | null;
}
globalThis.__kataTestUser = null;

// ── better-auth mock ──────────────────────────────────────────────────────────
// Must be registered here (in a setupFile) so the mock is in place before the
// test file's static imports resolve. vi.mock inside mockBetterAuth() cannot
// be hoisted past ESM static imports, so the session check would use the real
// better-auth (which needs PostgreSQL) — causing 500s in auth-guarded routes.
vi.mock("../src/auth/better-auth.js", () => ({
	auth: {
		api: {
			getSession: vi.fn(async () => {
				const user = globalThis.__kataTestUser;
				if (!user) return null;
				return {
					user: { id: user.id, email: user.email, name: user.name ?? null },
					session: { id: "test-session" },
				};
			}),
		},
		handler: vi.fn(async () => new Response("not implemented", { status: 501 })),
	},
}));
