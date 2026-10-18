import { sql, type SQL } from "drizzle-orm";
import { toIsoUtc, type GuildTx } from "@kata/db";
import { GuildError } from "../registry.js";

/**
 * Small shared helpers for the direction, work and graph tools (contract §4.3–4.5): resolve
 * guild keys to internal ids inside one workspace, lock a row for a guarded move, and read
 * rows back in the guild shape through the `kumiai_g_<table>` views (packages/db/GUILD.md).
 */

export type GuildRow = Record<string, unknown>;

/** Base tables addressed by a guild `key` column. */
export type KeyedTable =
	| "kumiai_goals"
	| "kumiai_projects"
	| "kumiai_requirements"
	| "kumiai_plans"
	| "kumiai_tasks"
	| "kumiai_graph_node";

/** The guild-shaped views this module reads. */
export type GuildView =
	| "goal"
	| "project"
	| "requirement"
	| "plan"
	| "task"
	| "task_dependency"
	| "task_capability"
	| "graph_node"
	| "graph_edge"
	| "graph_deviation"
	| "gate"
	| "work_log";

const LABEL: Record<KeyedTable, string> = {
	kumiai_goals: "Goal",
	kumiai_projects: "Project",
	kumiai_requirements: "Requirement",
	kumiai_plans: "Plan",
	kumiai_tasks: "Task",
	kumiai_graph_node: "Graph node",
};

/** Views whose `id` is a server-generated `PREFIX-NNN` key; their rows also carry it as `key`. */
const PREFIX_KEYED: ReadonlySet<GuildView> = new Set(["goal", "project", "requirement", "plan", "task"]);

const TIMESTAMP_COLUMNS: ReadonlySet<string> = new Set([
	"created_at",
	"updated_at",
	"claimed_at",
	"approved_at",
	"decided_at",
	"ts",
]);

/** The transaction's UTC wall clock, the convention every guild timestamp uses. */
export const utcNow = (): SQL => sql`kumiai_utc_now()`;

/** The UTC wall clock (not the transaction start): for rows whose own `ts` orders the feed. */
export const utcClock = (): SQL => sql`kumiai_utc_clock()`;

/**
 * Finds the row with guild key `key` in the workspace, or throws NOT_FOUND. With `lock`, the
 * row is held `FOR UPDATE` until the transaction ends, so a guarded move reads and writes one
 * version of it. The raw row (snake_case columns) is returned.
 */
export async function findByKey(
	tx: GuildTx,
	table: KeyedTable,
	workspaceId: string,
	key: string,
	opts?: { lock?: boolean },
): Promise<GuildRow & { id: string }> {
	const lock = opts?.lock ? sql` FOR UPDATE` : sql``;
	const result = await tx.execute(
		sql`SELECT * FROM ${sql.identifier(table)} WHERE workspace_id = ${workspaceId} AND key = ${key}${lock}`,
	);
	const row = result.rows[0];
	if (!row) throw new GuildError("NOT_FOUND", `${LABEL[table]} ${key} not found in this workspace.`);
	return row as GuildRow & { id: string };
}

/** The internal id of a key, or undefined/null passed through (omitted keeps, null clears). */
export async function resolveOptionalKey(
	tx: GuildTx,
	table: KeyedTable,
	workspaceId: string,
	key: string | null | undefined,
): Promise<string | null | undefined> {
	if (key === undefined || key === null) return key;
	return (await findByKey(tx, table, workspaceId, key)).id;
}

/** Contract §2 rule 9: the `expect_status` guard. A mismatch is CONFLICT and nothing is written. */
export function assertExpectedStatus(
	what: string,
	current: string,
	expected: string | readonly string[] | undefined,
): void {
	if (expected === undefined) return;
	const allowed = typeof expected === "string" ? [expected] : expected;
	if (!allowed.includes(current)) {
		throw new GuildError(
			"CONFLICT",
			`${what} is '${current}', expected ${allowed.map((s) => `'${s}'`).join(" or ")}.`,
		);
	}
}

/**
 * Rows of `kumiai_g_<view>` in the workspace where every `where` column equals its value,
 * shaped for the wire: no `workspace_id`, timestamps as ISO-8601 UTC, and prefixed-key rows also
 * carrying their key as `key` (what the guild reads off a create result).
 */
export async function readGuildRows(
	tx: GuildTx,
	view: GuildView,
	workspaceId: string,
	where: Record<string, string | number>,
	orderBy: readonly string[] = [],
): Promise<GuildRow[]> {
	const conditions = Object.entries(where).map(([col, value]) => sql` AND v.${sql.identifier(col)} = ${value}`);
	const order =
		orderBy.length > 0
			? sql` ORDER BY ${sql.join(
					orderBy.map((col) => sql`v.${sql.identifier(col)}`),
					sql`, `,
				)}`
			: sql``;
	const result = await tx.execute(
		sql`SELECT to_jsonb(v) AS row FROM ${sql.identifier(`kumiai_g_${view}`)} v
		     WHERE v.workspace_id = ${workspaceId}${sql.join(conditions, sql``)}${order}`,
	);
	return result.rows.map((r) => shapeRow(view, r["row"] as GuildRow));
}

/** The one row of `kumiai_g_<view>` matching `where`, or NOT_FOUND. */
export async function readGuildRow(
	tx: GuildTx,
	view: GuildView,
	workspaceId: string,
	where: Record<string, string | number>,
): Promise<GuildRow> {
	const [row] = await readGuildRows(tx, view, workspaceId, where);
	if (!row) throw new GuildError("NOT_FOUND", `${view} not found.`);
	return row;
}

function shapeRow(view: GuildView, raw: GuildRow): GuildRow {
	const row: GuildRow = {};
	for (const [col, value] of Object.entries(raw)) {
		if (col === "workspace_id") continue; // implied by the call, as in rows.ts
		row[col] = TIMESTAMP_COLUMNS.has(col) && typeof value === "string" ? toIsoUtc(value) : value;
	}
	if (PREFIX_KEYED.has(view)) row["key"] = row["id"];
	return row;
}

/** A task in the guild shape plus its `capabilities` and `depends_on` (the `get` shape). */
export async function readTask(tx: GuildTx, workspaceId: string, key: string): Promise<GuildRow> {
	const task = await readGuildRow(tx, "task", workspaceId, { id: key });
	const capabilities = await readGuildRows(tx, "task_capability", workspaceId, { task_id: key }, ["capability"]);
	const deps = await readGuildRows(tx, "task_dependency", workspaceId, { task_id: key }, ["depends_on"]);
	return {
		...task,
		capabilities: capabilities.map((c) => ({ capability: c["capability"], required: c["required"] === 1 })),
		depends_on: deps.map((d) => d["depends_on"]),
	};
}
