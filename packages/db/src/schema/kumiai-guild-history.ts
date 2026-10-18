import { pgTable, text, integer, bigint, jsonb, timestamp, index, primaryKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { teams } from "./teams.js";
import { users } from "./auth.js";
import { kumiaiWorkspaces } from "./kumiai-workspaces.js";

/**
 * guild `event` — WRITTEN BY TRIGGERS (see packages/db/GUILD.md). Append-only: never UPDATE or
 * DELETE. `subject_id` is the subject's guild key (TASK-001, a doc slug, a node id…), so the
 * feed reads identically to the guild's. `actor` is the guild member name from the
 * transaction-local `kumiai.actor` setting; `user_id` is the authenticated Kumiai user from
 * `kumiai.user_id`. `verb` is deliberately not CHECKed.
 */
export const kumiaiEvent = pgTable(
	"kumiai_event",
	{
		id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "cascade" }),
		ts: timestamp("ts", { precision: 3 }).notNull(),
		actor: text("actor").notNull(),
		userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
		verb: text("verb").notNull(),
		subjectType: text("subject_type").notNull(),
		subjectId: text("subject_id").notNull(),
		payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
	},
	(t) => [
		index("kumiai_event_recent_idx").on(t.workspaceId, t.ts.desc()),
		index("kumiai_event_subject_idx").on(t.workspaceId, t.subjectType, t.subjectId),
		check("kumiai_event_payload_check", sql`jsonb_typeof(${t.payload}) = 'object'`),
	],
);

/**
 * guild `guild_state` — small key/value facts per workspace. `last-checkin` and `actor` are
 * seeded for every workspace by a trigger. (In Kumiai the per-call `actor` comes from the
 * `kumiai.actor` setting, not from this table.)
 */
export const kumiaiGuildState = pgTable(
	"kumiai_guild_state",
	{
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "cascade" }),
		key: text("key").notNull(),
		value: text("value").notNull().default(""),
	},
	(t) => [primaryKey({ columns: [t.workspaceId, t.key] })],
);

/**
 * Per-workspace key counters for GOAL-001 / REQ-002 / … `next` is the number the next
 * allocation returns. Allocate through `kumiai_allocate_key(workspace_id, prefix)` (or the
 * `allocateKey` helper), which upserts this row under a row lock — atomic under concurrency.
 */
export const kumiaiKeyCounters = pgTable(
	"kumiai_key_counters",
	{
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "cascade" }),
		prefix: text("prefix").notNull(),
		next: integer("next").notNull().default(1),
	},
	(t) => [
		primaryKey({ columns: [t.workspaceId, t.prefix] }),
		check("kumiai_key_counters_prefix_check", sql`${t.prefix} ~ '^[A-Z]+$'`),
		check("kumiai_key_counters_next_check", sql`${t.next} >= 1`),
	],
);
