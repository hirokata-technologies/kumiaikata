// Imports a local guild warehouse (.guild/guild.db, the guild plugin's `backend: local`)
// into a Kumiai workspace, straight into DATABASE_URL (or export it as JSON for the
// `import_guild` MCP/REST tool):
//
//   pnpm guild:import <path/to/guild.db | project dir> --workspace <id|name> [--team <id>] [--create] [--dry-run]
//   pnpm guild:import <path/to/guild.db | project dir> --export board.json
//
// The target workspace must hold no guild data yet. Everything lands in one transaction.
// Plain ESM on purpose, like migrate.js: the importer itself is TypeScript that Node runs
// with its built-in type stripping, so there is no build step.
import { existsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import pg from "pg";
import {
	GuildImportError,
	importGuildDb,
	readSourceFile,
	sourceToJson,
} from "../src/guild/tursodb-import.ts";

const USAGE = `Usage: pnpm guild:import <guild.db | project dir> --workspace <id|name> [options]

  --workspace <id|name>  Target Kumiai workspace (required)
  --team <id>            Narrow a workspace name to one team; owns a workspace made with --create
  --create               Create the workspace (needs --team) when it does not exist
  --dry-run              Run the whole import, then roll it back
  --export <file>        Write the board as JSON (the \`source\` of the import_guild tool) and exit;
                         needs no database
  -h, --help             Show this help

DATABASE_URL is read from the environment (apps/web/.env is loaded by the pnpm script).`;

function fail(message) {
	console.error(`[guild:import] ${message}`);
	process.exit(1);
}

let args;
try {
	args = parseArgs({
		allowPositionals: true,
		options: {
			workspace: { type: "string" },
			team: { type: "string" },
			create: { type: "boolean", default: false },
			"dry-run": { type: "boolean", default: false },
			export: { type: "string" },
			help: { type: "boolean", short: "h", default: false },
		},
	});
} catch (err) {
	fail(`${err.message}\n\n${USAGE}`);
}

if (args.values.help) {
	console.log(USAGE);
	process.exit(0);
}
if (args.positionals.length !== 1) fail(`needs a source path\n\n${USAGE}`);
if (!args.values.export && !args.values.workspace) fail(`needs --workspace (or --export)\n\n${USAGE}`);
if (!args.values.export && !process.env.DATABASE_URL) fail("DATABASE_URL is not set");

/** A directory means "the guild in this project": <dir>/.guild/guild.db. */
function resolveSource(input) {
	const resolved = path.resolve(input);
	if (!existsSync(resolved)) fail(`${resolved} does not exist`);
	if (!statSync(resolved).isDirectory()) return resolved;
	for (const candidate of [path.join(resolved, ".guild", "guild.db"), path.join(resolved, "guild.db")]) {
		if (existsSync(candidate)) return candidate;
	}
	return fail(`no .guild/guild.db under ${resolved}`);
}

const sourcePath = resolveSource(args.positionals[0]);

if (args.values.export) {
	try {
		writeFileSync(args.values.export, JSON.stringify(sourceToJson(readSourceFile(sourcePath))));
	} catch (err) {
		if (err instanceof GuildImportError) fail(err.message);
		throw err;
	}
	console.log(`[guild:import] wrote ${args.values.export}`);
	process.exit(0);
}

const dryRun = args.values["dry-run"];
const target = new URL(process.env.DATABASE_URL);
console.log(`[guild:import] ${sourcePath}`);
console.log(`[guild:import] -> ${target.hostname}${target.pathname}, workspace "${args.values.workspace}"${dryRun ? " (dry run)" : ""}`);

// DATABASE_URL may use a Cloud SQL unix socket (`?host=/cloudsql/<connection-name>`).
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

try {
	const report = await importGuildDb(pool, {
		sourcePath,
		workspace: args.values.workspace,
		...(args.values.team ? { teamId: args.values.team } : {}),
		createWorkspace: args.values.create,
		dryRun,
		log: (message) => console.log(`[guild:import] ${message}`),
	});
	for (const [table, count] of Object.entries(report.counts)) console.log(`  ${table.padEnd(20)} ${count}`);
	for (const warning of report.warnings) console.warn(`[guild:import] warning: ${warning}`);
	console.log(
		dryRun
			? "[guild:import] dry run complete: nothing was written"
			: `[guild:import] imported into workspace "${report.workspaceName}" (${report.workspaceId})`,
	);
} catch (err) {
	if (err instanceof GuildImportError) fail(err.message);
	console.error(err);
	process.exitCode = 1;
} finally {
	await pool.end();
}
