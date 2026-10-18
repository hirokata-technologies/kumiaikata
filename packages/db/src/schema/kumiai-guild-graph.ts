import { pgTable, text, bigint, timestamp, index, uniqueIndex, primaryKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { teams } from "./teams.js";
import { kumiaiWorkspaces } from "./kumiai-workspaces.js";
import { kumiaiRequirements } from "./kumiai-requirements.js";
import { kumiaiTasks } from "./kumiai-tasks.js";
import {
	GATE_KINDS,
	GATE_STATUSES,
	GRAPH_DEVIATION_KINDS,
	GRAPH_NODE_KINDS,
	GRAPH_NODE_STATUSES,
} from "../guild-vocab.js";
import { oneOf } from "./guild-checks.js";

/**
 * guild `graph_node`. `key` is the guild-visible node id, `<REQ key>/<node_key>` or, for a
 * fanned node, `<REQ key>/<node_key>.<suffix>` (e.g. `REQ-001/implement.TASK-011`); unique per
 * workspace and composed by the caller. `node_key` holds the template key only ('implement').
 */
export const kumiaiGraphNode = pgTable(
	"kumiai_graph_node",
	{
		id: text("id").primaryKey(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "cascade" }),
		key: text("key").notNull(),
		requirementId: text("requirement_id")
			.notNull()
			.references(() => kumiaiRequirements.id, { onDelete: "cascade" }),
		nodeKey: text("node_key").notNull(),
		kind: text("kind", { enum: GRAPH_NODE_KINDS }).notNull(),
		taskId: text("task_id").references(() => kumiaiTasks.id, { onDelete: "set null" }),
		parallelGroup: text("parallel_group"),
		status: text("status", { enum: GRAPH_NODE_STATUSES }).notNull().default("pending"),
	},
	(t) => [
		uniqueIndex("kumiai_graph_node_workspace_key_idx").on(t.workspaceId, t.key),
		// guild UNIQUE (requirement_id, node_key, task_id) — NULL task ids are distinct, as in SQLite.
		uniqueIndex("kumiai_graph_node_req_node_task_idx").on(t.requirementId, t.nodeKey, t.taskId),
		index("kumiai_graph_node_req_status_idx").on(t.requirementId, t.status),
		check("kumiai_graph_node_kind_check", oneOf(t.kind, GRAPH_NODE_KINDS)),
		check("kumiai_graph_node_status_check", oneOf(t.status, GRAPH_NODE_STATUSES)),
		check("kumiai_graph_node_key_check", sql`position('/' in ${t.key}) > 1`),
	],
);

export const kumiaiGraphEdge = pgTable(
	"kumiai_graph_edge",
	{
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "cascade" }),
		/** The requirement whose graph this edge belongs to (filled from `from_node` when omitted). */
		requirementId: text("requirement_id")
			.notNull()
			.references(() => kumiaiRequirements.id, { onDelete: "cascade" }),
		fromNode: text("from_node")
			.notNull()
			.references(() => kumiaiGraphNode.id, { onDelete: "cascade" }),
		toNode: text("to_node")
			.notNull()
			.references(() => kumiaiGraphNode.id, { onDelete: "cascade" }),
	},
	(t) => [
		primaryKey({ columns: [t.fromNode, t.toNode] }),
		index("kumiai_graph_edge_to_idx").on(t.toNode),
		index("kumiai_graph_edge_workspace_idx").on(t.workspaceId),
		index("kumiai_graph_edge_requirement_idx").on(t.requirementId),
		// a self-edge stalls the node forever
		check("kumiai_graph_edge_self_check", sql`${t.fromNode} <> ${t.toNode}`),
	],
);

/** Any departure from the template, WITH A REASON. `id` is the guild's integer id. */
export const kumiaiGraphDeviation = pgTable(
	"kumiai_graph_deviation",
	{
		id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "cascade" }),
		requirementId: text("requirement_id")
			.notNull()
			.references(() => kumiaiRequirements.id, { onDelete: "cascade" }),
		kind: text("kind", { enum: GRAPH_DEVIATION_KINDS }).notNull(),
		nodeKey: text("node_key").notNull(),
		reason: text("reason").notNull(),
		createdAt: timestamp("created_at").notNull(),
	},
	(t) => [
		index("kumiai_graph_deviation_req_idx").on(t.requirementId),
		check("kumiai_graph_deviation_kind_check", oneOf(t.kind, GRAPH_DEVIATION_KINDS)),
		check("kumiai_graph_deviation_reason_check", sql`length(trim(${t.reason})) > 0`),
	],
);

/** A gate is an ordinary graph node whose status a HUMAN writes. One row per gate node. */
export const kumiaiGate = pgTable(
	"kumiai_gate",
	{
		nodeId: text("node_id")
			.primaryKey()
			.references(() => kumiaiGraphNode.id, { onDelete: "cascade" }),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "cascade" }),
		/** Always the gate node's requirement (filled from `node_id` when omitted). */
		requirementId: text("requirement_id")
			.notNull()
			.references(() => kumiaiRequirements.id, { onDelete: "cascade" }),
		prompt: text("prompt").notNull(),
		kind: text("kind", { enum: GATE_KINDS }).notNull().default("approve"),
		status: text("status", { enum: GATE_STATUSES }).notNull().default("pending"),
		/** Free text / JSON of selections. */
		decision: text("decision"),
		decidedAt: timestamp("decided_at"),
	},
	(t) => [
		index("kumiai_gate_workspace_idx").on(t.workspaceId, t.status),
		index("kumiai_gate_requirement_idx").on(t.requirementId),
		check("kumiai_gate_kind_check", oneOf(t.kind, GATE_KINDS)),
		check("kumiai_gate_status_check", oneOf(t.status, GATE_STATUSES)),
	],
);
