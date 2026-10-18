import { pgTable, text, boolean, index, primaryKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { teams } from "./teams.js";
import { kumiaiWorkspaces } from "./kumiai-workspaces.js";
import { kumiaiTasks } from "./kumiai-tasks.js";

/**
 * guild `task_dependency` — DIRECT predecessors only. Both ends are internal task ids; the
 * views expose the task keys.
 */
export const kumiaiTaskDependency = pgTable(
	"kumiai_task_dependency",
	{
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "cascade" }),
		taskId: text("task_id")
			.notNull()
			.references(() => kumiaiTasks.id, { onDelete: "cascade" }),
		dependsOn: text("depends_on")
			.notNull()
			.references(() => kumiaiTasks.id, { onDelete: "cascade" }),
	},
	(t) => [
		primaryKey({ columns: [t.taskId, t.dependsOn] }),
		index("kumiai_task_dependency_pred_idx").on(t.dependsOn),
		index("kumiai_task_dependency_workspace_idx").on(t.workspaceId),
		// self-dependency is always a mistake
		check("kumiai_task_dependency_self_check", sql`${t.taskId} <> ${t.dependsOn}`),
	],
);

/**
 * guild `task_capability` — what a ticket NEEDS. `required = true` decides eligibility,
 * `false` ("preferred") decides rank only. Alphabet: lowercase letters, digits and '-',
 * starting with a letter, 1–64 chars.
 */
export const kumiaiTaskCapability = pgTable(
	"kumiai_task_capability",
	{
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "cascade" }),
		taskId: text("task_id")
			.notNull()
			.references(() => kumiaiTasks.id, { onDelete: "cascade" }),
		capability: text("capability").notNull(),
		required: boolean("required").notNull().default(true),
	},
	(t) => [
		primaryKey({ columns: [t.taskId, t.capability] }),
		index("kumiai_task_capability_cap_idx").on(t.capability, t.required),
		index("kumiai_task_capability_workspace_idx").on(t.workspaceId),
		check(
			"kumiai_task_capability_capability_check",
			sql`length(${t.capability}) BETWEEN 1 AND 64 AND ${t.capability} ~ '^[a-z][a-z0-9-]*$'`,
		),
	],
);
