import { beforeEach, describe, expect, it } from "vitest";
import type { GuildCaller, GuildToolDef } from "../../src/guild/registry.js";
import { libraryTools } from "../../src/guild/tools/library.js";
import { seedUser } from "../helpers/seed.js";
import { addRequirement, addTask, all, seedGuildBoard, type GuildBoard, type Keyed } from "../helpers/guild.js";

const tools = new Map<string, GuildToolDef>(libraryTools.map((t) => [t.name, t]));

async function call(caller: GuildCaller, name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
	const tool = tools.get(name);
	if (!tool) throw new Error(`no tool ${name}`);
	return tool.handler({ caller }, tool.input.parse(input));
}

let board: GuildBoard;
let caller: GuildCaller;
let userId: string;
let ws: string;
let req: Keyed;

const events = (verb: string) =>
	all<{ actor: string; subject_type: string; subject_id: string; payload: Record<string, unknown> }>(
		`SELECT actor, subject_type, subject_id, payload FROM kumiai_event WHERE workspace_id = $1 AND verb = $2 ORDER BY id`,
		[ws, verb],
	);
const doc = (slug: string, extra: Record<string, unknown> = {}) =>
	call(caller, "upsert_doc", { workspace: ws, actor: "librarian", slug, title: `T ${slug}`, body: `B ${slug}`, ...extra });

beforeEach(async () => {
	board = await seedGuildBoard();
	ws = board.workspaceId;
	userId = (await seedUser()).id;
	caller = { userId, teamId: board.teamId };
	req = await addRequirement(board, { title: "Sessions" });
});

describe("upsert_doc", () => {
	it("creates with defaults, then rewrites as a patch with a revision", async () => {
		const created = await doc("adr-sessions", { kind: "decision", area: "auth", source: "strategist", body: "## Context\n;|x" });
		expect(created).toMatchObject({
			slug: "adr-sessions",
			kind: "decision",
			status: "current",
			area: "auth",
			source: "strategist",
			body: "## Context\n;|x",
		});
		expect(created).not.toHaveProperty("key");
		const plain = await doc("plain");
		expect(plain).toMatchObject({ kind: "reference", status: "current", area: "", source: "" });

		const rewritten = await call(caller, "upsert_doc", {
			workspace: ws,
			actor: "librarian",
			slug: "adr-sessions",
			title: "Sessions in Redis",
			body: "v2",
		});
		expect(rewritten).toMatchObject({ title: "Sessions in Redis", body: "v2", kind: "decision", area: "auth", status: "current" });
		const revisions = await all<{ body: string }>(`SELECT body FROM kumiai_doc_revision WHERE slug = 'adr-sessions'`);
		expect(revisions.map((r) => r.body)).toEqual(["## Context\n;|x"]);
		expect((await events("documented")).map((e) => [e.actor, e.subject_id])).toEqual([
			["strategist", "adr-sessions"],
			["librarian", "plain"],
			["strategist", "adr-sessions"],
		]);
	});

	it("validates the vocabulary", () => {
		const parse = (kind: string) =>
			tools.get("upsert_doc")!.input.safeParse({ workspace: ws, actor: "a", slug: "s", title: "t", body: "b", kind }).success;
		expect(parse("adr")).toBe(false);
		expect(parse("decision")).toBe(true);
	});
});

describe("link / unlink", () => {
	beforeEach(async () => {
		await doc("adr-sessions", { kind: "decision" });
	});
	const linkInput = (to: Record<string, unknown>, rel = "decides") => ({
		workspace: ws,
		actor: "strategist",
		rel,
		from: { type: "doc", id: "adr-sessions" },
		to,
	});

	it("links existing ends, idempotently", async () => {
		const edge = await call(caller, "link", { ...linkInput({ type: "requirement", id: req.key }), note: "gate-plan" });
		expect(edge).toMatchObject({
			rel: "decides",
			from_type: "doc",
			from_id: "adr-sessions",
			to_type: "requirement",
			to_id: req.key,
			note: "gate-plan",
			created_by: "strategist",
		});
		const again = await call(caller, "link", linkInput({ type: "requirement", id: req.key }));
		expect(again["id"]).toBe(edge["id"]);
		expect(await all(`SELECT 1 FROM kumiai_knowledge_edge`)).toHaveLength(1);
		expect(await events("linked")).toHaveLength(1);
	});

	it("links to a finding by its integer id", async () => {
		const task = await addTask(board, req.id);
		const { id } = (
			await all<{ id: string }>(
				`INSERT INTO kumiai_review_finding (task_id, reviewer, severity, summary, created_at) VALUES ($1, 'r', 'major', 's', now()) RETURNING id`,
				[task.id],
			)
		)[0]!;
		const edge = await call(caller, "link", {
			workspace: ws,
			actor: "qa",
			rel: "evidence-for",
			from: { type: "review_finding", id: Number(id) },
			to: { type: "doc", id: "adr-sessions" },
		});
		expect(edge["from_id"]).toBe(String(id));
	});

	it("is NOT_FOUND when either end is missing, VALIDATION for a bad pairing", async () => {
		await expect(call(caller, "link", linkInput({ type: "requirement", id: "REQ-404" }))).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(
			call(caller, "link", {
				workspace: ws,
				actor: "s",
				rel: "decides",
				from: { type: "doc", id: "nope" },
				to: { type: "requirement", id: req.key },
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		// nothing describes a document: describes must come FROM a doc
		await expect(
			call(caller, "link", {
				workspace: ws,
				actor: "s",
				rel: "describes",
				from: { type: "requirement", id: req.key },
				to: { type: "doc", id: "adr-sessions" },
			}),
		).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(call(caller, "link", linkInput({ type: "doc", id: "adr-sessions" }, "refines"))).rejects.toMatchObject({
			code: "VALIDATION",
		});
		expect(await all(`SELECT 1 FROM kumiai_knowledge_edge`)).toHaveLength(0);
	});

	it("unlinks the edge, and is NOT_FOUND the second time", async () => {
		await doc("old");
		await call(caller, "link", linkInput({ type: "doc", id: "old" }, "supersedes"));
		const removed = await call(caller, "unlink", linkInput({ type: "doc", id: "old" }, "supersedes"));
		expect(removed).toMatchObject({ rel: "supersedes", to_id: "old", unlinked: true });
		expect(await all(`SELECT 1 FROM kumiai_knowledge_edge`)).toHaveLength(0);
		const unlinked = await events("unlinked");
		expect(unlinked).toHaveLength(1);
		expect(unlinked[0]!.actor).toBe("strategist");
		await expect(call(caller, "unlink", linkInput({ type: "doc", id: "old" }, "supersedes"))).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("supersede_doc", () => {
	it("writes the new doc, the edge and retires the old one, atomically", async () => {
		await doc("adr-sessions", { kind: "decision", area: "auth" });
		const out = (await call(caller, "supersede_doc", {
			workspace: ws,
			actor: "strategist",
			old_slug: "adr-sessions",
			new: { slug: "adr-sessions-v2", title: "Sessions move to Postgres", body: "## Context" },
			note: "Redis was a second store",
		})) as Record<string, Record<string, unknown>>;
		expect(out["new"]).toMatchObject({ slug: "adr-sessions-v2", kind: "decision", area: "auth", status: "current" });
		expect(out["old"]).toMatchObject({ slug: "adr-sessions", status: "superseded" });
		expect(out["edge"]).toMatchObject({
			rel: "supersedes",
			from_id: "adr-sessions-v2",
			to_id: "adr-sessions",
			note: "Redis was a second store",
		});
		const current = await all<{ slug: string }>(`SELECT slug FROM kumiai_v_doc_current WHERE workspace_id = $1`, [ws]);
		expect(current.map((r) => r.slug)).toEqual(["adr-sessions-v2"]);
	});

	it("supersedes with a doc a member already wrote, leaving it as written", async () => {
		await doc("adr-sessions", { kind: "decision", area: "auth" });
		await doc("adr-sessions-v2", { kind: "decision", area: "auth" });
		const before = await all<{ body: string }>(`SELECT body FROM kumiai_doc WHERE slug = 'adr-sessions-v2'`);
		const out = (await call(caller, "supersede_doc", {
			workspace: ws,
			actor: "orchestrator",
			old_slug: "adr-sessions",
			new: { slug: "adr-sessions-v2" },
		})) as Record<string, Record<string, unknown>>;
		expect(out["old"]).toMatchObject({ slug: "adr-sessions", status: "superseded" });
		expect(out["new"]).toMatchObject({ slug: "adr-sessions-v2", status: "current" });
		expect(out["edge"]).toMatchObject({ rel: "supersedes", from_id: "adr-sessions-v2", to_id: "adr-sessions", created_by: "orchestrator" });
		expect(await all(`SELECT body FROM kumiai_doc WHERE slug = 'adr-sessions-v2'`)).toEqual(before);
		expect(await all(`SELECT 1 FROM kumiai_doc_revision`)).toHaveLength(0);
	});

	it("refuses half a new doc, and a missing one without its content", async () => {
		await doc("old");
		await expect(
			call(caller, "supersede_doc", { workspace: ws, actor: "o", old_slug: "old", new: { slug: "fresh", title: "t" } }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(
			call(caller, "supersede_doc", { workspace: ws, actor: "o", old_slug: "old", new: { slug: "fresh" } }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(await all(`SELECT status FROM kumiai_doc WHERE slug = 'old'`)).toEqual([{ status: "current" }]);
	});

	it("writes nothing when the old doc is missing", async () => {
		await expect(
			call(caller, "supersede_doc", {
				workspace: ws,
				actor: "s",
				old_slug: "nope",
				new: { slug: "fresh", title: "t", body: "b" },
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(await all(`SELECT 1 FROM kumiai_doc`)).toHaveLength(0);
		await doc("same");
		await expect(
			call(caller, "supersede_doc", { workspace: ws, actor: "s", old_slug: "same", new: { slug: "same", title: "t", body: "b" } }),
		).rejects.toMatchObject({ code: "VALIDATION" });
	});
});

describe("doc_neighbors", () => {
	it("returns one hop in both directions, filterable by rel", async () => {
		await doc("adr", { kind: "decision" });
		await doc("adr-v2", { kind: "decision" });
		await call(caller, "link", {
			workspace: ws,
			actor: "s",
			rel: "decides",
			from: { type: "doc", id: "adr" },
			to: { type: "requirement", id: req.key },
		});
		await call(caller, "link", {
			workspace: ws,
			actor: "s",
			rel: "supersedes",
			from: { type: "doc", id: "adr-v2" },
			to: { type: "doc", id: "adr" },
		});
		const n = (await call(caller, "doc_neighbors", { workspace: ws, type: "doc", id: "adr" })) as {
			rows: Record<string, unknown>[];
		};
		expect(n.rows.map((r) => [r["direction"], r["rel"], r["other_type"], r["other_id"], r["other_title"]])).toEqual([
			["in", "supersedes", "doc", "adr-v2", "T adr-v2"],
			["out", "decides", "requirement", req.key, "Sessions"],
		]);
		expect(n.rows[0]!["created_at"]).toMatch(/Z$/);
		const fromWork = (await call(caller, "doc_neighbors", {
			workspace: ws,
			type: "requirement",
			id: req.key,
			rel: "decides",
		})) as { rows: Record<string, unknown>[] };
		expect(fromWork.rows.map((r) => [r["direction"], r["other_id"]])).toEqual([["in", "adr"]]);
		const filtered = (await call(caller, "doc_neighbors", { workspace: ws, type: "doc", id: "adr", rel: "refines" })) as {
			rows: unknown[];
		};
		expect(filtered.rows).toEqual([]);
		await expect(call(caller, "doc_neighbors", { workspace: ws, type: "doc", id: "nope" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("record_event", () => {
	it("writes the guild's explicit events with actor and user", async () => {
		const e = await call(caller, "record_event", {
			workspace: ws,
			actor: "orchestrator",
			verb: "started",
			subject_type: "shift",
			subject_id: "SHIFT-20261018T020000Z",
			payload: { max_tasks: 10, max_minutes: 60, requirement: null },
		});
		expect(e).toMatchObject({
			actor: "orchestrator",
			verb: "started",
			subject_type: "shift",
			subject_id: "SHIFT-20261018T020000Z",
			payload: { max_tasks: 10, max_minutes: 60, requirement: null },
			user_id: userId,
		});
		expect(typeof e["id"]).toBe("number");
		expect(e["ts"]).toMatch(/Z$/);
		const released = await call(caller, "record_event", {
			workspace: ws,
			actor: "orchestrator",
			verb: "released",
			subject_type: "release",
			subject_id: "v1.2.0",
		});
		expect(released["payload"]).toEqual({});
	});

	it("refuses verbs the triggers own and malformed names", async () => {
		await expect(
			call(caller, "record_event", { workspace: ws, actor: "o", verb: "moved", subject_type: "task", subject_id: "TASK-001" }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		const parse = (input: Record<string, unknown>) =>
			tools.get("record_event")!.input.safeParse({ workspace: ws, actor: "o", subject_id: "x", ...input }).success;
		expect(parse({ verb: "Started", subject_type: "shift" })).toBe(false);
		expect(parse({ verb: "started", subject_type: "shift; drop" })).toBe(false);
		expect(parse({ verb: "started", subject_type: "shift", payload: [1] })).toBe(false);
	});
});

describe("workspace scope", () => {
	it("every library tool is FORBIDDEN in another team's workspace", async () => {
		const stranger = (await seedGuildBoard()).workspaceId;
		const end = { type: "doc", id: "a" };
		const inputs: [string, Record<string, unknown>][] = [
			["upsert_doc", { actor: "a", slug: "s", title: "t", body: "b" }],
			["link", { actor: "a", rel: "refines", from: end, to: { type: "doc", id: "b" } }],
			["unlink", { actor: "a", rel: "refines", from: end, to: { type: "doc", id: "b" } }],
			["supersede_doc", { actor: "a", old_slug: "a", new: { slug: "b", title: "t", body: "b" } }],
			["doc_neighbors", { type: "doc", id: "a" }],
			["record_event", { actor: "a", verb: "started", subject_type: "shift", subject_id: "S" }],
		];
		for (const [name, input] of inputs) {
			await expect(call(caller, name, { workspace: stranger, ...input })).rejects.toMatchObject({ code: "FORBIDDEN" });
		}
	});
});
