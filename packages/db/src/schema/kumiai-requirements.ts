import { pgTable, text, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { teams } from "./teams.js";
import { kumiaiProjects } from "./kumiai-projects.js";

export const kumiaiRequirements = pgTable(
	"kumiai_requirements",
	{
		id: text("id").primaryKey(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		// nullable — unaffiliated work is legal per US-4's edge case
		projectId: text("project_id").references(() => kumiaiProjects.id, {
			onDelete: "set null",
		}),
		title: text("title").notNull(),
		body: text("body").notNull().default(""),
		status: text("status", { enum: ["todo", "in-progress", "done"] }).notNull(),
		priority: integer("priority").notNull(),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		index("kumiai_requirements_team_idx").on(t.teamId),
		index("kumiai_requirements_project_idx").on(t.projectId),
		check("kumiai_requirements_priority_check", sql`${t.priority} BETWEEN 1 AND 5`),
	],
);
