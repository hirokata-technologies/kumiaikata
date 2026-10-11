import { execFileSync, spawn, type ChildProcess } from "child_process";
import { randomBytes } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { API, PORT } from "./helpers.js";

// Compose-free stack: a throwaway Postgres container, the migrations, and the
// production build of the app (`node build`, as in the runtime image).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB_DIR = path.join(ROOT, "apps/web");
const DB_CONTAINER = "kata-it-postgres";
const DB_PORT = Number(process.env.KATA_IT_DB_PORT ?? 55432);
const DATABASE_URL = `postgresql://kata:kata@localhost:${DB_PORT}/kata_it`;
const WAIT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function docker(args: string[], options: { stdio?: "inherit" | "ignore" | "pipe" } = {}): string {
	return execFileSync("docker", args, { encoding: "utf8", stdio: "pipe", ...options }) ?? "";
}

function removeDatabase(): void {
	try {
		docker(["rm", "-f", "-v", DB_CONTAINER]);
	} catch {
		// not running
	}
}

async function startDatabase(): Promise<void> {
	removeDatabase(); // leftovers from an interrupted run
	docker([
		"run", "-d",
		"--name", DB_CONTAINER,
		"-p", `${DB_PORT}:5432`,
		"-e", "POSTGRES_USER=kata",
		"-e", "POSTGRES_PASSWORD=kata",
		"-e", "POSTGRES_DB=kata_it",
		"postgres:18-alpine",
	]);

	// pg_isready is also true during the image's init phase: require two good checks.
	const deadline = Date.now() + WAIT_TIMEOUT_MS;
	let good = 0;
	while (Date.now() < deadline) {
		try {
			docker(["exec", DB_CONTAINER, "pg_isready", "-U", "kata", "-d", "kata_it"]);
			good += 1;
		} catch {
			good = 0;
		}
		if (good >= 2) {
			console.log("[integration] postgres is ready");
			return;
		}
		await sleep(POLL_INTERVAL_MS);
	}
	throw new Error(`[integration] postgres did not become ready within ${WAIT_TIMEOUT_MS}ms`);
}

async function waitForHealthy(url: string, label: string, app: ChildProcess): Promise<void> {
	const deadline = Date.now() + WAIT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (app.exitCode !== null) {
			throw new Error(`[integration] ${label} exited with code ${app.exitCode} before it became healthy`);
		}
		try {
			const res = await fetch(`${url}/healthz`);
			if (res.ok) {
				console.log(`[integration] ${label} is healthy`);
				return;
			}
		} catch {
			// not ready yet
		}
		await sleep(POLL_INTERVAL_MS);
	}
	throw new Error(`[integration] ${label} did not become healthy within ${WAIT_TIMEOUT_MS}ms`);
}

export async function setup(): Promise<() => Promise<void>> {
	const env = {
		...process.env,
		NODE_ENV: "production",
		PORT: String(PORT),
		ORIGIN: API,
		DATABASE_URL,
		BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
		BETTER_AUTH_URL: API,
		GOOGLE_CLIENT_ID: "integration-test-client-id",
		GOOGLE_CLIENT_SECRET: "integration-test-client-secret",
		RESEND_API_KEY: "integration-test-resend-key",
		ALLOWED_DOMAINS: "hirokata.dev,localhost",
		ATTACHMENTS_DIR: path.join(ROOT, "apps/web/.vitest-attachments"),
		SHUTDOWN_TIMEOUT: "2",
	};
	// Never talk to a real Agent Runtime from tests: the agents routes answer 503.
	delete env.AGENT_RUNTIME_NAME;

	let app: ChildProcess | undefined;
	const teardown = async () => {
		console.log("[integration] Stopping app and database...");
		if (app && app.exitCode === null) {
			app.kill("SIGTERM");
			await Promise.race([new Promise((r) => app!.once("exit", r)), sleep(10_000)]);
			if (app.exitCode === null) app.kill("SIGKILL");
		}
		removeDatabase();
	};

	try {
		console.log("[integration] Starting postgres...");
		await startDatabase();

		console.log("[integration] Building the app...");
		execFileSync("pnpm", ["--filter", "@kata/web", "build"], { stdio: "inherit", cwd: ROOT, env });

		console.log("[integration] Applying migrations...");
		execFileSync("node", ["apps/api/migrate.js"], { stdio: "inherit", cwd: ROOT, env });

		console.log(`[integration] Starting the app on ${API}...`);
		app = spawn("node", ["build"], { stdio: "inherit", cwd: WEB_DIR, env });
		await waitForHealthy(API, "kata-web", app);
	} catch (err) {
		await teardown();
		throw err;
	}

	return teardown;
}

export default setup;
