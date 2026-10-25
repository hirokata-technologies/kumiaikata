import { DatabaseSync } from "node:sqlite";
import { nanoid } from "nanoid";
import type { Pool, PoolClient } from "pg";

/**
 * Imports a local guild warehouse (`.guild/guild.db`, written by the guild plugin's
 * `backend: local` through tursodb) into one Kumiai workspace.
 *
 * The file is plain SQLite, so it is read with node:sqlite and nothing else. Every guild
 * key (`GOAL-001`, `REQ-004/implement.TASK-011`, doc slugs, coverage ids) is kept as it is;
 * internal ids are new; integer ids (findings, work log, edges, events) are renumbered
 * because Kumiai's are unique across all workspaces.
 *
 * The importer writes through the warehouse's own triggers (scope, keys, CHECKs), then
 * replaces the events those triggers wrote with the source's, so the feed reads as it did
 * locally. It refuses a workspace that already holds guild data, and runs in one
 * transaction: all of it lands or none of it does.
 *
 * Kept erasable-only TypeScript (no enums, no parameter properties) with no local imports,
 * so `scripts/import-guild.mjs` can run it with Node's built-in type stripping.
 */

/** The guild `schema.sql` version this reads (`schema_version.version`). */
export const SUPPORTED_SCHEMA_VERSION = 9;

export class GuildImportError extends Error {
	/** True when the input is fine but the target is not (a workspace that already has data). */
	readonly conflict: boolean;

	constructor(message: string, conflict = false) {
		super(message);
		this.name = "GuildImportError";
		this.conflict = conflict;
	}
}

export interface ImportOptions {
	/** Target workspace: its id, or its exact name. */
	workspace: string;
	/** Narrows a workspace name to one team, and owns a workspace created with `createWorkspace`. */
	teamId?: string;
	/** Create the workspace (by name, in `teamId`) when it does not exist. */
	createWorkspace?: boolean;
	/** Do everything, then roll back. */
	dryRun?: boolean;
	/** Guild member name the triggers attribute to before their events are replaced. */
	actor?: string;
	log?: (message: string) => void;
}

export interface ImportReport {
	workspaceId: string;
	workspaceName: string;
	teamId: string;
	workspaceCreated: boolean;
	dryRun: boolean;
	/** Rows written per guild table (`goal`, `task`, `event`, …). */
	counts: Record<string, number>;
	warnings: string[];
}

type Row = Record<string, unknown>;

/** Everything in the source file, read up front so nothing touches Postgres if it is unreadable. */
export interface GuildSource {
	goal: Row[];
	project: Row[];
	requirement: Row[];
	plan: Row[];
	task: Row[];
	task_dependency: Row[];
	task_capability: Row[];
	graph_node: Row[];
	graph_edge: Row[];
	graph_deviation: Row[];
	gate: Row[];
	work_log: Row[];
	review_finding: Row[];
	bug: Row[];
	coverage: Row[];
	inspection: Row[];
	inspection_coverage: Row[];
	doc: Row[];
	doc_revision: Row[];
	knowledge_edge: Row[];
	event: Row[];
	guild_state: Row[];
}

/** Source table → the order it is read in (parents before children, integer ids ascending). */
const READ_ORDER: Record<keyof GuildSource, string> = {
	goal: "id",
	project: "id",
	requirement: "id",
	plan: "id",
	task: "id",
	task_dependency: "task_id, depends_on",
	task_capability: "task_id, capability",
	graph_node: "id",
	graph_edge: "from_node, to_node",
	graph_deviation: "id",
	gate: "node_id",
	work_log: "id",
	review_finding: "id",
	bug: "id",
	coverage: "id",
	inspection: "id",
	inspection_coverage: "inspection_id, coverage_id",
	doc: "slug",
	doc_revision: "id",
	knowledge_edge: "id",
	event: "id",
	guild_state: "key",
};

/** The tables of a guild.db that are imported, and so the keys of {@link GuildSource}. */
export const GUILD_SOURCE_TABLES = Object.keys(READ_ORDER) as (keyof GuildSource)[];

/** Source table → Kumiai table, for the row-count check. */
const TARGET_TABLE: Record<keyof GuildSource, string | null> = {
	goal: "kumiai_goals",
	project: "kumiai_projects",
	requirement: "kumiai_requirements",
	plan: "kumiai_plans",
	task: "kumiai_tasks",
	task_dependency: "kumiai_task_dependency",
	task_capability: "kumiai_task_capability",
	graph_node: "kumiai_graph_node",
	graph_edge: "kumiai_graph_edge",
	graph_deviation: "kumiai_graph_deviation",
	gate: "kumiai_gate",
	work_log: "kumiai_work_log",
	review_finding: "kumiai_review_finding",
	bug: "kumiai_bug",
	coverage: "kumiai_coverage",
	inspection: "kumiai_inspection",
	inspection_coverage: "kumiai_inspection_coverage",
	doc: "kumiai_doc",
	doc_revision: "kumiai_doc_revision",
	knowledge_edge: "kumiai_knowledge_edge",
	event: "kumiai_event",
	// Seeded per workspace by a trigger and merged, not counted one for one.
	guild_state: null,
};

/** Tables that must be empty (in the target workspace) before an import. */
const EMPTY_BEFORE = Object.values(TARGET_TABLE).filter((t): t is string => t !== null);

const GUILD_PRIORITY_TO_KUMIAI = ["urgent", "urgent", "high", "medium", "low", "low"] as const;

// ── reading the source ───────────────────────────────────────────────────────────────

/** Reads every guild table out of an open SQLite handle. Throws if it is not a supported guild.db. */
export function loadSource(db: DatabaseSync): GuildSource {
	let version: unknown;
	try {
		version = (db.prepare("SELECT version FROM schema_version WHERE id = 1").get() as Row | undefined)?.["version"];
	} catch {
		throw new GuildImportError("not a guild database: no schema_version table");
	}
	if (version !== SUPPORTED_SCHEMA_VERSION) {
		throw new GuildImportError(
			`unsupported guild schema version ${String(version)} (this importer reads version ${SUPPORTED_SCHEMA_VERSION})`,
		);
	}
	const source = {} as GuildSource;
	for (const [table, order] of Object.entries(READ_ORDER) as [keyof GuildSource, string][]) {
		source[table] = db.prepare(`SELECT * FROM "${table}" ORDER BY ${order}`).all() as Row[];
	}
	return source;
}

/**
 * The wire form of a source (what the `import_guild` tool takes): `schema_version` plus one
 * array of row objects per table, as read from the file. A table left out is empty.
 */
export function sourceFromJson(value: unknown): GuildSource {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new GuildImportError("source must be an object");
	}
	const input = value as Record<string, unknown>;
	if (input["schema_version"] !== SUPPORTED_SCHEMA_VERSION) {
		throw new GuildImportError(
			`unsupported guild schema version ${String(input["schema_version"])} (this importer reads version ${SUPPORTED_SCHEMA_VERSION})`,
		);
	}
	const unknown = Object.keys(input).filter((k) => k !== "schema_version" && !GUILD_SOURCE_TABLES.includes(k as keyof GuildSource));
	if (unknown.length > 0) throw new GuildImportError(`unknown table(s) in source: ${unknown.join(", ")}`);
	const source = {} as GuildSource;
	for (const table of GUILD_SOURCE_TABLES) {
		const rows = input[table] ?? [];
		if (!Array.isArray(rows) || rows.some((r) => typeof r !== "object" || r === null || Array.isArray(r))) {
			throw new GuildImportError(`${table} must be an array of row objects`);
		}
		source[table] = rows as Row[];
	}
	return source;
}

/** A source in its wire form, for {@link sourceFromJson}. */
export function sourceToJson(source: GuildSource): Record<string, unknown> {
	return { schema_version: SUPPORTED_SCHEMA_VERSION, ...source };
}

/** Opens a guild.db read-only and reads it. */
export function readSourceFile(sourcePath: string): GuildSource {
	let db: DatabaseSync;
	try {
		db = new DatabaseSync(sourcePath, { readOnly: true });
	} catch (err) {
		throw new GuildImportError(`cannot open ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`);
	}
	try {
		return loadSource(db);
	} finally {
		db.close();
	}
}

// ── row accessors ────────────────────────────────────────────────────────────────────

function describe(value: unknown): string {
	return value === null ? "NULL" : typeof value;
}

function text(row: Row, column: string): string {
	const value = row[column];
	if (typeof value !== "string") throw new GuildImportError(`expected text in ${column}, got ${describe(value)}`);
	return value;
}

function textOrNull(row: Row, column: string): string | null {
	const value = row[column];
	if (value === null || value === undefined) return null;
	return text(row, column);
}

function int(row: Row, column: string): number {
	const value = row[column];
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw new GuildImportError(`expected integer in ${column}, got ${describe(value)}`);
	}
	return value;
}

function intOrNull(row: Row, column: string): number | null {
	const value = row[column];
	if (value === null || value === undefined) return null;
	return int(row, column);
}

/** A guild timestamp (`2026-10-23T05:43:58Z`, offset optional, UTC when absent) as UTC wall clock. */
function ts(value: unknown, what: string): string {
	if (typeof value !== "string") throw new GuildImportError(`${what}: expected a timestamp, got ${describe(value)}`);
	const withZone = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
	const date = new Date(withZone);
	if (Number.isNaN(date.getTime())) throw new GuildImportError(`${what}: not a timestamp: ${value}`);
	return date.toISOString().slice(0, -1);
}

/**
 * A timestamp column of an append-only table, in row order. The guild's agents sometimes write the
 * strftime format string instead of a time (`%Y-%m-%dT%H:%M:%SZ`); such a row takes the time of
 * the nearest valid row before it (or after it, at the start), which keeps the order, and is
 * reported.
 */
function lenientTimestamps(rows: Row[], column: string, what: string, warnings: string[]): string[] {
	const parsed = rows.map((r) => {
		try {
			return ts(r[column], what);
		} catch {
			return null;
		}
	});
	const firstValid = parsed.find((value) => value !== null);
	let previous = firstValid;
	let repaired = 0;
	const result = parsed.map((value) => {
		if (value !== null) {
			previous = value;
			return value;
		}
		repaired += 1;
		if (previous === undefined) throw new GuildImportError(`${what}: no row has a valid timestamp`);
		return previous;
	});
	if (repaired > 0) warnings.push(`${repaired} ${what} row(s) had an invalid timestamp; they take the time of the row before`);
	return result;
}

function tsOrNull(value: unknown, what: string): string | null {
	return value === null || value === undefined ? null : ts(value, what);
}

/** The Kumiai id for a guild key, or a named error when the source row points at nothing. */
function ref(map: Map<string, string>, key: string | null, what: string): string | null {
	if (key === null) return null;
	const id = map.get(key);
	if (id === undefined) throw new GuildImportError(`${what} points at ${key}, which is not in the file`);
	return id;
}

function refRequired(map: Map<string, string>, key: string, what: string): string {
	return ref(map, key, what) as string;
}

function parseJson(raw: string, what: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		throw new GuildImportError(`${what}: not valid JSON`);
	}
}

// ── writing ──────────────────────────────────────────────────────────────────────────

/** Postgres allows 65535 bind parameters per statement. */
const MAX_PARAMS = 60000;
const MAX_ROWS_PER_INSERT = 500;

/**
 * Multi-row INSERT in source order. `casts` adds `::type` to a column's placeholder (jsonb
 * columns arrive as text). Returns RETURNING rows in insert order.
 */
async function insertRows(
	client: PoolClient,
	table: string,
	columns: string[],
	rows: unknown[][],
	options: { casts?: Record<string, string>; returning?: string; onConflict?: string } = {},
): Promise<Row[]> {
	const returned: Row[] = [];
	const chunk = Math.max(1, Math.min(MAX_ROWS_PER_INSERT, Math.floor(MAX_PARAMS / columns.length)));
	for (let start = 0; start < rows.length; start += chunk) {
		const batch = rows.slice(start, start + chunk);
		const values: unknown[] = [];
		const tuples = batch.map((row) => {
			const placeholders = row.map((value, i) => {
				values.push(value);
				const cast = options.casts?.[columns[i] as string];
				return `$${values.length}${cast ? `::${cast}` : ""}`;
			});
			return `(${placeholders.join(", ")})`;
		});
		const sql =
			`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}` +
			(options.onConflict ? ` ${options.onConflict}` : "") +
			(options.returning ? ` RETURNING ${options.returning}` : "");
		const result = await client.query(sql, values);
		if (options.returning) returned.push(...(result.rows as Row[]));
	}
	return returned;
}

async function inTable<T>(table: string, work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (err) {
		if (err instanceof GuildImportError) throw new GuildImportError(`${table}: ${err.message}`, err.conflict);
		const detail = err instanceof Error ? err.message : String(err);
		throw new GuildImportError(`${table}: ${detail}`);
	}
}

interface TargetWorkspace {
	id: string;
	name: string;
	teamId: string;
	created: boolean;
}

async function resolveWorkspace(client: PoolClient, options: ImportOptions): Promise<TargetWorkspace> {
	const byId = await client.query<{ id: string; name: string; team_id: string }>(
		"SELECT id, name, team_id FROM kumiai_workspaces WHERE id = $1",
		[options.workspace],
	);
	const found =
		byId.rows.length > 0
			? byId.rows
			: (
					await client.query<{ id: string; name: string; team_id: string }>(
						"SELECT id, name, team_id FROM kumiai_workspaces WHERE name = $1 AND ($2::text IS NULL OR team_id = $2)",
						[options.workspace, options.teamId ?? null],
					)
				).rows;

	if (found.length > 1) {
		throw new GuildImportError(
			`${found.length} workspaces are named "${options.workspace}"; pass the team (--team) or the workspace id`,
		);
	}
	const hit = found[0];
	if (hit) {
		if (options.teamId !== undefined && hit.team_id !== options.teamId) {
			throw new GuildImportError(`workspace ${hit.id} belongs to team ${hit.team_id}, not ${options.teamId}`);
		}
		return { id: hit.id, name: hit.name, teamId: hit.team_id, created: false };
	}

	if (!options.createWorkspace) {
		throw new GuildImportError(
			`no workspace with id or name "${options.workspace}" (pass --create with --team to create it)`,
		);
	}
	if (options.teamId === undefined) throw new GuildImportError("creating a workspace needs the team (--team)");
	const team = await client.query("SELECT 1 FROM teams WHERE id = $1", [options.teamId]);
	if (team.rowCount === 0) throw new GuildImportError(`no team ${options.teamId}`);
	const id = nanoid(21);
	await client.query(
		`INSERT INTO kumiai_workspaces (id, team_id, name, is_default, created_at, updated_at)
		 VALUES ($1, $2, $3, false, kumiai_utc_now(), kumiai_utc_now())`,
		[id, options.teamId, options.workspace],
	);
	return { id, name: options.workspace, teamId: options.teamId, created: true };
}

async function assertEmpty(client: PoolClient, workspaceId: string): Promise<void> {
	const used: string[] = [];
	for (const table of EMPTY_BEFORE) {
		const result = await client.query<{ n: number }>(
			`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id = $1`,
			[workspaceId],
		);
		const n = result.rows[0]?.n ?? 0;
		if (n > 0) used.push(`${table}: ${n}`);
	}
	if (used.length > 0) {
		throw new GuildImportError(
			`workspace ${workspaceId} already holds guild data (${used.join(", ")}); import into an empty workspace`,
			true,
		);
	}
}

async function writeSource(
	client: PoolClient,
	source: GuildSource,
	target: TargetWorkspace,
	warnings: string[],
): Promise<void> {
	const ws = target.id;
	const team = target.teamId;
	const scope = [team, ws];
	const scopeColumns = ["team_id", "workspace_id"];

	const goals = new Map<string, string>();
	const projects = new Map<string, string>();
	const requirements = new Map<string, string>();
	const plans = new Map<string, string>();
	const tasks = new Map<string, string>();
	const nodes = new Map<string, string>();
	const inspections = new Map<string, string>();
	const coverages = new Map<string, string>();
	const findings = new Map<number, number>();

	await inTable("goal", () =>
		insertRows(
			client,
			"kumiai_goals",
			[...scopeColumns, "id", "key", "title", "body", "status", "priority", "created_at", "updated_at"],
			source.goal.map((r) => {
				const id = nanoid(21);
				goals.set(text(r, "id"), id);
				return [
					...scope,
					id,
					text(r, "id"),
					text(r, "title"),
					text(r, "body"),
					text(r, "status"),
					int(r, "priority"),
					ts(r["created_at"], "goal.created_at"),
					ts(r["updated_at"], "goal.updated_at"),
				];
			}),
		),
	);

	let flattened = 0;
	await inTable("project", () =>
		insertRows(
			client,
			"kumiai_projects",
			[
				...scopeColumns,
				"id",
				"key",
				"goal_id",
				"title",
				"body",
				"ordinal",
				"status",
				"priority",
				"impact",
				"effort",
				"concurrent",
				"isolation",
				"worktree_path",
				"created_at",
				"updated_at",
			],
			source.project.map((r) => {
				const id = nanoid(21);
				projects.set(text(r, "id"), id);
				const priority = int(r, "priority");
				if (priority === 5) flattened += 1;
				return [
					...scope,
					id,
					text(r, "id"),
					refRequired(goals, text(r, "goal_id"), `project ${text(r, "id")}`),
					text(r, "title"),
					text(r, "body"),
					intOrNull(r, "ordinal"),
					text(r, "status"),
					GUILD_PRIORITY_TO_KUMIAI[priority],
					// Kumiai's planning estimates, which the guild does not have (contract §3).
					50,
					5,
					int(r, "concurrent") === 1,
					text(r, "isolation"),
					textOrNull(r, "worktree_path"),
					ts(r["created_at"], "project.created_at"),
					ts(r["updated_at"], "project.updated_at"),
				];
			}),
		),
	);
	if (flattened > 0) {
		warnings.push(`${flattened} project(s) had priority 5; Kumiai stores that as low (4)`);
	}

	await inTable("requirement", () =>
		insertRows(
			client,
			"kumiai_requirements",
			[...scopeColumns, "id", "key", "project_id", "title", "body", "status", "priority", "created_at", "updated_at"],
			source.requirement.map((r) => {
				const id = nanoid(21);
				requirements.set(text(r, "id"), id);
				return [
					...scope,
					id,
					text(r, "id"),
					ref(projects, textOrNull(r, "project_id"), `requirement ${text(r, "id")}`),
					text(r, "title"),
					text(r, "body"),
					text(r, "status"),
					int(r, "priority"),
					ts(r["created_at"], "requirement.created_at"),
					ts(r["updated_at"], "requirement.updated_at"),
				];
			}),
		),
	);

	// A plan and a task point at each other (plan.task_id, task.plan_id), and a plan at its gate
	// node, so plans go in first without those links and are completed below.
	const planLinks: { id: string; taskKey: string | null; nodeKey: string | null; updatedAt: string }[] = [];
	await inTable("plan", () =>
		insertRows(
			client,
			"kumiai_plans",
			[
				...scopeColumns,
				"id",
				"key",
				"requirement_id",
				"title",
				"body",
				"status",
				"approval",
				"approved_by",
				"approved_at",
				"created_at",
				"updated_at",
			],
			source.plan.map((r) => {
				const id = nanoid(21);
				const key = text(r, "id");
				plans.set(key, id);
				const updatedAt = ts(r["updated_at"], "plan.updated_at");
				const taskKey = textOrNull(r, "task_id");
				const nodeKey = textOrNull(r, "gate_node_id");
				// Stored a second early when a link follows: the touch trigger restamps an
				// UPDATE that leaves updated_at alone, but keeps one that changes it.
				const insertedAt =
					taskKey !== null || nodeKey !== null ? new Date(Date.parse(`${updatedAt}Z`) - 1000).toISOString().slice(0, -1) : updatedAt;
				if (taskKey !== null || nodeKey !== null) planLinks.push({ id, taskKey, nodeKey, updatedAt });
				return [
					...scope,
					id,
					key,
					refRequired(requirements, text(r, "requirement_id"), `plan ${key}`),
					text(r, "title"),
					text(r, "body"),
					text(r, "status"),
					text(r, "approval"),
					textOrNull(r, "approved_by"),
					tsOrNull(r["approved_at"], "plan.approved_at"),
					ts(r["created_at"], "plan.created_at"),
					insertedAt,
				];
			}),
		),
	);

	await inTable("task", () =>
		insertRows(
			client,
			"kumiai_tasks",
			[
				...scopeColumns,
				"id",
				"key",
				"requirement_id",
				"plan_id",
				"files",
				"parallel_group",
				"node_key",
				"title",
				"objective",
				"body",
				"status",
				"priority",
				"agent",
				"claimed_by",
				"claimed_at",
				"created_at",
				"updated_at",
			],
			source.task.map((r) => {
				const id = nanoid(21);
				const key = text(r, "id");
				tasks.set(key, id);
				const files = parseJson(text(r, "files"), `task ${key}.files`);
				if (!Array.isArray(files)) throw new GuildImportError(`task ${key}.files is not a JSON array`);
				return [
					...scope,
					id,
					key,
					refRequired(requirements, text(r, "requirement_id"), `task ${key}`),
					ref(plans, textOrNull(r, "plan_id"), `task ${key}`),
					JSON.stringify(files),
					textOrNull(r, "parallel_group"),
					textOrNull(r, "node_key"),
					text(r, "title"),
					text(r, "objective"),
					text(r, "body"),
					text(r, "status"),
					int(r, "priority"),
					textOrNull(r, "agent"),
					textOrNull(r, "claimed_by"),
					tsOrNull(r["claimed_at"], "task.claimed_at"),
					ts(r["created_at"], "task.created_at"),
					ts(r["updated_at"], "task.updated_at"),
				];
			}),
			{ casts: { files: "jsonb" } },
		),
	);

	await inTable("task_dependency", () =>
		insertRows(
			client,
			"kumiai_task_dependency",
			[...scopeColumns, "task_id", "depends_on"],
			source.task_dependency.map((r) => [
				...scope,
				refRequired(tasks, text(r, "task_id"), "task_dependency"),
				refRequired(tasks, text(r, "depends_on"), "task_dependency"),
			]),
		),
	);

	await inTable("task_capability", () =>
		insertRows(
			client,
			"kumiai_task_capability",
			[...scopeColumns, "task_id", "capability", "required"],
			source.task_capability.map((r) => [
				...scope,
				refRequired(tasks, text(r, "task_id"), "task_capability"),
				text(r, "capability"),
				int(r, "required") === 1,
			]),
		),
	);

	await inTable("graph_node", () =>
		insertRows(
			client,
			"kumiai_graph_node",
			[...scopeColumns, "id", "key", "requirement_id", "node_key", "kind", "task_id", "parallel_group", "status"],
			source.graph_node.map((r) => {
				const id = nanoid(21);
				const key = text(r, "id");
				nodes.set(key, id);
				return [
					...scope,
					id,
					key,
					refRequired(requirements, text(r, "requirement_id"), `graph_node ${key}`),
					text(r, "node_key"),
					text(r, "kind"),
					ref(tasks, textOrNull(r, "task_id"), `graph_node ${key}`),
					textOrNull(r, "parallel_group"),
					text(r, "status"),
				];
			}),
		),
	);

	await inTable("graph_edge", () =>
		insertRows(
			client,
			"kumiai_graph_edge",
			[...scopeColumns, "from_node", "to_node"],
			source.graph_edge.map((r) => [
				...scope,
				refRequired(nodes, text(r, "from_node"), "graph_edge.from_node"),
				refRequired(nodes, text(r, "to_node"), "graph_edge.to_node"),
			]),
		),
	);

	await inTable("graph_deviation", () =>
		insertRows(
			client,
			"kumiai_graph_deviation",
			[...scopeColumns, "requirement_id", "kind", "node_key", "reason", "created_at"],
			source.graph_deviation.map((r) => [
				...scope,
				refRequired(requirements, text(r, "requirement_id"), "graph_deviation"),
				text(r, "kind"),
				text(r, "node_key"),
				text(r, "reason"),
				ts(r["created_at"], "graph_deviation.created_at"),
			]),
		),
	);

	await inTable("gate", () =>
		insertRows(
			client,
			"kumiai_gate",
			[...scopeColumns, "node_id", "prompt", "kind", "status", "decision", "decided_at"],
			source.gate.map((r) => [
				...scope,
				refRequired(nodes, text(r, "node_id"), "gate"),
				text(r, "prompt"),
				text(r, "kind"),
				text(r, "status"),
				textOrNull(r, "decision"),
				tsOrNull(r["decided_at"], "gate.decided_at"),
			]),
		),
	);

	await inTable("plan links", async () => {
		for (const link of planLinks) {
			await client.query(
				"UPDATE kumiai_plans SET task_id = $2, gate_node_id = $3, updated_at = $4 WHERE id = $1",
				[
					link.id,
					ref(tasks, link.taskKey, `plan ${link.id}`),
					ref(nodes, link.nodeKey, `plan ${link.id}`),
					link.updatedAt,
				],
			);
		}
	});

	const workLogTimes = lenientTimestamps(source.work_log, "ts", "work_log.ts", warnings);
	await inTable("work_log", () =>
		insertRows(
			client,
			"kumiai_work_log",
			[...scopeColumns, "task_id", "ts", "agent", "entry"],
			source.work_log.map((r, i) => [
				...scope,
				refRequired(tasks, text(r, "task_id"), "work_log"),
				workLogTimes[i],
				text(r, "agent"),
				text(r, "entry"),
			]),
		),
	);

	const findingTimes = lenientTimestamps(source.review_finding, "created_at", "review_finding.created_at", warnings);
	await inTable("review_finding", async () => {
		const inserted = await insertRows(
			client,
			"kumiai_review_finding",
			[
				...scopeColumns,
				"task_id",
				"reviewer",
				"severity",
				"summary",
				"detail",
				"file",
				"line",
				"disposition",
				"fix_task_id",
				"fix_ref",
				"created_at",
			],
			source.review_finding.map((r, i) => [
				...scope,
				refRequired(tasks, text(r, "task_id"), "review_finding"),
				text(r, "reviewer"),
				text(r, "severity"),
				text(r, "summary"),
				text(r, "detail"),
				textOrNull(r, "file"),
				intOrNull(r, "line"),
				text(r, "disposition"),
				ref(tasks, textOrNull(r, "fix_task_id"), "review_finding"),
				text(r, "fix_ref"),
				findingTimes[i],
			]),
			{ returning: "id" },
		);
		source.review_finding.forEach((r, i) => findings.set(int(r, "id"), Number(inserted[i]?.["id"])));
	});

	await inTable("bug", () =>
		insertRows(
			client,
			"kumiai_bug",
			[
				...scopeColumns,
				"id",
				"key",
				"title",
				"body",
				"repro",
				"severity",
				"status",
				"found_by",
				"requirement_id",
				"fix_task_id",
				"fix_ref",
				"created_at",
				"updated_at",
			],
			source.bug.map((r) => {
				const id = nanoid(21);
				const key = text(r, "id");
				return [
					...scope,
					id,
					key,
					text(r, "title"),
					text(r, "body"),
					text(r, "repro"),
					text(r, "severity"),
					text(r, "status"),
					textOrNull(r, "found_by"),
					ref(requirements, textOrNull(r, "requirement_id"), `bug ${key}`),
					ref(tasks, textOrNull(r, "fix_task_id"), `bug ${key}`),
					text(r, "fix_ref"),
					ts(r["created_at"], "bug.created_at"),
					ts(r["updated_at"], "bug.updated_at"),
				];
			}),
		),
	);

	await inTable("coverage", () =>
		insertRows(
			client,
			"kumiai_coverage",
			[...scopeColumns, "id", "key", "area", "risk", "spec_path", "last_inspected_at", "notes"],
			source.coverage.map((r) => {
				const id = nanoid(21);
				const key = text(r, "id");
				coverages.set(key, id);
				return [
					...scope,
					id,
					key,
					text(r, "area"),
					text(r, "risk"),
					textOrNull(r, "spec_path"),
					tsOrNull(r["last_inspected_at"], "coverage.last_inspected_at"),
					text(r, "notes"),
				];
			}),
		),
	);

	await inTable("inspection", () =>
		insertRows(
			client,
			"kumiai_inspection",
			[...scopeColumns, "id", "key", "scope", "trigger", "status", "started_at", "finished_at"],
			source.inspection.map((r) => {
				const id = nanoid(21);
				const key = text(r, "id");
				inspections.set(key, id);
				return [
					...scope,
					id,
					key,
					text(r, "scope"),
					text(r, "trigger"),
					text(r, "status"),
					tsOrNull(r["started_at"], "inspection.started_at"),
					tsOrNull(r["finished_at"], "inspection.finished_at"),
				];
			}),
		),
	);

	await inTable("inspection_coverage", () =>
		insertRows(
			client,
			"kumiai_inspection_coverage",
			[...scopeColumns, "inspection_id", "coverage_id", "verdict"],
			source.inspection_coverage.map((r) => [
				...scope,
				refRequired(inspections, text(r, "inspection_id"), "inspection_coverage"),
				refRequired(coverages, text(r, "coverage_id"), "inspection_coverage"),
				textOrNull(r, "verdict"),
			]),
		),
	);

	await inTable("doc", () =>
		insertRows(
			client,
			"kumiai_doc",
			[...scopeColumns, "id", "slug", "title", "body", "kind", "status", "area", "source", "created_at", "updated_at"],
			source.doc.map((r) => [
				...scope,
				nanoid(21),
				text(r, "slug"),
				text(r, "title"),
				text(r, "body"),
				text(r, "kind"),
				text(r, "status"),
				text(r, "area"),
				text(r, "source"),
				ts(r["created_at"], "doc.created_at"),
				ts(r["updated_at"], "doc.updated_at"),
			]),
		),
	);

	await inTable("doc_revision", () =>
		insertRows(
			client,
			"kumiai_doc_revision",
			[...scopeColumns, "slug", "title", "body", "kind", "status", "replaced_at"],
			source.doc_revision.map((r) => [
				...scope,
				text(r, "slug"),
				text(r, "title"),
				text(r, "body"),
				text(r, "kind"),
				text(r, "status"),
				ts(r["replaced_at"], "doc_revision.replaced_at"),
			]),
		),
	);

	await inTable("knowledge_edge", () => {
		/** Finding ids were renumbered; every other endpoint is a key that was kept. */
		const endpoint = (type: string, id: string): string => {
			if (type !== "review_finding") return id;
			const renumbered = findings.get(Number(id));
			return renumbered === undefined ? id : String(renumbered);
		};
		return insertRows(
			client,
			"kumiai_knowledge_edge",
			[
				...scopeColumns,
				"rel",
				"from_type",
				"from_id",
				"to_type",
				"to_id",
				"note",
				"created_by",
				"created_at",
			],
			source.knowledge_edge.map((r) => [
				...scope,
				text(r, "rel"),
				text(r, "from_type"),
				endpoint(text(r, "from_type"), text(r, "from_id")),
				text(r, "to_type"),
				endpoint(text(r, "to_type"), text(r, "to_id")),
				text(r, "note"),
				text(r, "created_by"),
				ts(r["created_at"], "knowledge_edge.created_at"),
			]),
		);
	});

	// `actor` is attribution per call in Kumiai (contract §4.1), so it is not carried over.
	await inTable("guild_state", () =>
		insertRows(
			client,
			"kumiai_guild_state",
			[...scopeColumns, "key", "value"],
			source.guild_state.filter((r) => text(r, "key") !== "actor").map((r) => [...scope, text(r, "key"), text(r, "value")]),
			{ onConflict: "ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value" },
		),
	);

	// The triggers narrated the inserts above as if they had just happened. Replace that with
	// the source's own history.
	const eventTimes = lenientTimestamps(source.event, "ts", "event.ts", warnings);
	await inTable("event", async () => {
		await client.query("DELETE FROM kumiai_event WHERE workspace_id = $1", [ws]);
		await insertRows(
			client,
			"kumiai_event",
			[...scopeColumns, "ts", "actor", "verb", "subject_type", "subject_id", "payload"],
			source.event.map((r, i) => {
				const payload = parseJson(text(r, "payload"), `event ${String(r["id"])}.payload`);
				if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
					throw new GuildImportError(`event ${String(r["id"])}.payload is not a JSON object`);
				}
				const verb = text(r, "verb");
				const body = payload as Record<string, unknown>;
				if ((verb === "found" || verb === "dispositioned") && typeof body["finding_id"] === "number") {
					body["finding_id"] = findings.get(body["finding_id"]) ?? body["finding_id"];
				}
				return [
					...scope,
					eventTimes[i],
					text(r, "actor"),
					verb,
					text(r, "subject_type"),
					text(r, "subject_id"),
					JSON.stringify(body),
				];
			}),
			{ casts: { payload: "jsonb" } },
		);
	});

}

async function verifyCounts(client: PoolClient, source: GuildSource, workspaceId: string): Promise<Record<string, number>> {
	const counts: Record<string, number> = {};
	for (const [name, rows] of Object.entries(source) as [keyof GuildSource, Row[]][]) {
		const table = TARGET_TABLE[name];
		if (table === null) continue;
		const result = await client.query<{ n: number }>(
			`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id = $1`,
			[workspaceId],
		);
		const written = result.rows[0]?.n ?? 0;
		if (written !== rows.length) {
			throw new GuildImportError(`${name}: the file has ${rows.length} row(s) but ${written} were written`);
		}
		counts[name] = written;
	}
	return counts;
}

// ── entry points ─────────────────────────────────────────────────────────────────────

/** Writes an already-read source into the workspace. Everything happens in one transaction. */
export async function importGuildSource(pool: Pool, source: GuildSource, options: ImportOptions): Promise<ImportReport> {
	const log = options.log ?? (() => undefined);
	const warnings: string[] = [];
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const target = await resolveWorkspace(client, options);
		log(`${target.created ? "created" : "using"} workspace "${target.name}" (${target.id})`);
		await assertEmpty(client, target.id);

		// The scope trigger refuses any row outside this workspace; the actor is only what the
		// triggers write before their events are replaced.
		await client.query(
			`SELECT set_config('kumiai.actor', $3, true),
			        set_config('kumiai.user_id', '', true),
			        set_config('kumiai.team_id', $1, true),
			        set_config('kumiai.workspace_id', $2, true)`,
			[target.teamId, target.id, options.actor ?? "guild-import"],
		);

		await writeSource(client, source, target, warnings);
		const counts = await verifyCounts(client, source, target.id);

		await client.query(options.dryRun ? "ROLLBACK" : "COMMIT");
		return {
			workspaceId: target.id,
			workspaceName: target.name,
			teamId: target.teamId,
			workspaceCreated: target.created,
			dryRun: options.dryRun === true,
			counts,
			warnings,
		};
	} catch (err) {
		await client.query("ROLLBACK").catch(() => undefined);
		throw err;
	} finally {
		client.release();
	}
}

/** Reads `options.sourcePath` and imports it. */
export async function importGuildDb(
	pool: Pool,
	options: ImportOptions & { sourcePath: string },
): Promise<ImportReport> {
	return importGuildSource(pool, readSourceFile(options.sourcePath), options);
}
