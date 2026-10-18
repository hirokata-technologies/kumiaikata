import { pgTable, text, integer, jsonb, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { teams } from "./teams.js";
import { kumiaiRequirements } from "./kumiai-requirements.js";
import { kumiaiPlans } from "./kumiai-plans.js";
import { kumiaiWorkspaces } from "./kumiai-workspaces.js";
import { TASK_STATUSES } from "../guild-vocab.js";
import { keyShape, oneOf } from "./guild-checks.js";

export const kumiaiTasks = pgTable(
	"kumiai_tasks",
	{
		id: text("id").primaryKey(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		/** Always the requirement's workspace (kumiai_a_scope trigger). */
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "restrict" }),
		/** Guild key, `TASK-001`. Unique per workspace. */
		key: text("key").notNull(),
		requirementId: text("requirement_id")
			.notNull()
			.references(() => kumiaiRequirements.id, { onDelete: "cascade" }),
		planId: text("plan_id").references(() => kumiaiPlans.id, { onDelete: "set null" }),
		/**
		 * The file set this ticket touches. Disjointness across a `parallel_group` is an
		 * assertion by the architect, not a constraint.
		 */
		files: jsonb("files").$type<string[]>().notNull().default([]),
		parallelGroup: text("parallel_group"),
		/** The graph node key that produced it. */
		nodeKey: text("node_key"),
		title: text("title").notNull(),
		objective: text("objective").notNull().default(""),
		body: text("body").notNull().default(""),
		status: text("status", { enum: TASK_STATUSES }).notNull(),
		priority: integer("priority").notNull(),
		/** The pin: a subagent name from the guild roster. Not a foreign key. */
		agent: text("agent"),
		/** Who actually took it (a guild member name). */
		claimedBy: text("claimed_by"),
		claimedAt: timestamp("claimed_at"),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		index("kumiai_tasks_team_idx").on(t.teamId),
		index("kumiai_tasks_requirement_idx").on(t.requirementId, t.status),
		index("kumiai_tasks_status_idx").on(t.workspaceId, t.status, t.key),
		uniqueIndex("kumiai_tasks_workspace_key_idx").on(t.workspaceId, t.key),
		check("kumiai_tasks_priority_check", sql`${t.priority} BETWEEN 1 AND 5`),
		check("kumiai_tasks_status_check", oneOf(t.status, TASK_STATUSES)),
		check("kumiai_tasks_files_check", sql`jsonb_typeof(${t.files}) = 'array'`),
		check("kumiai_tasks_key_check", keyShape(t.key, "TASK")),
	],
);
