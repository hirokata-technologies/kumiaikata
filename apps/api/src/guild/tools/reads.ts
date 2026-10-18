import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, DOC_KINDS } from "@kata/db";
import { GuildError, assertWorkspace, defineTool, workspaceInput, type GuildToolDef } from "../registry.js";
import {
	GUILD_TABLE_TYPES,
	GUILD_VIEW_NAMES,
	guildTable,
	guildView,
	limitInput,
	offsetInput,
	orderByInput,
	readRow,
	readRows,
	whereInput,
	type GuildRow,
	type GuildTableType,
	type OrderBy,
} from "../services/rows.js";

/**
 * Contract §4.2 reads: read_view, get, list, search_docs, fingerprint. Every read checks the
 * workspace (FORBIDDEN) and filters by it; rows are guild-shaped (keys, ISO timestamps).
 */

/** How each base table is addressed by `get` and ordered by `list` and `fingerprint`. */
const TABLES: Record<GuildTableType, { key: readonly string[]; numericKey?: true }> = {
	goal: { key: ["id"] },
	project: { key: ["id"] },
	requirement: { key: ["id"] },
	plan: { key: ["id"] },
	task: { key: ["id"] },
	bug: { key: ["id"] },
	coverage: { key: ["id"] },
	inspection: { key: ["id"] },
	doc: { key: ["slug"] },
	review_finding: { key: ["id"], numericKey: true },
	graph_node: { key: ["id"] },
	gate: { key: ["node_id"] },
	work_log: { key: ["id"], numericKey: true },
	task_dependency: { key: ["task_id", "depends_on"] },
	task_capability: { key: ["task_id", "capability"] },
	graph_edge: { key: ["from_node", "to_node"] },
	graph_deviation: { key: ["id"], numericKey: true },
	knowledge_edge: { key: ["id"], numericKey: true },
	doc_revision: { key: ["id"], numericKey: true },
	event: { key: ["id"], numericKey: true },
	inspection_coverage: { key: ["inspection_id", "coverage_id"] },
	guild_state: { key: ["key"] },
};

function defaultOrder(type: GuildTableType): OrderBy[] {
	return TABLES[type].key.map((col) => ({ col, dir: "asc" }));
}

export const GET_TYPES = [
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
] as const satisfies readonly GuildTableType[];

const keyInput = z.union([z.string().min(1), z.number().int()]).describe("Guild key (doc slug, finding id, node id …)");

/** A task with its capability rows and direct dependencies (contract §4.2 `get`). */
export async function withTaskExtras(row: GuildRow, workspaceId: string): Promise<GuildRow> {
	const key = String(row["id"]);
	const caps = await readRows(db, guildTable("task_capability"), workspaceId, {
		where: { task_id: key },
		orderBy: [{ col: "capability" }],
		limit: 500,
	});
	const deps = await readRows(db, guildTable("task_dependency"), workspaceId, {
		where: { task_id: key },
		orderBy: [{ col: "depends_on" }],
		limit: 500,
	});
	return {
		...row,
		capabilities: caps.rows.map((c) => ({ capability: c["capability"], required: c["required"] === 1 })),
		depends_on: deps.rows.map((d) => d["depends_on"]),
	};
}

const readView = defineTool({
	name: "read_view",
	title: "Read a guild view",
	description:
		"Read one guild v_* view (v_brief, v_board, v_next_task, v_ready_nodes, …) for the workspace. Page with offset until next_offset is null.",
	input: z.object({
		workspace: workspaceInput,
		view: z.enum(GUILD_VIEW_NAMES),
		where: whereInput.optional(),
		order_by: orderByInput.optional(),
		limit: limitInput.optional(),
		offset: offsetInput.optional(),
	}),
	readOnly: true,
	handler: async ({ caller }, input) => {
		await assertWorkspace(caller, input.workspace);
		const page = await readRows(db, guildView(input.view), input.workspace, {
			where: input.where,
			orderBy: input.order_by,
			limit: input.limit,
			offset: input.offset,
		});
		return { ...page };
	},
});

const get = defineTool({
	name: "get",
	title: "Get one guild row",
	description:
		"One row by its guild key: goal/project/requirement/plan/task/bug/inspection key, coverage id, doc slug, finding id, node id (graph_node, gate). Tasks include capabilities and depends_on.",
	input: z.object({ workspace: workspaceInput, type: z.enum(GET_TYPES), key: keyInput }),
	readOnly: true,
	handler: async ({ caller }, { workspace, type, key }) => {
		await assertWorkspace(caller, workspace);
		const meta = TABLES[type];
		const col = meta.key[0] as string;
		if (meta.numericKey && !/^\d+$/.test(String(key))) {
			throw new GuildError("VALIDATION", `A ${type} key is an integer id.`);
		}
		const row = await readRow(db, guildTable(type), workspace, { [col]: meta.numericKey ? Number(key) : String(key) });
		if (!row) throw new GuildError("NOT_FOUND", `${type} ${key} not found in this workspace.`);
		return type === "task" ? withTaskExtras(row, workspace) : row;
	},
});

const list = defineTool({
	name: "list",
	title: "List guild rows",
	description:
		"Rows of a guild base table, with the same where/order_by/limit/offset rules as read_view. Foreign-key columns hold and filter by guild keys.",
	input: z.object({
		workspace: workspaceInput,
		type: z.enum(GUILD_TABLE_TYPES),
		where: whereInput.optional(),
		order_by: orderByInput.optional(),
		limit: limitInput.optional(),
		offset: offsetInput.optional(),
	}),
	readOnly: true,
	handler: async ({ caller }, input) => {
		await assertWorkspace(caller, input.workspace);
		const page = await readRows(db, guildTable(input.type), input.workspace, {
			where: input.where,
			orderBy: input.order_by,
			defaultOrder: defaultOrder(input.type),
			limit: input.limit,
			offset: input.offset,
		});
		return { ...page };
	},
});

const searchDocs = defineTool({
	name: "search_docs",
	title: "Search the library",
	description:
		"Docs whose title or body contains `query` — case-insensitive and literal (% _ \\ are plain characters).",
	input: z.object({
		workspace: workspaceInput,
		query: z.string().trim().min(1, "query must not be empty").max(500),
		kind: z.enum(DOC_KINDS).optional(),
		limit: limitInput.optional(),
	}),
	readOnly: true,
	handler: async ({ caller }, { workspace, query, kind, limit }) => {
		await assertWorkspace(caller, workspace);
		const needle = query.toLowerCase();
		const page = await readRows(db, guildTable("doc"), workspace, {
			where: kind ? { kind } : undefined,
			extra: [sql`(strpos(lower(title), ${needle}) > 0 OR strpos(lower(body), ${needle}) > 0)`],
			orderBy: [
				{ col: "updated_at", dir: "desc" },
				{ col: "slug", dir: "asc" },
			],
			limit: limit ?? 50,
		});
		return { ...page };
	},
});

/** Tables in the fingerprint: every guild table except the feed, which is reported apart. */
const FINGERPRINT_TABLES = GUILD_TABLE_TYPES.filter((t) => t !== "event");

const fingerprint = defineTool({
	name: "fingerprint",
	title: "Board fingerprint",
	description:
		"Per-table row count, max key and a content digest, plus the event count and max id — release §9.a's before/after comparison.",
	input: z.object({ workspace: workspaceInput }),
	readOnly: true,
	handler: async ({ caller }, { workspace }) => {
		await assertWorkspace(caller, workspace);
		// One statement, one snapshot.
		const parts = FINGERPRINT_TABLES.map((type) => {
			const keyCols = TABLES[type].key.map((c) => sql`${sql.identifier(c)}::text`);
			const keyExpr = keyCols.length === 1 ? keyCols[0]! : sql`concat_ws('/', ${sql.join(keyCols, sql`, `)})`;
			const maxKey = TABLES[type].numericKey
				? sql`MAX(${sql.identifier(TABLES[type].key[0] as string)})::text`
				: sql`MAX(${keyExpr} COLLATE "C")`;
			return sql`SELECT ${type}::text AS t, COUNT(*)::int AS count, ${maxKey} AS max_key,
				md5(COALESCE(string_agg(to_jsonb(r)::text, E'\n' ORDER BY ${keyExpr} COLLATE "C"), '')) AS digest
				FROM ${sql.identifier(guildTable(type))} r WHERE r.workspace_id = ${workspace}`;
		});
		const result = await db.execute(sql`
			${sql.join(parts, sql` UNION ALL `)}
			UNION ALL SELECT 'event', COUNT(*)::int, MAX(id)::text, '' FROM kumiai_event WHERE workspace_id = ${workspace}`);
		const tables: Record<string, { count: number; max_key: string | number | null; digest: string }> = {};
		let events = { count: 0, max_id: null as number | null };
		for (const row of result.rows) {
			const t = String(row["t"]);
			const count = Number(row["count"]);
			const rawMax = row["max_key"] === null ? null : String(row["max_key"]);
			if (t === "event") {
				events = { count, max_id: rawMax === null ? null : Number(rawMax) };
				continue;
			}
			const numeric = TABLES[t as GuildTableType].numericKey === true;
			tables[t] = {
				count,
				max_key: rawMax === null ? null : numeric ? Number(rawMax) : rawMax,
				digest: String(row["digest"]),
			};
		}
		return { tables, events };
	},
});

/** Contract §4.2 — read_view, get, list, search_docs, fingerprint. */
export const readsTools: GuildToolDef[] = [readView, get, list, searchDocs, fingerprint];
