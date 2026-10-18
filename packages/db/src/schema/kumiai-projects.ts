import { pgTable, text, integer, boolean, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { teams } from "./teams.js";
import { kumiaiGoals } from "./kumiai-goals.js";
import { kumiaiWorkspaces } from "./kumiai-workspaces.js";
import { KUMIAI_PROJECT_PRIORITIES, KUMIAI_PROJECT_STATUSES, PROJECT_ISOLATIONS } from "../guild-vocab.js";
import { keyShape, oneOf } from "./guild-checks.js";

export const kumiaiProjects = pgTable(
	"kumiai_projects",
	{
		id: text("id").primaryKey(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		/** Always the goal's workspace (enforced by the kumiai_a_scope trigger). */
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "restrict" }),
		/** Guild key, `PROJ-001`. Unique per workspace. */
		key: text("key").notNull(),
		goalId: text("goal_id")
			.notNull()
			// Deleting a goal that still has projects is rejected, not cascaded —
			// a cascade here would silently destroy every requirement, plan and task beneath it.
			.references(() => kumiaiGoals.id, { onDelete: "restrict" }),
		title: text("title").notNull(),
		body: text("body").notNull().default(""),
		ordinal: integer("ordinal"),
		status: text("status", { enum: KUMIAI_PROJECT_STATUSES }).notNull(),
		priority: text("priority", { enum: KUMIAI_PROJECT_PRIORITIES }).notNull(),
		impact: integer("impact").notNull(),
		effort: integer("effort").notNull(),
		targetWindowKind: text("target_window_kind", { enum: ["week", "month", "quarter"] }),
		targetWindowLabel: text("target_window_label"),
		targetWindowYear: integer("target_window_year"),
		targetWindowNumber: integer("target_window_number"),
		blockedReason: text("blocked_reason"),
		/** Guild: may run beside its siblings and never waits its turn. */
		concurrent: boolean("concurrent").notNull().default(false),
		/** Guild: `shared` working tree, or its own git `worktree`. */
		isolation: text("isolation", { enum: PROJECT_ISOLATIONS }).notNull().default("shared"),
		/** Guild: the worktree checkout. Only a `worktree` project may carry one. */
		worktreePath: text("worktree_path"),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		index("kumiai_projects_team_idx").on(t.teamId),
		index("kumiai_projects_goal_idx").on(t.goalId, t.ordinal),
		index("kumiai_projects_status_idx").on(t.status),
		uniqueIndex("kumiai_projects_workspace_key_idx").on(t.workspaceId, t.key),
		check("kumiai_projects_impact_check", sql`${t.impact} BETWEEN 1 AND 100`),
		check("kumiai_projects_effort_check", sql`${t.effort} BETWEEN 1 AND 10`),
		check(
			"kumiai_projects_blocked_reason_check",
			sql`${t.status} <> 'blocked' OR (${t.blockedReason} IS NOT NULL AND length(trim(${t.blockedReason})) > 0)`,
		),
		check(
			"kumiai_projects_target_window_check",
			sql`(${t.targetWindowKind} IS NULL AND ${t.targetWindowLabel} IS NULL AND ${t.targetWindowYear} IS NULL AND ${t.targetWindowNumber} IS NULL)
				OR (${t.targetWindowKind} IS NOT NULL AND ${t.targetWindowLabel} IS NOT NULL AND ${t.targetWindowYear} IS NOT NULL AND ${t.targetWindowNumber} IS NOT NULL)`,
		),
		check("kumiai_projects_status_check", oneOf(t.status, KUMIAI_PROJECT_STATUSES)),
		check("kumiai_projects_priority_check", oneOf(t.priority, KUMIAI_PROJECT_PRIORITIES)),
		check("kumiai_projects_isolation_check", oneOf(t.isolation, PROJECT_ISOLATIONS)),
		// A path on a shared project is a statement nobody honours.
		check(
			"kumiai_projects_worktree_path_check",
			sql`${t.isolation} = 'worktree' OR ${t.worktreePath} IS NULL`,
		),
		check("kumiai_projects_key_check", keyShape(t.key, "PROJ")),
	],
);
