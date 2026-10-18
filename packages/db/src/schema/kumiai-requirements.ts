import { pgTable, text, integer, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { teams } from "./teams.js";
import { kumiaiProjects } from "./kumiai-projects.js";
import { kumiaiWorkspaces } from "./kumiai-workspaces.js";
import { GUILD_DIRECTION_STATUSES } from "../guild-vocab.js";
import { keyShape, oneOf } from "./guild-checks.js";

export const kumiaiRequirements = pgTable(
	"kumiai_requirements",
	{
		id: text("id").primaryKey(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		/**
		 * The project's workspace when it has one. An unaffiliated requirement (no project)
		 * still belongs to exactly one workspace. Enforced by the kumiai_a_scope trigger.
		 */
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "restrict" }),
		/** Guild key, `REQ-001`. Unique per workspace. */
		key: text("key").notNull(),
		// nullable — unaffiliated work is legal per US-4's edge case
		projectId: text("project_id").references(() => kumiaiProjects.id, {
			onDelete: "set null",
		}),
		title: text("title").notNull(),
		body: text("body").notNull().default(""),
		status: text("status", { enum: GUILD_DIRECTION_STATUSES }).notNull(),
		priority: integer("priority").notNull(),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		index("kumiai_requirements_team_idx").on(t.teamId),
		index("kumiai_requirements_project_idx").on(t.projectId),
		uniqueIndex("kumiai_requirements_workspace_key_idx").on(t.workspaceId, t.key),
		check("kumiai_requirements_priority_check", sql`${t.priority} BETWEEN 1 AND 5`),
		check("kumiai_requirements_status_check", oneOf(t.status, GUILD_DIRECTION_STATUSES)),
		check("kumiai_requirements_key_check", keyShape(t.key, "REQ")),
	],
);
