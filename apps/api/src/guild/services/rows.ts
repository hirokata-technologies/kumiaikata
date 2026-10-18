import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { toIsoUtc, type SqlExecutor } from "@kata/db";
import { GuildError } from "../registry.js";

/**
 * Guild-shaped row reads (docs/guild-contract.md §4.2) — the one place that turns a
 * `where` / `order_by` / `limit` / `offset` input into SQL over a `kumiai_g_<table>` or
 * `kumiai_v_<view>` relation (packages/db/GUILD.md "Views").
 *
 * Safety: the relation is checked against a fixed allowlist, every column name against the
 * relation's real columns (read once from information_schema and cached), and identifiers
 * are emitted quoted via `sql.identifier`. Values are always bound parameters.
 *
 * API (small on purpose):
 *   - `guildTable(type)` / `guildView(name)` → relation name
 *   - `readRows(exec, relation, workspaceId, query)` → `{ rows, next_offset }`
 *   - `readRow(exec, relation, workspaceId, match)` → one row or null (equality match)
 *   - `whereInput`, `orderByInput`, `limitInput`, `offsetInput` — the shared zod inputs
 * Rows come back without `workspace_id`; timestamps are ISO-8601 UTC strings; bigint ids
 * are numbers. Goal/project/requirement/plan/task/bug/inspection rows also carry `key`
 * (= `id`, the guild key) — output only; filter and order by `id`.
 */

// ── Relations ────────────────────────────────────────────────────────────────

/** Guild base tables exposed as `kumiai_g_<type>`. */
export const GUILD_TABLE_TYPES = [
	"goal",
	"project",
	"requirement",
	"plan",
	"task",
	"bug",
	"coverage",
	"inspection",
	"doc",
	"review_finding",
	"graph_node",
	"gate",
	"work_log",
	"task_dependency",
	"task_capability",
	"graph_edge",
	"graph_deviation",
	"knowledge_edge",
	"doc_revision",
	"event",
	"inspection_coverage",
	"guild_state",
] as const;
export type GuildTableType = (typeof GUILD_TABLE_TYPES)[number];

/** Every guild `v_*` view (guild schema.sql v9.3), served as `kumiai_v_*`. */
export const GUILD_VIEW_NAMES = [
	"v_task_who",
	"v_task_deps",
	"v_task_blockers",
	"v_task_actionable",
	"v_next_task",
	"v_batch",
	"v_open_bounties",
	"v_blocked_tasks",
	"v_ready_nodes",
	"v_gates_pending",
	"v_plans_pending_approval",
	"v_board",
	"v_requirement_progress",
	"v_projects_runnable",
	"v_project_progress",
	"v_goal_progress",
	"v_in_flight",
	"v_failed_tasks",
	"v_open_findings",
	"v_open_bugs",
	"v_recent_activity",
	"v_coverage_due",
	"v_knowledge_ref",
	"v_doc_current",
	"v_doc_neighbors",
	"v_doc_stale",
	"v_undocumented_work",
	"v_decision_log",
	"v_knowledge_dangling",
	"v_brief",
] as const;
export type GuildViewName = (typeof GUILD_VIEW_NAMES)[number];

/** A Postgres relation this module may read. Build one with `guildTable` / `guildView`. */
export type GuildRelation = `kumiai_g_${GuildTableType}` | `kumiai_${GuildViewName}`;

const RELATIONS = new Set<string>([
	...GUILD_TABLE_TYPES.map((t) => `kumiai_g_${t}`),
	...GUILD_VIEW_NAMES.map((v) => `kumiai_${v}`),
]);

export function guildTable(type: GuildTableType): GuildRelation {
	return `kumiai_g_${type}`;
}

export function guildView(name: GuildViewName): GuildRelation {
	return `kumiai_${name}`;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export const WHERE_OPS = ["=", "<>", "<", "<=", ">", ">=", "like", "is_null", "not_null"] as const;
export type WhereOp = (typeof WHERE_OPS)[number];

const scalarInput = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type Scalar = z.infer<typeof scalarInput>;

const conditionInput = z.union([
	scalarInput,
	z.array(scalarInput),
	z.object({ op: z.enum(WHERE_OPS), value: scalarInput.optional() }).strict(),
]);

export const whereInput = z
	.record(z.string(), conditionInput)
	.describe(
		"Filter: {col: scalar (=) | scalar[] (IN) | {op, value?}}; op ∈ = <> < <= > >= like is_null not_null. ANDed.",
	);
export type Where = z.infer<typeof whereInput>;

export const orderByInput = z
	.array(z.object({ col: z.string(), dir: z.enum(["asc", "desc"]).default("asc") }).strict())
	.max(16);
export type OrderBy = { col: string; dir?: "asc" | "desc" | undefined };

export const MAX_LIMIT = 500;
export const DEFAULT_LIMIT = 200;
export const limitInput = z.number().int().min(1).max(MAX_LIMIT).describe(`≤${MAX_LIMIT}, default ${DEFAULT_LIMIT}`);
export const offsetInput = z.number().int().min(0).max(1_000_000);

// ── Columns ──────────────────────────────────────────────────────────────────

type ColumnKind = "text" | "int" | "bigint" | "timestamp" | "jsonb" | "other";
type Columns = ReadonlyMap<string, ColumnKind>;

const columnCache = new Map<string, Columns>();
const IDENT = /^[a-z_][a-z0-9_]*$/;

function kindOf(dataType: string): ColumnKind {
	if (dataType === "text" || dataType === "character varying") return "text";
	if (dataType === "integer" || dataType === "smallint") return "int";
	if (dataType === "bigint") return "bigint";
	if (dataType.startsWith("timestamp")) return "timestamp";
	if (dataType === "jsonb" || dataType === "json") return "jsonb";
	return "other";
}

function assertRelation(relation: string): void {
	if (!RELATIONS.has(relation)) throw new GuildError("VALIDATION", `Unknown relation ${relation}.`);
}

/** The relation's columns in order (cached for the process: views change only by migration). */
export async function relationColumns(exec: SqlExecutor, relation: GuildRelation): Promise<Columns> {
	assertRelation(relation);
	const cached = columnCache.get(relation);
	if (cached) return cached;
	const result = await exec.execute(sql`
		SELECT column_name, data_type FROM information_schema.columns
		 WHERE table_schema = current_schema() AND table_name = ${relation}
		 ORDER BY ordinal_position`);
	const cols = new Map<string, ColumnKind>();
	for (const row of result.rows) cols.set(String(row["column_name"]), kindOf(String(row["data_type"])));
	if (cols.size === 0) throw new Error(`[guild/rows] relation ${relation} has no columns`);
	columnCache.set(relation, cols);
	return cols;
}

function column(cols: Columns, name: string, relation: string): ColumnKind {
	const kind = IDENT.test(name) && name !== "workspace_id" ? cols.get(name) : undefined;
	if (!kind) throw new GuildError("VALIDATION", `Unknown column "${name}" for ${relation.replace(/^kumiai_(g_)?/, "")}.`);
	return kind;
}

// ── Values ───────────────────────────────────────────────────────────────────

/** An instant as Kumiai stores it: UTC wall clock. A value without an offset is UTC. */
function instant(value: Scalar, col: string): string {
	if (typeof value !== "string") throw new GuildError("VALIDATION", `"${col}" takes an ISO-8601 timestamp.`);
	const iso = toIsoUtc(value);
	if (!iso) throw new GuildError("VALIDATION", `"${col}": "${value}" is not a timestamp.`);
	return new Date(iso).toISOString().replace("T", " ").replace("Z", "");
}

/** One bound value, cast to the column's type so comparisons are typed (not textual). */
function bind(kind: ColumnKind, value: Scalar, col: string): SQL {
	if (value === null) throw new GuildError("VALIDATION", `"${col}": use {op: "is_null"} to match NULL.`);
	switch (kind) {
		case "int":
		case "bigint": {
			const n = typeof value === "boolean" ? Number(value) : typeof value === "string" ? Number(value) : value;
			if (typeof value === "string" && !/^-?\d+$/.test(value.trim())) {
				throw new GuildError("VALIDATION", `"${col}" takes an integer.`);
			}
			if (!Number.isSafeInteger(n)) throw new GuildError("VALIDATION", `"${col}" takes an integer.`);
			return kind === "int" ? sql`${n}::integer` : sql`${n}::bigint`;
		}
		case "timestamp":
			return sql`${instant(value, col)}::timestamp`;
		case "jsonb":
			return sql`${JSON.stringify(value)}::jsonb`;
		default:
			return sql`${String(value)}::text`;
	}
}

const COMPARE: Record<Exclude<WhereOp, "like" | "is_null" | "not_null">, SQL> = {
	"=": sql.raw("="),
	"<>": sql.raw("<>"),
	"<": sql.raw("<"),
	"<=": sql.raw("<="),
	">": sql.raw(">"),
	">=": sql.raw(">="),
};

/** The `where` input as SQL conditions (ANDed by the caller). Throws VALIDATION. */
export async function buildWhere(
	exec: SqlExecutor,
	relation: GuildRelation,
	where: Where | undefined,
): Promise<SQL[]> {
	if (!where) return [];
	const cols = await relationColumns(exec, relation);
	const out: SQL[] = [];
	for (const [name, cond] of Object.entries(where)) {
		const kind = column(cols, name, relation);
		const ident = sql.identifier(name);
		if (cond === null) {
			out.push(sql`${ident} IS NULL`);
		} else if (Array.isArray(cond)) {
			if (cond.length === 0) out.push(sql`FALSE`);
			else out.push(sql`${ident} IN (${sql.join(cond.map((v) => bind(kind, v, name)), sql`, `)})`);
		} else if (typeof cond === "object") {
			const { op, value } = cond;
			if (op === "is_null") out.push(sql`${ident} IS NULL`);
			else if (op === "not_null") out.push(sql`${ident} IS NOT NULL`);
			else if (value === undefined) throw new GuildError("VALIDATION", `"${name}": op "${op}" needs a value.`);
			else if (op === "like") {
				if (kind !== "text") throw new GuildError("VALIDATION", `"${name}": like works on text columns only.`);
				if (typeof value !== "string") throw new GuildError("VALIDATION", `"${name}": like takes a string pattern.`);
				out.push(sql`${ident} LIKE ${value} ESCAPE '\\'`);
			} else {
				out.push(sql`${ident} ${COMPARE[op]} ${bind(kind, value, name)}`);
			}
		} else {
			out.push(sql`${ident} = ${bind(kind, cond, name)}`);
		}
	}
	return out;
}

/** `order_by` as SQL. Text sorts byte-wise (SQLite BINARY); NULLs sort as SQLite sorts them. */
export async function buildOrderBy(
	exec: SqlExecutor,
	relation: GuildRelation,
	orderBy: readonly OrderBy[] | undefined,
): Promise<SQL | null> {
	if (!orderBy || orderBy.length === 0) return null;
	const cols = await relationColumns(exec, relation);
	const parts = orderBy.map(({ col, dir }) => {
		const kind = column(cols, col, relation);
		const collate = kind === "text" ? sql.raw(` COLLATE "C"`) : sql.raw("");
		const direction = dir === "desc" ? sql.raw(" DESC NULLS LAST") : sql.raw(" ASC NULLS FIRST");
		return sql`${sql.identifier(col)}${collate}${direction}`;
	});
	return sql.join(parts, sql`, `);
}

// ── Reads ────────────────────────────────────────────────────────────────────

export type GuildRow = Record<string, unknown>;

export interface RowQuery {
	where?: Where | undefined;
	orderBy?: readonly OrderBy[] | undefined;
	/** Used when `orderBy` is empty — give tables a stable order so paging is stable. */
	defaultOrder?: readonly OrderBy[] | undefined;
	limit?: number | undefined;
	offset?: number | undefined;
	/** Extra trusted conditions (built by the caller with bound values). */
	extra?: SQL[] | undefined;
}

export interface RowPage {
	rows: GuildRow[];
	next_offset: number | null;
}

async function selectList(exec: SqlExecutor, relation: GuildRelation): Promise<SQL> {
	const cols = await relationColumns(exec, relation);
	const parts: SQL[] = [];
	for (const [name, kind] of cols) {
		if (name === "workspace_id") continue;
		const ident = sql.identifier(name);
		// Read timestamps as text: node-postgres would otherwise parse a zone-less timestamp in
		// the server's local zone. The text is UTC wall clock, which toIsoUtc reads as UTC.
		parts.push(kind === "timestamp" ? sql`${ident}::text AS ${ident}` : sql`${ident}`);
	}
	return sql.join(parts, sql`, `);
}

/** A raw result row in guild shape: ISO timestamps, numeric bigint ids. */
export function serializeRow(cols: Columns, raw: Record<string, unknown>): GuildRow {
	const row: GuildRow = {};
	for (const [name, kind] of cols) {
		if (name === "workspace_id") continue;
		const value = raw[name];
		if (value === null || value === undefined) row[name] = null;
		else if (kind === "timestamp") row[name] = toIsoUtc(value instanceof Date ? value : String(value));
		else if (kind === "bigint") row[name] = Number(value);
		else row[name] = value;
	}
	return row;
}

/** Relations whose `id` is a counter-allocated guild key; their rows also carry it as `key`. */
const KEYED_RELATIONS = new Set<string>(
	(["goal", "project", "requirement", "plan", "task", "bug", "inspection"] as const).map((t) => guildTable(t)),
);

/** `{id, key, ...}`: the guild's kumiai.md reads `key` off results; `id` stays the same key. */
function withKey(row: GuildRow): GuildRow {
	const { id, ...rest } = row;
	return { id, key: id, ...rest };
}

/** One page of rows of `relation` in `workspaceId`. The caller has already run assertWorkspace. */
export async function readRows(
	exec: SqlExecutor,
	relation: GuildRelation,
	workspaceId: string,
	query: RowQuery = {},
): Promise<RowPage> {
	const cols = await relationColumns(exec, relation);
	const limit = query.limit ?? DEFAULT_LIMIT;
	if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
		throw new GuildError("VALIDATION", `limit must be 1–${MAX_LIMIT}.`);
	}
	const offset = query.offset ?? 0;
	const conditions = [
		sql`workspace_id = ${workspaceId}`,
		...(await buildWhere(exec, relation, query.where)),
		...(query.extra ?? []),
	];
	const order =
		(await buildOrderBy(exec, relation, query.orderBy)) ?? (await buildOrderBy(exec, relation, query.defaultOrder));
	const result = await exec.execute(sql`
		SELECT ${await selectList(exec, relation)} FROM ${sql.identifier(relation)}
		 WHERE ${sql.join(conditions, sql` AND `)}
		 ${order ? sql`ORDER BY ${order}` : sql``}
		 LIMIT ${limit + 1} OFFSET ${offset}`);
	const more = result.rows.length > limit;
	const keyed = KEYED_RELATIONS.has(relation);
	return {
		rows: result.rows.slice(0, limit).map((r) => {
			const row = serializeRow(cols, r);
			return keyed ? withKey(row) : row;
		}),
		next_offset: more ? offset + limit : null,
	};
}

/** The one row of `relation` matching every `match` column by equality, or null. */
export async function readRow(
	exec: SqlExecutor,
	relation: GuildRelation,
	workspaceId: string,
	match: Record<string, string | number>,
): Promise<GuildRow | null> {
	const page = await readRows(exec, relation, workspaceId, { where: match, limit: 1 });
	return page.rows[0] ?? null;
}
