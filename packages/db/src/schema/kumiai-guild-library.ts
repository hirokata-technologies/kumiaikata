import { pgTable, text, bigint, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { teams } from "./teams.js";
import { kumiaiWorkspaces } from "./kumiai-workspaces.js";
import { DOC_KINDS, DOC_STATUSES, KNOWLEDGE_RELS, KNOWLEDGE_TYPES } from "../guild-vocab.js";
import { oneOf } from "./guild-checks.js";

/** guild `doc` — the library's nodes, keyed by `slug` (unique per workspace). */
export const kumiaiDoc = pgTable(
	"kumiai_doc",
	{
		id: text("id").primaryKey(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "cascade" }),
		slug: text("slug").notNull(),
		title: text("title").notNull(),
		body: text("body").notNull(),
		kind: text("kind", { enum: DOC_KINDS }).notNull().default("reference"),
		status: text("status", { enum: DOC_STATUSES }).notNull().default("current"),
		/** Free key ('auth', 'billing'). Deliberately not CHECKed. */
		area: text("area").notNull().default(""),
		/** Who/what produced it. */
		source: text("source").notNull().default(""),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		uniqueIndex("kumiai_doc_workspace_slug_idx").on(t.workspaceId, t.slug),
		index("kumiai_doc_kind_idx").on(t.workspaceId, t.kind, t.status),
		index("kumiai_doc_area_idx").on(t.workspaceId, t.area, t.kind),
		check("kumiai_doc_kind_check", oneOf(t.kind, DOC_KINDS)),
		check("kumiai_doc_status_check", oneOf(t.status, DOC_STATUSES)),
		check("kumiai_doc_slug_check", sql`length(${t.slug}) > 0`),
	],
);

/**
 * guild `knowledge_edge` — ONE ROW IS ONE ASSERTION: <from> --rel--> <to>. Endpoints are
 * POLYMORPHIC guild keys (doc slug, REQ-001, TASK-001, coverage key, finding id as text…),
 * so there is no foreign key on either end; `kumiai_v_knowledge_dangling` stands in for it.
 */
export const kumiaiKnowledgeEdge = pgTable(
	"kumiai_knowledge_edge",
	{
		id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "cascade" }),
		rel: text("rel", { enum: KNOWLEDGE_RELS }).notNull(),
		fromType: text("from_type", { enum: KNOWLEDGE_TYPES }).notNull(),
		fromId: text("from_id").notNull(),
		toType: text("to_type", { enum: KNOWLEDGE_TYPES }).notNull(),
		toId: text("to_id").notNull(),
		note: text("note").notNull().default(""),
		createdBy: text("created_by").notNull(),
		createdAt: timestamp("created_at").notNull(),
	},
	(t) => [
		uniqueIndex("kumiai_knowledge_edge_tuple_idx").on(
			t.workspaceId,
			t.rel,
			t.fromType,
			t.fromId,
			t.toType,
			t.toId,
		),
		index("kumiai_knowledge_edge_out_idx").on(t.workspaceId, t.fromType, t.fromId, t.rel),
		index("kumiai_knowledge_edge_in_idx").on(t.workspaceId, t.toType, t.toId, t.rel),
		check("kumiai_knowledge_edge_rel_check", oneOf(t.rel, KNOWLEDGE_RELS)),
		check("kumiai_knowledge_edge_from_type_check", oneOf(t.fromType, KNOWLEDGE_TYPES)),
		check("kumiai_knowledge_edge_to_type_check", oneOf(t.toType, KNOWLEDGE_TYPES)),
		// A self-edge is never an assertion, it is a typo
		check(
			"kumiai_knowledge_edge_self_check",
			sql`${t.fromType} <> ${t.toType} OR ${t.fromId} <> ${t.toId}`,
		),
		// doc-to-doc relations are doc-to-doc
		check(
			"kumiai_knowledge_edge_doc_doc_check",
			sql`${t.rel} NOT IN ('supersedes', 'refines', 'depends-on', 'contradicts') OR (${t.fromType} = 'doc' AND ${t.toType} = 'doc')`,
		),
		// a document describes or decides something. Nothing describes a document
		check(
			"kumiai_knowledge_edge_from_doc_check",
			sql`${t.rel} NOT IN ('describes', 'decides', 'derived-from') OR ${t.fromType} = 'doc'`,
		),
		// evidence points AT a document
		check("kumiai_knowledge_edge_evidence_check", sql`${t.rel} <> 'evidence-for' OR ${t.toType} = 'doc'`),
	],
);

/**
 * guild `doc_revision` — the body BEFORE a change, written by a trigger. No FK to the doc on
 * purpose: a revision must survive its document.
 */
export const kumiaiDocRevision = pgTable(
	"kumiai_doc_revision",
	{
		id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "cascade" }),
		slug: text("slug").notNull(),
		title: text("title").notNull(),
		body: text("body").notNull(),
		kind: text("kind").notNull(),
		status: text("status").notNull(),
		replacedAt: timestamp("replaced_at").notNull(),
	},
	(t) => [index("kumiai_doc_revision_slug_idx").on(t.workspaceId, t.slug, t.replacedAt.desc())],
);
