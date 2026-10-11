// Local development Postgres: one named container with a named volume, no compose.
//
//   node scripts/dev-db.mjs up      start (or create) the container and wait until it accepts connections
//   node scripts/dev-db.mjs down    stop it; the data volume is kept
//   node scripts/dev-db.mjs reset   remove the container AND its data volume
//
// Credentials match apps/web/.env.example (postgresql://kata:kata@localhost:5432/kata).
// KATA_DB_PORT changes the published host port.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DB_CONTAINER = "kata-postgres";
export const DB_VOLUME = "kata_postgres_data";
export const DB_PORT = Number(process.env.KATA_DB_PORT ?? 5432);
const IMAGE = "postgres:18-alpine";

function docker(args, { allowFailure = false } = {}) {
	const result = spawnSync("docker", args, { encoding: "utf8" });
	if (result.error) {
		throw new Error(`Could not run docker (${result.error.message}). Is Docker installed and running?`);
	}
	if (result.status !== 0 && !allowFailure) {
		throw new Error(`docker ${args.join(" ")} failed:\n${result.stderr.trim()}`);
	}
	return result;
}

/** "running" | "stopped" | "missing" */
function state() {
	const result = docker(["inspect", "-f", "{{.State.Running}}", DB_CONTAINER], { allowFailure: true });
	if (result.status !== 0) return "missing";
	return result.stdout.trim() === "true" ? "running" : "stopped";
}

function isReady() {
	return (
		docker(["exec", DB_CONTAINER, "pg_isready", "-U", "kata", "-d", "kata"], { allowFailure: true })
			.status === 0
	);
}

export async function up() {
	const info = docker(["info", "--format", "{{.ServerVersion}}"], { allowFailure: true });
	if (info.status !== 0) {
		throw new Error("The Docker daemon is not running. Start Docker, then run this again.");
	}

	switch (state()) {
		case "running":
			break;
		case "stopped":
			docker(["start", DB_CONTAINER]);
			break;
		case "missing":
			docker([
				"run", "-d",
				"--name", DB_CONTAINER,
				"-p", `${DB_PORT}:5432`,
				"-e", "POSTGRES_USER=kata",
				"-e", "POSTGRES_PASSWORD=kata",
				"-e", "POSTGRES_DB=kata",
				// Postgres 18 keeps its data in a versioned subdirectory of /var/lib/postgresql.
				"-v", `${DB_VOLUME}:/var/lib/postgresql`,
				"--restart", "unless-stopped",
				IMAGE,
			]);
			break;
	}

	// pg_isready is true during the image's init phase too, so require two good checks.
	const deadline = Date.now() + 60_000;
	let ready = 0;
	while (Date.now() < deadline) {
		ready = isReady() ? ready + 1 : 0;
		if (ready >= 2) {
			console.log(`[db] ${DB_CONTAINER} is ready on localhost:${DB_PORT}`);
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	throw new Error(`${DB_CONTAINER} did not become ready within 60s (docker logs ${DB_CONTAINER})`);
}

export function down() {
	if (state() === "running") docker(["stop", DB_CONTAINER]);
	console.log(`[db] ${DB_CONTAINER} stopped (data kept in volume ${DB_VOLUME}; "pnpm db:reset" deletes it)`);
}

export function reset() {
	docker(["rm", "-f", "-v", DB_CONTAINER], { allowFailure: true });
	docker(["volume", "rm", DB_VOLUME], { allowFailure: true });
	console.log(`[db] removed ${DB_CONTAINER} and volume ${DB_VOLUME}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const commands = { up, down, reset };
	const command = commands[process.argv[2] ?? ""];
	if (!command) {
		console.error("usage: node scripts/dev-db.mjs <up|down|reset>");
		process.exit(2);
	}
	try {
		await command();
	} catch (err) {
		console.error(`[db] ${err instanceof Error ? err.message : err}`);
		process.exit(1);
	}
}
