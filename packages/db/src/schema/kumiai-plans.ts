import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { teams } from "./teams.js";
import { kumiaiRequirements } from "./kumiai-requirements.js";

export const kumiaiPlans = pgTable(
	"kumiai_plans",
	{
		id: text("id").primaryKey(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		requirementId: text("requirement_id")
			.notNull()
			.references(() => kumiaiRequirements.id, { onDelete: "cascade" }),
		// No .references() to avoid circular FK with kumiai_tasks — kumiai_tasks.plan_id
		// is the real FK direction; both sides are nullable.
		taskId: text("task_id"),
		title: text("title").notNull(),
		body: text("body").notNull().default(""),
		status: text("status", { enum: ["todo", "in-progress", "done"] }).notNull(),
		approval: text("approval", { enum: ["pending", "approved", "rejected"] }).notNull(),
		approvedBy: text("approved_by"),
		approvedAt: timestamp("approved_at"),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		index("kumiai_plans_team_idx").on(t.teamId),
		index("kumiai_plans_requirement_idx").on(t.requirementId),
	],
);
