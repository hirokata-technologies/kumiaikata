import { pgTable, text, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { kumiaiProjects } from "./kumiai-projects.js";

export const kumiaiRecentProjects = pgTable(
	"kumiai_recent_projects",
	{
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => kumiaiProjects.id, { onDelete: "cascade" }),
		openedAt: timestamp("opened_at").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.projectId] }),
		index("kumiai_recent_projects_user_opened_idx").on(t.userId, t.openedAt),
	],
);
