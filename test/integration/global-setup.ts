import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COMPOSE_FILE = path.join(ROOT, "docker-compose.local.yml");
const APP_URL = "http://localhost:3000";
const WAIT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

async function waitForHealthy(url: string, label: string): Promise<void> {
	const deadline = Date.now() + WAIT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${url}/healthz`);
			if (res.ok) {
				console.log(`[integration] ${label} is healthy`);
				return;
			}
		} catch {
			// not ready yet
		}
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
	}
	throw new Error(
		`[integration] ${label} did not become healthy within ${WAIT_TIMEOUT_MS}ms`,
	);
}

export async function setup(): Promise<() => Promise<void>> {
	console.log("[integration] Starting docker-compose stack...");
	execSync(`docker compose -f ${COMPOSE_FILE} up --build -d`, {
		stdio: "inherit",
		cwd: ROOT,
	});

	await waitForHealthy(APP_URL, "kata-web");

	return async () => {
		console.log("[integration] Tearing down docker-compose stack...");
		execSync(`docker compose -f ${COMPOSE_FILE} down -v`, {
			stdio: "inherit",
			cwd: ROOT,
		});
	};
}

export default setup;
