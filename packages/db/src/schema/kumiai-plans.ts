import { pgTable, text, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { teams } from "./teams.js";
import { kumiaiRequirements } from "./kumiai-requirements.js";
import { kumiaiWorkspaces } from "./kumiai-workspaces.js";
import { GUILD_DIRECTION_STATUSES, PLAN_APPROVALS } from "../guild-vocab.js";
import { keyShape, oneOf } from "./guild-checks.js";

export const kumiaiPlans = pgTable(
	"kumiai_plans",
	{
		id: text("id").primaryKey(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		/** Always the requirement's workspace (kumiai_a_scope trigger). */
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "restrict" }),
		/** Guild key, `PLAN-001`. Unique per workspace. */
		key: text("key").notNull(),
		requirementId: text("requirement_id")
			.notNull()
			.references(() => kumiaiRequirements.id, { onDelete: "cascade" }),
		// No .references() to avoid circular FK with kumiai_tasks — kumiai_tasks.plan_id
		// is the real FK direction; both sides are nullable.
		taskId: text("task_id"),
		title: text("title").notNull(),
		body: text("body").notNull().default(""),
		status: text("status", { enum: GUILD_DIRECTION_STATUSES }).notNull(),
		approval: text("approval", { enum: PLAN_APPROVALS }).notNull(),
		approvedBy: text("approved_by"),
		approvedAt: timestamp("approved_at"),
		/**
		 * The `gate-plan` graph node carrying the same decision (kumiai_graph_node.id). The FK
		 * (ON DELETE SET NULL) is declared in the migration's hand-written SQL rather than here,
		 * because plans → graph nodes → tasks → plans would be an import cycle.
		 */
		gateNodeId: text("gate_node_id"),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		index("kumiai_plans_team_idx").on(t.teamId),
		index("kumiai_plans_requirement_idx").on(t.requirementId),
		index("kumiai_plans_approval_idx").on(t.approval, t.requirementId),
		uniqueIndex("kumiai_plans_workspace_key_idx").on(t.workspaceId, t.key),
		check("kumiai_plans_status_check", oneOf(t.status, GUILD_DIRECTION_STATUSES)),
		check("kumiai_plans_approval_check", oneOf(t.approval, PLAN_APPROVALS)),
		check("kumiai_plans_key_check", keyShape(t.key, "PLAN")),
	],
);
