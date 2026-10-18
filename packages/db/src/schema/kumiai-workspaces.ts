import { pgTable, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { teams } from "./teams.js";

/**
 * A planning workspace inside a team. Goals (and everything beneath them) belong to exactly
 * one workspace. Every team has one `isDefault` workspace named "default".
 */
export const kumiaiWorkspaces = pgTable(
	"kumiai_workspaces",
	{
		id: text("id").primaryKey(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		isDefault: boolean("is_default").notNull().default(false),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		index("kumiai_workspaces_team_idx").on(t.teamId),
		uniqueIndex("kumiai_workspaces_team_name_idx").on(t.teamId, t.name),
		uniqueIndex("kumiai_workspaces_one_default_idx")
			.on(t.teamId)
			.where(sql`${t.isDefault}`),
	],
);
