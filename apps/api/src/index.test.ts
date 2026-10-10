import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// index.ts runs main() at import time, so each test mocks its collaborators,
// resets the module registry and imports a fresh copy of index.ts together
// with a fresh readiness module (which starts NOT ready, like production).

const mocks = vi.hoisted(() => ({
	serve: vi.fn(),
	migrate: vi.fn(),
	poolQuery: vi.fn(),
	captureException: vi.fn(),
	flush: vi.fn(),
}));

const MOCKED_MODULES = [
	"./instrument.js",
	"@sentry/node",
	"@hono/node-server",
	"drizzle-orm/node-postgres/migrator",
	"@kata/db",
	"./app.js",
	"./env.js",
	"./storage/disk.js",
	"./storage/index.js",
];

// vi.doMock (not the hoisted vi.mock) so the mocks apply only inside this
// file's startServer() and are removed again afterwards. The shared DB setup
// file reaches the real env.ts and db client in its own afterEach hook.
function mockCollaborators(): void {
	vi.doMock("./instrument.js", () => ({}));
	vi.doMock("@sentry/node", () => ({
		captureException: mocks.captureException,
		flush: mocks.flush,
	}));
	vi.doMock("@hono/node-server", () => ({ serve: mocks.serve }));
	vi.doMock("drizzle-orm/node-postgres/migrator", () => ({
		migrate: mocks.migrate,
	}));
	vi.doMock("@kata/db", () => ({
		db: {},
		pool: { query: mocks.poolQuery },
	}));
	vi.doMock("./app.js", () => ({ app: { fetch: vi.fn() } }));
	vi.doMock("./env.js", () => ({
		env: { PORT: 8787, ATTACHMENTS_DIR: "/tmp/attachments" },
	}));
	vi.doMock("./storage/disk.js", () => ({ cleanStaleTempFiles: vi.fn() }));
	vi.doMock("./storage/index.js", () => ({
		storage: {},
		DiskStorage: class DiskStorage {},
	}));
}

function deferred(): {
	promise: Promise<void>;
	resolve: () => void;
	reject: (err: unknown) => void;
} {
	let resolve!: () => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

async function startServer(): Promise<{ isReady: () => boolean }> {
	vi.resetModules();
	mockCollaborators();
	const readiness = await import("./readiness.js");
	await import("./index.js");
	return { isReady: readiness.isReady };
}

describe("index.ts startup order", () => {
	let exit: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.poolQuery.mockResolvedValue({ rows: [] });
		mocks.flush.mockResolvedValue(true);
		// Keep import-time signal handlers and exit calls from touching the runner.
		exit = vi
			.spyOn(process, "exit")
			.mockImplementation((() => undefined) as never);
		vi.spyOn(process, "on").mockImplementation((() => process) as never);
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		for (const id of MOCKED_MODULES) vi.doUnmock(id);
		vi.resetModules();
	});

	it("binds the port before migrate() and stays not ready until it resolves", async () => {
		const migration = deferred();
		mocks.migrate.mockReturnValue(migration.promise);

		const { isReady } = await startServer();

		expect(mocks.serve).toHaveBeenCalledTimes(1);
		expect(mocks.migrate).toHaveBeenCalledTimes(1);
		expect(mocks.serve.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.migrate.mock.invocationCallOrder[0]!,
		);
		// migrate() is still pending: the gate must still refuse requests.
		expect(isReady()).toBe(false);
		expect(mocks.poolQuery).not.toHaveBeenCalled();

		migration.resolve();
		await vi.waitFor(() => {
			expect(isReady()).toBe(true);
		});
		expect(exit).not.toHaveBeenCalled();
	});

	it("marks ready as soon as migrate() resolves, before the pool smoke test finishes", async () => {
		const smokeTest = deferred();
		mocks.migrate.mockResolvedValue(undefined);
		mocks.poolQuery.mockReturnValue(smokeTest.promise);

		const { isReady } = await startServer();

		await vi.waitFor(() => {
			expect(mocks.poolQuery).toHaveBeenCalledWith("select 1");
		});
		// The smoke test is still pending, yet the gate is already open.
		expect(isReady()).toBe(true);
		expect(console.log).not.toHaveBeenCalledWith("[db] connected");
		expect(exit).not.toHaveBeenCalled();

		// Let the smoke test finish and wait until startup has run past it, so
		// the exit assertion can see a late exit(1) rather than racing it.
		smokeTest.resolve();
		await vi.waitFor(() => {
			expect(console.log).toHaveBeenCalledWith("[db] connected");
		});
		expect(isReady()).toBe(true);
		expect(exit).not.toHaveBeenCalled();
		expect(mocks.captureException).not.toHaveBeenCalled();
	});

	it("never marks ready and exits non-zero when migrate() rejects", async () => {
		const failure = new Error("migration exploded");
		mocks.migrate.mockRejectedValue(failure);

		const { isReady } = await startServer();

		await vi.waitFor(() => {
			expect(exit).toHaveBeenCalledWith(1);
		});
		expect(mocks.captureException).toHaveBeenCalledWith(failure);
		expect(mocks.flush).toHaveBeenCalled();
		expect(isReady()).toBe(false);
		expect(mocks.poolQuery).not.toHaveBeenCalled();
	});

	it("exits non-zero when the post-migration smoke test fails, after marking ready", async () => {
		const failure = new Error("connection refused");
		mocks.migrate.mockResolvedValue(undefined);
		mocks.poolQuery.mockRejectedValue(failure);

		const { isReady } = await startServer();

		await vi.waitFor(() => {
			expect(exit).toHaveBeenCalledWith(1);
		});
		expect(mocks.captureException).toHaveBeenCalledWith(failure);
		expect(isReady()).toBe(true);
	});
});
