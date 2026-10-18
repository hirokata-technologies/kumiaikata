import { pgTable, text, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { teams } from "./teams.js";
import { kumiaiWorkspaces } from "./kumiai-workspaces.js";

export const kumiaiGoals = pgTable(
	"kumiai_goals",
	{
		id: text("id").primaryKey(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			// A workspace that still has goals cannot be deleted out from under them.
			.references(() => kumiaiWorkspaces.id, { onDelete: "restrict" }),
		title: text("title").notNull(),
		body: text("body").notNull().default(""),
		status: text("status", { enum: ["todo", "in-progress", "done"] }).notNull(),
		priority: integer("priority").notNull(),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		index("kumiai_goals_team_idx").on(t.teamId),
		index("kumiai_goals_workspace_idx").on(t.workspaceId),
		check("kumiai_goals_priority_check", sql`${t.priority} BETWEEN 1 AND 5`),
	],
);
