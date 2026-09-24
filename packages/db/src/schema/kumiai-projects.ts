import { pgTable, text, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { teams } from "./teams.js";
import { kumiaiGoals } from "./kumiai-goals.js";

export const kumiaiProjects = pgTable(
	"kumiai_projects",
	{
		id: text("id").primaryKey(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		goalId: text("goal_id")
			.notNull()
			// Deleting a goal that still has projects is rejected, not cascaded —
			// a cascade here would silently destroy every requirement, plan and task beneath it.
			.references(() => kumiaiGoals.id, { onDelete: "restrict" }),
		title: text("title").notNull(),
		body: text("body").notNull().default(""),
		ordinal: integer("ordinal"),
		status: text("status", {
			enum: ["backlog", "todo", "in-progress", "blocked", "done"],
		}).notNull(),
		priority: text("priority", { enum: ["urgent", "high", "medium", "low"] }).notNull(),
		impact: integer("impact").notNull(),
		effort: integer("effort").notNull(),
		targetWindowKind: text("target_window_kind", { enum: ["week", "month", "quarter"] }),
		targetWindowLabel: text("target_window_label"),
		targetWindowYear: integer("target_window_year"),
		targetWindowNumber: integer("target_window_number"),
		blockedReason: text("blocked_reason"),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		index("kumiai_projects_team_idx").on(t.teamId),
		index("kumiai_projects_goal_idx").on(t.goalId),
		index("kumiai_projects_status_idx").on(t.status),
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
	],
);
