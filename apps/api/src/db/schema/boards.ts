import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { teams } from "./teams.js";

export const boards = pgTable(
	"boards",
	{
		id: text("id").primaryKey(),
		kind: text("kind", { enum: ["personal", "team"] }).notNull(),
		title: text("title").notNull(),
		// nullable FK — personal boards set ownerId, team boards set teamId
		ownerId: text("owner_id").references(() => users.id, { onDelete: "cascade" }),
		teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		index("boards_owner_idx").on(t.ownerId),
		index("boards_team_idx").on(t.teamId),
	],
);
