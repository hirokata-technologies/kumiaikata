import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
	db,
	DOC_KINDS,
	DOC_STATUSES,
	KNOWLEDGE_RELS,
	KNOWLEDGE_TYPES,
	kumiaiDoc,
	kumiaiKnowledgeEdge,
	newId,
	toIsoUtc,
	type GuildTx,
	type KnowledgeRel,
	type KnowledgeType,
	type SqlExecutor,
} from "@kata/db";
import {
	GuildError,
	actorInput,
	assertWorkspace,
	defineTool,
	guildWrite,
	workspaceInput,
	type GuildCaller,
	type GuildToolDef,
} from "../registry.js";
import { guildTable, readRow, type GuildRow } from "../services/rows.js";
import { mustRow } from "../services/writes.js";

/**
 * Contract §4.7 (the library: docs and the knowledge graph) and §4.8 (record_event). The
 * doc triggers write the `documented`/`moved` events and the doc_revision snapshot; the edge
 * triggers write `linked`/`unlinked`.
 */

const NOW = sql`kumiai_utc_now()`;
const slugInput = z.string().trim().min(1).max(200).describe("Doc slug, e.g. adr-session-store");

// ── Docs ─────────────────────────────────────────────────────────────────────

interface DocFields {
	slug: string;
	title: string;
	body: string;
	kind?: (typeof DOC_KINDS)[number] | undefined;
	status?: (typeof DOC_STATUSES)[number] | undefined;
	area?: string | undefined;
	source?: string | undefined;
}

/** Insert a doc, or patch it (title and body always; the rest only when given). */
async function upsertDocRow(
	tx: GuildTx,
	caller: GuildCaller,
	workspaceId: string,
	doc: DocFields,
	defaults: { kind?: (typeof DOC_KINDS)[number]; area?: string } = {},
): Promise<GuildRow> {
	const [current] = await tx
		.select({ id: kumiaiDoc.id })
		.from(kumiaiDoc)
		.where(and(eq(kumiaiDoc.workspaceId, workspaceId), eq(kumiaiDoc.slug, doc.slug)))
		.for("update");
	if (!current) {
		await tx.insert(kumiaiDoc).values({
			id: newId(),
			teamId: caller.teamId,
			workspaceId,
			slug: doc.slug,
			title: doc.title,
			body: doc.body,
			kind: doc.kind ?? defaults.kind ?? "reference",
			status: doc.status ?? "current",
			area: doc.area ?? defaults.area ?? "",
			source: doc.source ?? "",
			createdAt: NOW,
			updatedAt: NOW,
		});
	} else {
		const patch: Partial<typeof kumiaiDoc.$inferInsert> = { title: doc.title, body: doc.body };
		if (doc.kind !== undefined) patch.kind = doc.kind;
		if (doc.status !== undefined) patch.status = doc.status;
		if (doc.area !== undefined) patch.area = doc.area;
		if (doc.source !== undefined) patch.source = doc.source;
		await tx.update(kumiaiDoc).set(patch).where(eq(kumiaiDoc.id, current.id));
	}
	return mustRow(await readRow(tx, guildTable("doc"), workspaceId, { slug: doc.slug }), "doc");
}

const upsertDoc = defineTool({
	name: "upsert_doc",
	title: "Write a doc",
	description:
		"Create or rewrite a library doc by slug. A rewrite snapshots the previous body into doc_revision; omitted fields keep their value (leave `status` out of a rewrite). New docs default to kind 'reference', status 'current'.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		slug: slugInput,
		title: z.string().trim().min(1),
		body: z.string(),
		kind: z.enum(DOC_KINDS).optional(),
		status: z.enum(DOC_STATUSES).optional(),
		area: z.string().max(100).optional(),
		source: z.string().max(100).optional(),
	}),
	handler: async ({ caller }, i) =>
		guildWrite(caller, i.workspace, i.actor, (tx) => upsertDocRow(tx, caller, i.workspace, i)),
});

// ── The knowledge graph ──────────────────────────────────────────────────────

const endpointInput = z.object({
	type: z.enum(KNOWLEDGE_TYPES),
	id: z.union([z.string().trim().min(1), z.number().int()]).transform(String),
});
type Endpoint = { type: KnowledgeType; id: string };

/** The referential check the guild does by hand: the endpoint exists in this workspace. */
async function assertEndpoint(exec: SqlExecutor, workspaceId: string, end: Endpoint): Promise<void> {
	const result = await exec.execute(sql`
		SELECT 1 FROM kumiai_v_knowledge_ref
		 WHERE workspace_id = ${workspaceId} AND ref_type = ${end.type} AND ref_id = ${end.id} LIMIT 1`);
	if (result.rows.length === 0) throw new GuildError("NOT_FOUND", `${end.type} ${end.id} not found in this workspace.`);
}

function edgeTuple(workspaceId: string, rel: KnowledgeRel, from: Endpoint, to: Endpoint) {
	return and(
		eq(kumiaiKnowledgeEdge.workspaceId, workspaceId),
		eq(kumiaiKnowledgeEdge.rel, rel),
		eq(kumiaiKnowledgeEdge.fromType, from.type),
		eq(kumiaiKnowledgeEdge.fromId, from.id),
		eq(kumiaiKnowledgeEdge.toType, to.type),
		eq(kumiaiKnowledgeEdge.toId, to.id),
	);
}

/** Insert the edge unless its tuple exists (idempotent), and return it in guild shape. */
async function linkEdge(
	tx: GuildTx,
	caller: GuildCaller,
	workspaceId: string,
	actor: string,
	rel: KnowledgeRel,
	from: Endpoint,
	to: Endpoint,
	note: string | undefined,
): Promise<GuildRow> {
	await assertEndpoint(tx, workspaceId, from);
	await assertEndpoint(tx, workspaceId, to);
	await tx
		.insert(kumiaiKnowledgeEdge)
		.values({
			teamId: caller.teamId,
			workspaceId,
			rel,
			fromType: from.type,
			fromId: from.id,
			toType: to.type,
			toId: to.id,
			note: note ?? "",
			createdBy: actor,
			createdAt: NOW,
		})
		.onConflictDoNothing();
	const [edge] = await tx
		.select({ id: kumiaiKnowledgeEdge.id })
		.from(kumiaiKnowledgeEdge)
		.where(edgeTuple(workspaceId, rel, from, to));
	return mustRow(await readRow(tx, guildTable("knowledge_edge"), workspaceId, { id: mustRow(edge, "edge").id }), "edge");
}

const link = defineTool({
	name: "link",
	title: "Link two library/work rows",
	description:
		"Assert <from> --rel--> <to> in the knowledge graph. Both ends must exist in the workspace (NOT_FOUND); rel/type pairings are enforced (VALIDATION). Idempotent on (rel, from, to).",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		rel: z.enum(KNOWLEDGE_RELS),
		from: endpointInput,
		to: endpointInput,
		note: z.string().max(2000).optional(),
	}),
	handler: async ({ caller }, i) =>
		guildWrite(caller, i.workspace, i.actor, (tx) =>
			linkEdge(tx, caller, i.workspace, i.actor, i.rel, i.from, i.to, i.note),
		),
});

const unlink = defineTool({
	name: "unlink",
	title: "Unlink a knowledge edge",
	description: "Remove one knowledge edge (rel, from, to) — the library's one removal. NOT_FOUND when there is none.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		rel: z.enum(KNOWLEDGE_RELS),
		from: endpointInput,
		to: endpointInput,
	}),
	handler: async ({ caller }, i) =>
		guildWrite(caller, i.workspace, i.actor, async (tx) => {
			const [edge] = await tx
				.select({ id: kumiaiKnowledgeEdge.id })
				.from(kumiaiKnowledgeEdge)
				.where(edgeTuple(i.workspace, i.rel, i.from, i.to))
				.for("update");
			if (!edge) {
				throw new GuildError("NOT_FOUND", `No ${i.rel} edge ${i.from.type}:${i.from.id} -> ${i.to.type}:${i.to.id}.`);
			}
			const row = mustRow(await readRow(tx, guildTable("knowledge_edge"), i.workspace, { id: edge.id }), "edge");
			await tx.delete(kumiaiKnowledgeEdge).where(eq(kumiaiKnowledgeEdge.id, edge.id));
			return { ...row, unlinked: true };
		}),
});

/**
 * The superseding doc: written from `title` + `body`, or — both omitted — the doc a member
 * already wrote under that slug, left untouched. Either both are given or neither is.
 */
async function writeSupersedingDoc(
	tx: GuildTx,
	caller: GuildCaller,
	workspaceId: string,
	doc: Omit<DocFields, "title" | "body"> & { title?: string | undefined; body?: string | undefined },
	defaults: { kind?: (typeof DOC_KINDS)[number]; area?: string },
): Promise<GuildRow> {
	const { title, body } = doc;
	if (title !== undefined && body !== undefined) {
		return upsertDocRow(tx, caller, workspaceId, { ...doc, title, body }, defaults);
	}
	if (title !== undefined || body !== undefined) {
		throw new GuildError("VALIDATION", "Give new.title and new.body together, or omit both to supersede with an existing doc.");
	}
	const existing = await readRow(tx, guildTable("doc"), workspaceId, { slug: doc.slug });
	if (!existing) {
		throw new GuildError("NOT_FOUND", `doc ${doc.slug} not found in this workspace; give new.title and new.body to create it.`);
	}
	return existing;
}

const supersedeDoc = defineTool({
	name: "supersede_doc",
	title: "Supersede a doc",
	description:
		"Atomic: write the new doc, add `supersedes` new -> old, set the old doc's status to 'superseded'. The old row stays. A new doc inherits the old one's kind and area unless given. Omit `new.title` and `new.body` when `new.slug` already exists (a member wrote it and reported the supersession): the new doc is then left as written, and only the edge and the old doc's status move.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		old_slug: slugInput,
		new: z.object({
			slug: slugInput,
			title: z.string().trim().min(1).optional(),
			body: z.string().optional(),
			kind: z.enum(DOC_KINDS).optional(),
			area: z.string().max(100).optional(),
			source: z.string().max(100).optional(),
		}),
		note: z.string().max(2000).optional(),
	}),
	handler: async ({ caller }, i) =>
		guildWrite(caller, i.workspace, i.actor, async (tx) => {
			if (i.new.slug === i.old_slug) throw new GuildError("VALIDATION", "A doc cannot supersede itself.");
			const [old] = await tx
				.select({ id: kumiaiDoc.id, kind: kumiaiDoc.kind, area: kumiaiDoc.area, status: kumiaiDoc.status })
				.from(kumiaiDoc)
				.where(and(eq(kumiaiDoc.workspaceId, i.workspace), eq(kumiaiDoc.slug, i.old_slug)))
				.for("update");
			if (!old) throw new GuildError("NOT_FOUND", `doc ${i.old_slug} not found in this workspace.`);
			const created = await writeSupersedingDoc(tx, caller, i.workspace, i.new, { kind: old.kind, area: old.area });
			const edge = await linkEdge(
				tx,
				caller,
				i.workspace,
				i.actor,
				"supersedes",
				{ type: "doc", id: i.new.slug },
				{ type: "doc", id: i.old_slug },
				i.note,
			);
			if (old.status !== "superseded") {
				await tx.update(kumiaiDoc).set({ status: "superseded" }).where(eq(kumiaiDoc.id, old.id));
			}
			const retired = mustRow(await readRow(tx, guildTable("doc"), i.workspace, { slug: i.old_slug }), "doc");
			return { new: created, old: retired, edge };
		}),
});

const docNeighbors = defineTool({
	name: "doc_neighbors",
	title: "Doc neighbours (one hop)",
	description:
		"Every knowledge edge touching one row, both directions, one hop (no traversal — loop and cap in the caller). Starts from a doc or any work row.",
	input: z.object({
		workspace: workspaceInput,
		type: z.enum(KNOWLEDGE_TYPES),
		id: z.union([z.string().trim().min(1), z.number().int()]).transform(String),
		rel: z.enum(KNOWLEDGE_RELS).optional(),
	}),
	readOnly: true,
	handler: async ({ caller }, { workspace, type, id, rel }) => {
		await assertWorkspace(caller, workspace);
		await assertEndpoint(db, workspace, { type, id });
		const relCond = rel === undefined ? sql`` : sql`AND k.rel = ${rel}`;
		const result = await db.execute(sql`
			SELECT * FROM (
				SELECT k.id, 'out'::text AS direction, k.rel, k.to_type AS other_type, k.to_id AS other_id,
				       COALESCE(r.title, '') AS other_title, k.note, k.created_by, k.created_at::text AS created_at
				  FROM kumiai_g_knowledge_edge k
				  LEFT JOIN kumiai_v_knowledge_ref r
				    ON r.workspace_id = k.workspace_id AND r.ref_type = k.to_type AND r.ref_id = k.to_id
				 WHERE k.workspace_id = ${workspace} AND k.from_type = ${type} AND k.from_id = ${id} ${relCond}
				UNION ALL
				SELECT k.id, 'in', k.rel, k.from_type, k.from_id, COALESCE(r.title, ''), k.note, k.created_by,
				       k.created_at::text
				  FROM kumiai_g_knowledge_edge k
				  LEFT JOIN kumiai_v_knowledge_ref r
				    ON r.workspace_id = k.workspace_id AND r.ref_type = k.from_type AND r.ref_id = k.from_id
				 WHERE k.workspace_id = ${workspace} AND k.to_type = ${type} AND k.to_id = ${id} ${relCond}
			) n
			ORDER BY direction COLLATE "C", rel COLLATE "C", other_type COLLATE "C", other_id COLLATE "C", id`);
		const rows = result.rows.map((r) => ({
			...r,
			id: Number(r["id"]),
			created_at: toIsoUtc(String(r["created_at"])),
		}));
		return { type, id, rows };
	},
});

// ── §4.8 The feed ────────────────────────────────────────────────────────────

/** Verbs the warehouse triggers own. A hand-written one would forge the feed (kumiai.md §7). */
const TRIGGER_VERBS = new Set([
	"created",
	"moved",
	"node-moved",
	"decided",
	"claimed",
	"logged",
	"found",
	"dispositioned",
	"documented",
	"linked",
	"unlinked",
	"deleted",
	"inspected",
	"deviated",
	"isolated",
	"approved",
]);

const recordEvent = defineTool({
	name: "record_event",
	title: "Record an explicit event",
	description:
		"The guild's explicit INSERT INTO event — a shift's started/ended, a release's `released`. Verbs the triggers own (created, moved, decided, …) are refused: every write tool already records its own.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		verb: z
			.string()
			.trim()
			.regex(/^[a-z][a-z0-9-]{0,63}$/, "verb is lowercase letters, digits and '-'"),
		subject_type: z
			.string()
			.trim()
			.regex(/^[a-z][a-z0-9_]{0,63}$/, "subject_type is lowercase letters, digits and '_'"),
		subject_id: z.string().trim().min(1).max(200),
		payload: z.record(z.string(), z.unknown()).optional(),
	}),
	handler: async ({ caller }, i) => {
		if (TRIGGER_VERBS.has(i.verb)) {
			throw new GuildError("VALIDATION", `"${i.verb}" events are written by the warehouse itself; use the write tool.`);
		}
		return guildWrite(caller, i.workspace, i.actor, async (tx) => {
			const result = await tx.execute(sql`
				INSERT INTO kumiai_event (team_id, workspace_id, ts, actor, user_id, verb, subject_type, subject_id, payload)
				VALUES (${caller.teamId}, ${i.workspace}, kumiai_utc_clock(), ${i.actor},
				        (SELECT u.id FROM users u WHERE u.id = ${caller.userId}),
				        ${i.verb}, ${i.subject_type}, ${i.subject_id}, ${JSON.stringify(i.payload ?? {})}::jsonb)
				RETURNING id`);
			const id = Number(mustRow(result.rows[0], "event")["id"]);
			return mustRow(await readRow(tx, guildTable("event"), i.workspace, { id }), "event");
		});
	},
});

/** Contract §4.7 — docs and edges; §4.8 — record_event. */
export const libraryTools: GuildToolDef[] = [upsertDoc, link, unlink, supersedeDoc, docNeighbors, recordEvent];
