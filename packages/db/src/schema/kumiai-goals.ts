import { pgTable, text, integer, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { teams } from "./teams.js";
import { kumiaiWorkspaces } from "./kumiai-workspaces.js";
import { GUILD_DIRECTION_STATUSES } from "../guild-vocab.js";
import { keyShape, oneOf } from "./guild-checks.js";

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
		/** Guild key, `GOAL-001`. Unique per workspace; allocated by the server (see allocateKey). */
		key: text("key").notNull(),
		title: text("title").notNull(),
		body: text("body").notNull().default(""),
		status: text("status", { enum: GUILD_DIRECTION_STATUSES }).notNull(),
		priority: integer("priority").notNull(),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		index("kumiai_goals_team_idx").on(t.teamId),
		index("kumiai_goals_workspace_idx").on(t.workspaceId),
		uniqueIndex("kumiai_goals_workspace_key_idx").on(t.workspaceId, t.key),
		check("kumiai_goals_priority_check", sql`${t.priority} BETWEEN 1 AND 5`),
		check("kumiai_goals_status_check", oneOf(t.status, GUILD_DIRECTION_STATUSES)),
		check("kumiai_goals_key_check", keyShape(t.key, "GOAL")),
	],
);
