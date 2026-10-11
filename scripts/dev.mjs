// `pnpm dev`: the whole local stack without compose.
//
//   1. loads apps/web/.env (real environment variables win)
//   2. starts the Postgres container (scripts/dev-db.mjs) when DATABASE_URL points at it
//   3. applies migrations (apps/api/migrate.js)
//   4. runs the SvelteKit dev server (pages and /api) on http://localhost:3000
//
// Only non-secret settings get defaults. Secrets that are not configured fall back to
// placeholders so the app still starts; Google sign-in and email need real values in
// apps/web/.env (see apps/web/.env.example).
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DB_PORT, up as dbUp } from "./dev-db.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, "apps/web/.env");
if (existsSync(envFile)) process.loadEnvFile(envFile); // never overrides variables already set

const port = Number(process.env.PORT ?? 3000);
const env = process.env;
env.DATABASE_URL ??= `postgresql://kata:kata@localhost:${DB_PORT}/kata`;
env.BETTER_AUTH_URL ??= `http://localhost:${port}`;
env.ALLOWED_DOMAINS ??= "hirokata.dev,localhost";
env.ATTACHMENTS_DIR ??= path.join(root, "apps/web/.attachments");

const placeholders = [];
for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "RESEND_API_KEY"]) {
	if (!env[key]) {
		env[key] = "dev-placeholder";
		placeholders.push(key);
	}
}
if (!env.BETTER_AUTH_SECRET) {
	env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex"); // sessions reset on restart
	placeholders.push("BETTER_AUTH_SECRET");
}
if (placeholders.length) {
	console.warn(`[dev] using placeholders for ${placeholders.join(", ")}; set them in apps/web/.env`);
}
if (new URL(env.BETTER_AUTH_URL).origin !== `http://localhost:${port}`) {
	console.warn(
		`[dev] BETTER_AUTH_URL is ${env.BETTER_AUTH_URL} but the dev server listens on http://localhost:${port}; sign-in will not work until they match`,
	);
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: "inherit", cwd: root, env, ...options });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
	const db = new URL(env.DATABASE_URL);
	if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(db.hostname) && Number(db.port || 5432) === DB_PORT) {
		await dbUp();
	}
} catch (err) {
	console.error(`[dev] ${err instanceof Error ? err.message : err}`);
	process.exit(1);
}

run("node", [path.join(root, "apps/api/migrate.js")]);

const server = spawn(
	"pnpm",
	["--filter", "@kata/web", "exec", "vite", "dev", "--port", String(port), "--strictPort"],
	{ stdio: "inherit", cwd: root, env },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
