import { beforeEach, describe, expect, it } from "vitest";
import type { GuildCaller, GuildToolDef } from "../../src/guild/registry.js";
import { readsTools } from "../../src/guild/tools/reads.js";
import { libraryTools } from "../../src/guild/tools/library.js";
import { qualityTools } from "../../src/guild/tools/quality.js";
import { GUILD_VIEW_NAMES } from "../../src/guild/services/rows.js";
import { seedUser } from "../helpers/seed.js";
import {
	addCapability,
	addDependency,
	addRequirement,
	addTask,
	logWork,
	seedGuildBoard,
	type GuildBoard,
	type Keyed,
} from "../helpers/guild.js";
import { pool } from "../helpers/db.js";

const tools = new Map<string, GuildToolDef>([...readsTools, ...libraryTools, ...qualityTools].map((t) => [t.name, t]));

async function call(caller: GuildCaller, name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
	const tool = tools.get(name);
	if (!tool) throw new Error(`no tool ${name}`);
	return tool.handler({ caller }, tool.input.parse(input));
}

type Rows = { rows: Record<string, unknown>[]; next_offset: number | null };

let board: GuildBoard;
let caller: GuildCaller;
let req: Keyed;
let tasks: Keyed[];

beforeEach(async () => {
	board = await seedGuildBoard();
	const user = await seedUser();
	caller = { userId: user.id, teamId: board.teamId };
	req = await addRequirement(board, { title: "Session auth" });
	tasks = [];
	for (const [i, agent] of [null, "developer", null, "reviewer", null].entries()) {
		tasks.push(await addTask(board, req.id, { title: `Task ${i + 1}`, agent }));
	}
	await pool.query(`UPDATE kumiai_tasks SET priority = 1 WHERE id = $1`, [tasks[0]!.id]);
	await pool.query(`UPDATE kumiai_tasks SET priority = 5 WHERE id = $1`, [tasks[4]!.id]);
	await addCapability(tasks[0]!.id, "implement");
	await addCapability(tasks[0]!.id, "svelte", false);
	await addDependency(tasks[1]!.id, tasks[0]!.id);
});

describe("list + the Where builder", () => {
	const list = (input: Record<string, unknown>) =>
		call(caller, "list", { workspace: board.workspaceId, type: "task", ...input }) as Promise<Rows>;
	const ids = (r: Rows) => r.rows.map((row) => row["id"]);

	it("returns guild-shaped rows: keys, ISO timestamps, no workspace_id", async () => {
		const r = await list({});
		expect(ids(r)).toEqual(tasks.map((t) => t.key));
		const row = r.rows[0]!;
		expect(row["requirement_id"]).toBe(req.key);
		expect(row["key"]).toBe(row["id"]);
		expect(row["created_at"]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);
		expect(row).not.toHaveProperty("workspace_id");
		expect(row["kumiai_id"]).toBe(tasks[0]!.id);
		expect(r.next_offset).toBeNull();
	});

	it("scalar is equality, array is IN, FK columns filter by key", async () => {
		expect(ids(await list({ where: { id: tasks[2]!.key } }))).toEqual([tasks[2]!.key]);
		expect(ids(await list({ where: { id: [tasks[0]!.key, tasks[3]!.key] } }))).toEqual([tasks[0]!.key, tasks[3]!.key]);
		expect(ids(await list({ where: { id: [] } }))).toEqual([]);
		expect((await list({ where: { requirement_id: req.key } })).rows).toHaveLength(5);
	});

	it("supports every comparison op on integers", async () => {
		const prio = async (op: string, value: number) => ids(await list({ where: { priority: { op, value } } }));
		expect(await prio("=", 1)).toEqual([tasks[0]!.key]);
		expect(await prio("<>", 3)).toEqual([tasks[0]!.key, tasks[4]!.key]);
		expect(await prio("<", 3)).toEqual([tasks[0]!.key]);
		expect(await prio("<=", 3)).toHaveLength(4);
		expect(await prio(">", 3)).toEqual([tasks[4]!.key]);
		expect(await prio(">=", 3)).toHaveLength(4);
		expect(ids(await list({ where: { priority: "5" } }))).toEqual([tasks[4]!.key]);
	});

	it("like is case-sensitive with % _ and \\ escapes", async () => {
		await pool.query(`UPDATE kumiai_tasks SET title = 'Fix 100% of _bugs' WHERE id = $1`, [tasks[2]!.id]);
		expect(ids(await list({ where: { title: { op: "like", value: "Task %" } } }))).toHaveLength(4);
		expect(ids(await list({ where: { title: { op: "like", value: "task %" } } }))).toEqual([]);
		expect(ids(await list({ where: { title: { op: "like", value: "%100\\%%" } } }))).toEqual([tasks[2]!.key]);
		expect(ids(await list({ where: { title: { op: "like", value: "%\\_bugs" } } }))).toEqual([tasks[2]!.key]);
		expect(ids(await list({ where: { title: { op: "like", value: "Task _" } } }))).toHaveLength(4);
	});

	it("is_null / not_null (and a bare null)", async () => {
		expect(ids(await list({ where: { agent: { op: "is_null" } } }))).toEqual([tasks[0]!.key, tasks[2]!.key, tasks[4]!.key]);
		expect(ids(await list({ where: { agent: { op: "not_null" } } }))).toEqual([tasks[1]!.key, tasks[3]!.key]);
		expect(ids(await list({ where: { agent: null } }))).toHaveLength(3);
	});

	it("timestamps compare as instants", async () => {
		await pool.query(`UPDATE kumiai_tasks SET created_at = '2026-01-01 10:00:00' WHERE id = $1`, [tasks[0]!.id]);
		const before = await list({ where: { created_at: { op: "<", value: "2026-01-01T10:00:01Z" } } });
		expect(ids(before)).toEqual([tasks[0]!.key]);
		const offset = await list({ where: { created_at: { op: "<=", value: "2026-01-01T12:00:00+02:00" } } });
		expect(ids(offset)).toEqual([tasks[0]!.key]);
		expect(before.rows[0]!["created_at"]).toBe("2026-01-01T10:00:00Z");
	});

	it("ANDs conditions", async () => {
		const r = await list({ where: { agent: { op: "is_null" }, priority: { op: ">", value: 1 } } });
		expect(ids(r)).toEqual([tasks[2]!.key, tasks[4]!.key]);
	});

	it("unknown or forbidden columns are VALIDATION", async () => {
		for (const col of ["nope", "workspace_id", "id; DROP TABLE kumiai_tasks --", 'id" OR 1=1 --', "ID", "id)"]) {
			await expect(list({ where: { [col]: "x" } })).rejects.toMatchObject({ code: "VALIDATION" });
			await expect(list({ order_by: [{ col, dir: "asc" }] })).rejects.toMatchObject({ code: "VALIDATION" });
		}
		const { rows } = await pool.query(`SELECT count(*)::int AS n FROM kumiai_tasks`);
		expect(rows[0].n).toBe(5);
	});

	it("values are bound, never interpolated", async () => {
		expect((await list({ where: { title: "x' OR '1'='1" } })).rows).toEqual([]);
		expect((await list({ where: { title: { op: "like", value: "%' OR '1'='1" } } })).rows).toEqual([]);
	});

	it("rejects ill-typed values and ops", async () => {
		await expect(list({ where: { priority: "abc" } })).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(list({ where: { priority: { op: "like", value: "1%" } } })).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(list({ where: { priority: { op: ">" } } })).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(list({ where: { created_at: { op: ">", value: "yesterday" } } })).rejects.toMatchObject({
			code: "VALIDATION",
		});
		await expect(list({ where: { title: { op: "like", value: 5 } } })).rejects.toMatchObject({ code: "VALIDATION" });
		expect(tools.get("list")!.input.safeParse({ workspace: "w", type: "task", where: { id: { op: "~" } } }).success).toBe(
			false,
		);
		expect(tools.get("list")!.input.safeParse({ workspace: "w", type: "task", limit: 501 }).success).toBe(false);
		expect(tools.get("list")!.input.safeParse({ workspace: "w", type: "users" }).success).toBe(false);
	});

	it("orders by any column, both directions", async () => {
		const r = await list({ order_by: [{ col: "priority", dir: "desc" }, { col: "id", dir: "asc" }] });
		expect(ids(r)[0]).toBe(tasks[4]!.key);
		expect(ids(r).at(-1)).toBe(tasks[0]!.key);
	});

	it("pages with offset until next_offset is null", async () => {
		const seen: unknown[] = [];
		let offset: number | null = 0;
		const offsets: (number | null)[] = [];
		while (offset !== null) {
			const page: Rows = await list({ limit: 2, offset });
			seen.push(...ids(page));
			offsets.push(page.next_offset);
			offset = page.next_offset;
		}
		expect(offsets).toEqual([2, 4, null]);
		expect(seen).toEqual(tasks.map((t) => t.key));
		expect((await list({ limit: 5 })).next_offset).toBeNull();
	});

	it("covers the extra base tables", async () => {
		await logWork(tasks[0]!.id, "started");
		const listOf = (type: string, where?: Record<string, unknown>) =>
			call(caller, "list", { workspace: board.workspaceId, type, where }) as Promise<Rows>;
		expect((await listOf("task_dependency", { task_id: tasks[1]!.key })).rows).toEqual([
			{ task_id: tasks[1]!.key, depends_on: tasks[0]!.key },
		]);
		expect((await listOf("task_capability", { task_id: tasks[0]!.key })).rows).toEqual([
			{ task_id: tasks[0]!.key, capability: "implement", required: 1 },
			{ task_id: tasks[0]!.key, capability: "svelte", required: 0 },
		]);
		const log = await listOf("work_log", { task_id: tasks[0]!.key });
		expect(log.rows[0]).toMatchObject({ task_id: tasks[0]!.key, entry: "started", agent: "developer" });
		expect(typeof log.rows[0]!["id"]).toBe("number");
		const events = await listOf("event", { subject_type: "task", verb: "created" });
		expect(events.rows).toHaveLength(5);
		expect((await listOf("guild_state", { key: "last-checkin" })).rows).toEqual([{ key: "last-checkin", value: "null" }]);
		for (const type of ["graph_edge", "graph_deviation", "gate", "knowledge_edge", "doc_revision", "inspection_coverage"]) {
			expect((await listOf(type)).rows).toEqual([]);
		}
	});

	it("only ever sees its own workspace", async () => {
		const other = await seedGuildBoard({ teamId: board.teamId, workspaceName: "second" });
		const otherReq = await addRequirement(other);
		await addTask(other, otherReq.id, { title: "Elsewhere" });
		expect((await list({})).rows).toHaveLength(5);
		const second = (await call(caller, "list", { workspace: other.workspaceId, type: "task" })) as Rows;
		expect(second.rows.map((r) => r["title"])).toEqual(["Elsewhere"]);
	});
});

describe("read_view", () => {
	it("serves every guild view by its guild name", async () => {
		for (const view of GUILD_VIEW_NAMES) {
			const r = (await call(caller, "read_view", { workspace: board.workspaceId, view, limit: 500 })) as Rows;
			expect(Array.isArray(r.rows)).toBe(true);
		}
	});

	it("filters, orders and keeps the view's columns", async () => {
		const r = (await call(caller, "read_view", {
			workspace: board.workspaceId,
			view: "v_open_bounties",
			where: { requirement_id: req.key },
			order_by: [
				{ col: "priority", dir: "asc" },
				{ col: "id", dir: "asc" },
			],
		})) as Rows;
		expect(r.rows[0]).toEqual({
			id: tasks[0]!.key,
			requirement_id: req.key,
			priority: 1,
			agent: "-",
			who: "needs:implement",
			parallel_group: "",
			title: "Task 1",
		});
		const brief = (await call(caller, "read_view", {
			workspace: board.workspaceId,
			view: "v_brief",
			where: { fact: "tasks_todo" },
		})) as Rows;
		expect(brief.rows).toEqual([{ ord: expect.any(Number), fact: "tasks_todo", value: "5" }]);
	});

	it("rejects an unknown view and unknown columns", async () => {
		expect(tools.get("read_view")!.input.safeParse({ workspace: "w", view: "v_nope" }).success).toBe(false);
		expect(tools.get("read_view")!.input.safeParse({ workspace: "w", view: "kumiai_g_task" }).success).toBe(false);
		await expect(
			call(caller, "read_view", { workspace: board.workspaceId, view: "v_board", where: { nope: 1 } }),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});
});

describe("get", () => {
	it("returns a task with its capabilities and depends_on", async () => {
		const t0 = await call(caller, "get", { workspace: board.workspaceId, type: "task", key: tasks[0]!.key });
		expect(t0).toMatchObject({
			id: tasks[0]!.key,
			capabilities: [
				{ capability: "implement", required: true },
				{ capability: "svelte", required: false },
			],
			depends_on: [],
		});
		const t1 = await call(caller, "get", { workspace: board.workspaceId, type: "task", key: tasks[1]!.key });
		expect(t1["depends_on"]).toEqual([tasks[0]!.key]);
		expect(t1["capabilities"]).toEqual([]);
	});

	it("gets other types by their guild key", async () => {
		const r = await call(caller, "get", { workspace: board.workspaceId, type: "requirement", key: req.key });
		expect(r).toMatchObject({ id: req.key, title: "Session auth", project_id: null });
		await call(caller, "upsert_doc", { workspace: board.workspaceId, actor: "librarian", slug: "auth", title: "A", body: "b" });
		expect(await call(caller, "get", { workspace: board.workspaceId, type: "doc", key: "auth" })).toMatchObject({
			slug: "auth",
		});
		const finding = await call(caller, "add_finding", {
			workspace: board.workspaceId,
			actor: "reviewer-security",
			task: tasks[0]!.key,
			severity: "major",
			summary: "x",
		});
		const got = await call(caller, "get", { workspace: board.workspaceId, type: "review_finding", key: finding["id"] as number });
		expect(got["id"]).toBe(finding["id"]);
		await expect(
			call(caller, "get", { workspace: board.workspaceId, type: "review_finding", key: "TASK-001" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});

	it("is NOT_FOUND for a missing key or a key of another workspace", async () => {
		await expect(call(caller, "get", { workspace: board.workspaceId, type: "task", key: "TASK-404" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		const other = await seedGuildBoard({ teamId: board.teamId, workspaceName: "second" });
		const otherTask = await addTask(other, (await addRequirement(other)).id);
		expect(otherTask.key).toBe("TASK-001");
		const got = await call(caller, "get", { workspace: other.workspaceId, type: "task", key: "TASK-001" });
		expect(got["kumiai_id"]).toBe(otherTask.id);
	});
});

describe("search_docs", () => {
	beforeEach(async () => {
		const write = (slug: string, title: string, body: string, kind?: string) =>
			call(caller, "upsert_doc", { workspace: board.workspaceId, actor: "librarian", slug, title, body, kind });
		await write("refunds", "Refund rules", "Refunds over 100% are refused.", "business");
		await write("sessions", "Sessions live in Redis", "Call fail() when the store is down.", "decision");
		await write("misc", "Misc", "nothing_here");
	});
	const search = (input: Record<string, unknown>) =>
		call(caller, "search_docs", { workspace: board.workspaceId, ...input }) as Promise<Rows>;
	const slugs = (r: Rows) => r.rows.map((x) => x["slug"]).sort();

	it("matches title or body, case-insensitively", async () => {
		expect(slugs(await search({ query: "REDIS" }))).toEqual(["sessions"]);
		expect(slugs(await search({ query: "refused" }))).toEqual(["refunds"]);
	});

	it("is literal: % _ \\ and () are plain characters", async () => {
		expect(slugs(await search({ query: "%" }))).toEqual(["refunds"]);
		expect(slugs(await search({ query: "_" }))).toEqual(["misc"]);
		expect(slugs(await search({ query: "fail()" }))).toEqual(["sessions"]);
		expect(slugs(await search({ query: "\\" }))).toEqual([]);
	});

	it("filters by kind and refuses an empty query", async () => {
		expect(slugs(await search({ query: "e", kind: "decision" }))).toEqual(["sessions"]);
		expect(tools.get("search_docs")!.input.safeParse({ workspace: "w", query: "  " }).success).toBe(false);
	});
});

describe("fingerprint", () => {
	it("reports count and max key per table, and the feed", async () => {
		const fp = (await call(caller, "fingerprint", { workspace: board.workspaceId })) as {
			tables: Record<string, { count: number; max_key: unknown; digest: string }>;
			events: { count: number; max_id: number | null };
		};
		expect(fp.tables["task"]).toMatchObject({ count: 5, max_key: "TASK-005" });
		expect(fp.tables["requirement"]).toMatchObject({ count: 1, max_key: req.key });
		expect(fp.tables["task_dependency"]).toMatchObject({ count: 1, max_key: `${tasks[1]!.key}/${tasks[0]!.key}` });
		expect(fp.tables["work_log"]).toMatchObject({ count: 0, max_key: null });
		expect(fp.tables["guild_state"]!.count).toBe(2);
		expect(fp.tables).not.toHaveProperty("event");
		expect(fp.events.count).toBeGreaterThan(0);
		expect(typeof fp.events.max_id).toBe("number");

		// A status move changes the task digest but not its count or max key.
		await pool.query(`UPDATE kumiai_tasks SET status = 'blocked' WHERE id = $1`, [tasks[2]!.id]);
		const after = (await call(caller, "fingerprint", { workspace: board.workspaceId })) as typeof fp;
		expect(after.tables["task"]).toMatchObject({ count: 5, max_key: "TASK-005" });
		expect(after.tables["task"]!.digest).not.toBe(fp.tables["task"]!.digest);
		expect(after.tables["requirement"]).toEqual(fp.tables["requirement"]);
		expect(after.events.count).toBe(fp.events.count + 1);
	});
});

describe("workspace scope", () => {
	it("is FORBIDDEN for another team's workspace, on every read", async () => {
		const stranger = await seedGuildBoard();
		const ws = stranger.workspaceId;
		const inputs: [string, Record<string, unknown>][] = [
			["read_view", { workspace: ws, view: "v_board" }],
			["get", { workspace: ws, type: "task", key: "TASK-001" }],
			["list", { workspace: ws, type: "task" }],
			["search_docs", { workspace: ws, query: "x" }],
			["fingerprint", { workspace: ws }],
		];
		for (const [name, input] of inputs) {
			await expect(call(caller, name, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
		}
	});
});
