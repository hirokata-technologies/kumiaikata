import { pgTable, text, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { teams } from "./teams.js";
import { kumiaiRequirements } from "./kumiai-requirements.js";
import { kumiaiPlans } from "./kumiai-plans.js";

export const kumiaiTasks = pgTable(
	"kumiai_tasks",
	{
		id: text("id").primaryKey(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		requirementId: text("requirement_id")
			.notNull()
			.references(() => kumiaiRequirements.id, { onDelete: "cascade" }),
		planId: text("plan_id").references(() => kumiaiPlans.id, { onDelete: "set null" }),
		title: text("title").notNull(),
		objective: text("objective").notNull().default(""),
		body: text("body").notNull().default(""),
		status: text("status", {
			enum: ["todo", "in-progress", "done", "failed", "blocked", "waived"],
		}).notNull(),
		priority: integer("priority").notNull(),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		index("kumiai_tasks_team_idx").on(t.teamId),
		index("kumiai_tasks_requirement_idx").on(t.requirementId),
		index("kumiai_tasks_status_idx").on(t.status),
		check("kumiai_tasks_priority_check", sql`${t.priority} BETWEEN 1 AND 5`),
	],
);
