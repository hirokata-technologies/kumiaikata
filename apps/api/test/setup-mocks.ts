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

// ── @kata/events mock ─────────────────────────────────────────────────────────
// Replaces the RedisEventBus singleton with an in-process EventEmitter so that
// importing services (cards, columns, etc.) never triggers an ioredis connection
// attempt. Without this, tests crash with "[ioredis] Unhandled error event"
// whenever Valkey/Redis is not running locally.
vi.mock("@kata/events", () => {
	const listeners = new Map<string, Set<(e: unknown) => void>>();
	return {
		eventBus: {
			emit(event: { boardId: string }) {
				const set = listeners.get(event.boardId);
				if (set) set.forEach((l) => l(event));
			},
			subscribe(boardId: string, listener: (e: unknown) => void): () => void {
				if (!listeners.has(boardId)) listeners.set(boardId, new Set());
				listeners.get(boardId)!.add(listener);
				return () => {
					listeners.get(boardId)?.delete(listener);
				};
			},
		},
	};
});
