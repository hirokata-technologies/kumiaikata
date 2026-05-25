import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { teams } from "./teams.js";
import { users } from "./auth.js";

export const teamMembers = pgTable(
	"team_members",
	{
		id: text("id").primaryKey(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		role: text("role", { enum: ["admin", "member"] }).notNull(),
		joinedAt: timestamp("joined_at").notNull(),
	},
	(t) => [
		uniqueIndex("team_members_team_user_uniq").on(t.teamId, t.userId),
		index("team_members_team_idx").on(t.teamId),
		index("team_members_user_idx").on(t.userId),
	],
);
