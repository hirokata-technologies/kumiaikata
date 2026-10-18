import { and, eq } from "drizzle-orm";
import {
	kumiaiGate,
	kumiaiGraphDeviation,
	kumiaiGraphNode,
	kumiaiPlans,
	newId,
	type GateKind,
	type GraphDeviationKind,
	type GraphNodeKind,
	type GraphNodeStatus,
	type GuildTx,
} from "@kata/db";
import { GuildError } from "../registry.js";
import { findByKey, readGuildRows, utcNow, type GuildRow } from "./work-support.js";

/** Building blocks of the graph tools (contract §4.5). */

export interface NodeSpec {
	node_key: string;
	suffix?: string | undefined;
	kind: GraphNodeKind;
	task?: string | undefined;
	parallel_group?: string | undefined;
	status?: GraphNodeStatus | undefined;
	gate?: { prompt: string; kind?: GateKind | undefined } | undefined;
}

export interface GraphContext {
	teamId: string;
	workspaceId: string;
	/** The requirement's raw row (internal `id`, guild `key`). */
	requirement: GuildRow & { id: string };
}

/** `node_key`, or `node_key.suffix` for a fanned node — how edges name a node. */
export function nodeRef(spec: Pick<NodeSpec, "node_key" | "suffix">): string {
	return spec.suffix === undefined ? spec.node_key : `${spec.node_key}.${spec.suffix}`;
}

/**
 * Inserts one node (id `<REQ>/<nodeRef>`, `node_key` stored bare) and, for a gate node, its
 * gate row. Returns the node's internal id.
 */
export async function insertNode(tx: GuildTx, ctx: GraphContext, spec: NodeSpec): Promise<string> {
	if (spec.kind === "gate" && !spec.gate) {
		throw new GuildError("VALIDATION", `Gate node '${nodeRef(spec)}' needs gate.prompt.`);
	}
	if (spec.kind === "work" && spec.gate) {
		throw new GuildError("VALIDATION", `Work node '${nodeRef(spec)}' cannot carry a gate.`);
	}
	const taskId =
		spec.task === undefined ? null : (await findByKey(tx, "kumiai_tasks", ctx.workspaceId, spec.task)).id;
	const id = newId();
	await tx.insert(kumiaiGraphNode).values({
		id,
		teamId: ctx.teamId,
		workspaceId: ctx.workspaceId,
		key: `${String(ctx.requirement["key"])}/${nodeRef(spec)}`,
		requirementId: ctx.requirement.id,
		nodeKey: spec.node_key,
		kind: spec.kind,
		taskId,
		parallelGroup: spec.parallel_group ?? null,
		status: spec.status ?? "pending",
	});
	if (spec.gate) {
		await tx.insert(kumiaiGate).values({
			nodeId: id,
			teamId: ctx.teamId,
			workspaceId: ctx.workspaceId,
			requirementId: ctx.requirement.id,
			prompt: spec.gate.prompt,
			kind: spec.gate.kind ?? "approve",
		});
	}
	return id;
}

/** Inserts a deviation; returns its integer id. */
export async function insertDeviation(
	tx: GuildTx,
	ctx: GraphContext,
	deviation: { kind: GraphDeviationKind; node_key: string; reason: string },
): Promise<number> {
	const [row] = await tx
		.insert(kumiaiGraphDeviation)
		.values({
			teamId: ctx.teamId,
			workspaceId: ctx.workspaceId,
			requirementId: ctx.requirement.id,
			kind: deviation.kind,
			nodeKey: deviation.node_key,
			reason: deviation.reason,
			createdAt: utcNow(),
		})
		.returning({ id: kumiaiGraphDeviation.id });
	if (!row) throw new Error("graph_deviation insert returned no row");
	return row.id;
}

/** A requirement's whole graph in the guild shape. */
export async function readGraph(tx: GuildTx, workspaceId: string, requirementKey: string): Promise<GuildRow> {
	const where = { requirement_id: requirementKey };
	return {
		nodes: await readGuildRows(tx, "graph_node", workspaceId, where, ["id"]),
		edges: await readGuildRows(tx, "graph_edge", workspaceId, where, ["from_node", "to_node"]),
		gates: await readGuildRows(tx, "gate", workspaceId, where, ["node_id"]),
		deviations: await readGuildRows(tx, "graph_deviation", workspaceId, where, ["id"]),
	};
}

/**
 * The plan a gate ruling lands on, locked: `planKey` when given, else the plan whose
 * `gate_node_id` is the node. Zero or one internal id; two linked plans is ambiguous.
 */
export async function findPlansForGate(
	tx: GuildTx,
	workspaceId: string,
	nodeId: string,
	planKey: string | undefined,
): Promise<string[]> {
	if (planKey !== undefined) return [(await findByKey(tx, "kumiai_plans", workspaceId, planKey, { lock: true })).id];
	const linked = await tx
		.select({ id: kumiaiPlans.id, key: kumiaiPlans.key })
		.from(kumiaiPlans)
		.where(and(eq(kumiaiPlans.workspaceId, workspaceId), eq(kumiaiPlans.gateNodeId, nodeId)))
		.for("update");
	if (linked.length > 1) {
		throw new GuildError(
			"VALIDATION",
			`Plans ${linked.map((p) => p.key).join(", ")} are all linked to this gate; pass \`plan\`.`,
		);
	}
	return linked.map((p) => p.id);
}
