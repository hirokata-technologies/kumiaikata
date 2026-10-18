import { pgTable, text, integer, bigint, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { teams } from "./teams.js";
import { kumiaiWorkspaces } from "./kumiai-workspaces.js";
import { kumiaiRequirements } from "./kumiai-requirements.js";
import { kumiaiTasks } from "./kumiai-tasks.js";
import {
	BUG_SEVERITIES,
	BUG_STATUSES,
	FINDING_DISPOSITIONS,
	FINDING_SEVERITIES,
} from "../guild-vocab.js";
import { keyShape, oneOf } from "./guild-checks.js";

/**
 * guild `work_log` — append-only. The orchestrator's waiver lives here as an entry beginning
 * `Skipped by user` (see kumiai_v_failed_tasks).
 */
export const kumiaiWorkLog = pgTable(
	"kumiai_work_log",
	{
		id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "cascade" }),
		taskId: text("task_id")
			.notNull()
			.references(() => kumiaiTasks.id, { onDelete: "cascade" }),
		ts: timestamp("ts").notNull(),
		agent: text("agent").notNull(),
		entry: text("entry").notNull(),
	},
	(t) => [index("kumiai_work_log_task_idx").on(t.taskId, t.ts)],
);

/** guild `review_finding`. `id` is the guild's integer id (what `update_finding` takes). */
export const kumiaiReviewFinding = pgTable(
	"kumiai_review_finding",
	{
		id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "cascade" }),
		taskId: text("task_id")
			.notNull()
			.references(() => kumiaiTasks.id, { onDelete: "cascade" }),
		reviewer: text("reviewer").notNull(),
		severity: text("severity", { enum: FINDING_SEVERITIES }).notNull(),
		summary: text("summary").notNull(),
		detail: text("detail").notNull().default(""),
		file: text("file"),
		line: integer("line"),
		disposition: text("disposition", { enum: FINDING_DISPOSITIONS }).notNull().default("open"),
		fixTaskId: text("fix_task_id").references(() => kumiaiTasks.id, { onDelete: "set null" }),
		/** Where the fix lives when it was not a guild ticket: a sha, a PR url, a release. */
		fixRef: text("fix_ref").notNull().default(""),
		createdAt: timestamp("created_at").notNull(),
	},
	(t) => [
		index("kumiai_review_finding_task_idx").on(t.taskId, t.disposition),
		index("kumiai_review_finding_workspace_idx").on(t.workspaceId, t.disposition),
		check("kumiai_review_finding_severity_check", oneOf(t.severity, FINDING_SEVERITIES)),
		check("kumiai_review_finding_disposition_check", oneOf(t.disposition, FINDING_DISPOSITIONS)),
	],
);

/** guild `bug`. `key` is `BUG-001`, unique per workspace. */
export const kumiaiBug = pgTable(
	"kumiai_bug",
	{
		id: text("id").primaryKey(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "cascade" }),
		key: text("key").notNull(),
		title: text("title").notNull(),
		body: text("body").notNull().default(""),
		repro: text("repro").notNull().default(""),
		severity: text("severity", { enum: BUG_SEVERITIES }).notNull().default("major"),
		status: text("status", { enum: BUG_STATUSES }).notNull().default("open"),
		/** Agent name or 'user'. */
		foundBy: text("found_by"),
		requirementId: text("requirement_id").references(() => kumiaiRequirements.id, {
			onDelete: "set null",
		}),
		fixTaskId: text("fix_task_id").references(() => kumiaiTasks.id, { onDelete: "set null" }),
		fixRef: text("fix_ref").notNull().default(""),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		uniqueIndex("kumiai_bug_workspace_key_idx").on(t.workspaceId, t.key),
		index("kumiai_bug_status_idx").on(t.workspaceId, t.status, t.severity),
		check("kumiai_bug_severity_check", oneOf(t.severity, BUG_SEVERITIES)),
		check("kumiai_bug_status_check", oneOf(t.status, BUG_STATUSES)),
		check("kumiai_bug_key_check", keyShape(t.key, "BUG")),
	],
);
