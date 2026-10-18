import { eq } from "drizzle-orm";
import { z } from "zod";
import {
	kumiaiGate,
	kumiaiGraphEdge,
	kumiaiGraphNode,
	kumiaiPlans,
	GATE_KINDS,
	GATE_STATUSES,
	GRAPH_DEVIATION_KINDS,
	GRAPH_NODE_KINDS,
	GRAPH_NODE_STATUSES,
} from "@kata/db";
import { actorInput, defineTool, GuildError, guildWrite, workspaceInput, type GuildToolDef } from "../registry.js";
import { assertExpectedStatus, findByKey, readGuildRow, readGuildRows, utcNow } from "../services/work-support.js";
import {
	findPlansForGate,
	insertDeviation,
	insertNode,
	nodeRef,
	readGraph,
	type NodeSpec,
} from "../services/graph-build.js";

/** Contract §4.5 — the execution graph and its gates. */

const keyInput = z.string().min(1);
const nodeIdInput = z.string().min(3).describe("A graph node id: <REQ>/<node_key>[.<suffix>]");
const nodeStatus = z.enum(GRAPH_NODE_STATUSES);
const expectNode = z.union([nodeStatus, z.array(nodeStatus).min(1)]);
const nodeKeyInput = z
	.string()
	.min(1)
	.regex(/^[^/.]+$/, "node_key is the bare template key: no '/' or '.'")
	.describe("The template key, stored bare: implement, review, gate-plan");
const suffixInput = z
	.string()
	.min(1)
	.regex(/^[^/]+$/, "suffix may not contain '/'")
	.describe("Fans the node out: <REQ>/<node_key>.<suffix>");
const gateInput = z.object({ prompt: z.string().min(1), kind: z.enum(GATE_KINDS).optional() });
const deviationInput = z.object({
	kind: z.enum(GRAPH_DEVIATION_KINDS),
	node_key: z.string().min(1),
	reason: z.string().trim().min(1),
});
const nodeFields = {
	node_key: nodeKeyInput,
	suffix: suffixInput.optional(),
	kind: z.enum(GRAPH_NODE_KINDS),
	task: keyInput.optional(),
	parallel_group: z.string().min(1).optional(),
	gate: gateInput.optional(),
};

const instantiateGraph = defineTool({
	name: "instantiate_graph",
	title: "Instantiate graph",
	description:
		"Atomically write a requirement's execution graph: nodes (id <REQ>/<node_key>[.<suffix>], node_key stored bare), " +
		"edges by nodeRef (`node_key` or `node_key.suffix`; a full node id also works), a gate row per gate node, and " +
		"deviations. Preflight with `list graph_node` first — a second instantiation is not refused. Returns the graph.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		requirement: keyInput,
		nodes: z.array(z.object({ ...nodeFields, status: nodeStatus.optional() })).min(1),
		edges: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })),
		deviations: z.array(deviationInput).optional(),
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const requirement = await findByKey(tx, "kumiai_requirements", input.workspace, input.requirement);
			const ctx = { teamId: caller.teamId, workspaceId: input.workspace, requirement };
			const byRef = new Map<string, { id: string; requirementId: string }>();
			for (const spec of input.nodes as NodeSpec[]) {
				const ref = nodeRef(spec);
				if (byRef.has(ref)) throw new GuildError("VALIDATION", `Node '${ref}' is declared twice.`);
				byRef.set(ref, { id: await insertNode(tx, ctx, spec), requirementId: requirement.id });
			}
			const resolve = async (ref: string): Promise<{ id: string; requirementId: string }> => {
				const local = byRef.get(ref);
				if (local) return local;
				if (!ref.includes("/")) throw new GuildError("VALIDATION", `Edge names unknown node '${ref}'.`);
				const node = await findByKey(tx, "kumiai_graph_node", input.workspace, ref);
				return { id: node.id, requirementId: String(node["requirement_id"]) };
			};
			for (const edge of input.edges) {
				const from = await resolve(edge.from);
				const to = await resolve(edge.to);
				await tx.insert(kumiaiGraphEdge).values({
					teamId: caller.teamId,
					workspaceId: input.workspace,
					requirementId: from.requirementId,
					fromNode: from.id,
					toNode: to.id,
				});
			}
			for (const deviation of input.deviations ?? []) await insertDeviation(tx, ctx, deviation);
			return readGraph(tx, input.workspace, input.requirement);
		}),
});

const addGraphNode = defineTool({
	name: "add_graph_node",
	title: "Add graph node",
	description:
		"Add one node to a requirement's graph (fan a node out with `suffix`). A gate node needs `gate.prompt`. Returns the node (and its gate).",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		requirement: keyInput,
		...nodeFields,
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const requirement = await findByKey(tx, "kumiai_requirements", input.workspace, input.requirement);
			const spec: NodeSpec = {
				node_key: input.node_key,
				suffix: input.suffix,
				kind: input.kind,
				task: input.task,
				parallel_group: input.parallel_group,
				gate: input.gate,
			};
			await insertNode(tx, { teamId: caller.teamId, workspaceId: input.workspace, requirement }, spec);
			const id = `${input.requirement}/${nodeRef(spec)}`;
			const node = await readGuildRow(tx, "graph_node", input.workspace, { id });
			const [gate] = await readGuildRows(tx, "gate", input.workspace, { node_id: id });
			return { ...node, gate: gate ?? null };
		}),
});

const addGraphEdge = defineTool({
	name: "add_graph_edge",
	title: "Add graph edge",
	description: "Add an edge between two existing nodes, by full node id. Returns the edge.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		from: nodeIdInput,
		to: nodeIdInput,
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const from = await findByKey(tx, "kumiai_graph_node", input.workspace, input.from);
			const to = await findByKey(tx, "kumiai_graph_node", input.workspace, input.to);
			await tx.insert(kumiaiGraphEdge).values({
				teamId: caller.teamId,
				workspaceId: input.workspace,
				requirementId: String(from["requirement_id"]),
				fromNode: from.id,
				toNode: to.id,
			});
			return readGuildRow(tx, "graph_edge", input.workspace, { from_node: input.from, to_node: input.to });
		}),
});

const addGraphDeviation = defineTool({
	name: "add_graph_deviation",
	title: "Add graph deviation",
	description: "Record a departure from the template, with a non-empty reason. Returns the deviation.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		requirement: keyInput,
		...deviationInput.shape,
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const requirement = await findByKey(tx, "kumiai_requirements", input.workspace, input.requirement);
			const id = await insertDeviation(
				tx,
				{ teamId: caller.teamId, workspaceId: input.workspace, requirement },
				{ kind: input.kind, node_key: input.node_key, reason: input.reason },
			);
			return readGuildRow(tx, "graph_deviation", input.workspace, { id });
		}),
});

const setNodeStatus = defineTool({
	name: "set_node_status",
	title: "Set node status",
	description:
		"Move a graph node; `task` binds the ticket. `expect_status` guards the move (CONFLICT, nothing written). " +
		"`skipped` is the graph's `waived`. Resolve a gate with resolve_gate, not here.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		node: nodeIdInput,
		status: nodeStatus,
		expect_status: expectNode.optional(),
		task: keyInput.optional(),
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const node = await findByKey(tx, "kumiai_graph_node", input.workspace, input.node, { lock: true });
			assertExpectedStatus(`Node ${input.node}`, String(node["status"]), input.expect_status);
			const patch: Partial<typeof kumiaiGraphNode.$inferInsert> = { status: input.status };
			if (input.task !== undefined) patch.taskId = (await findByKey(tx, "kumiai_tasks", input.workspace, input.task)).id;
			await tx.update(kumiaiGraphNode).set(patch).where(eq(kumiaiGraphNode.id, node.id));
			return readGuildRow(tx, "graph_node", input.workspace, { id: input.node });
		}),
});

const resolveGate = defineTool({
	name: "resolve_gate",
	title: "Resolve gate",
	description:
		"Atomically rule on a pending gate: the gate (status, decision, decided_at), its node (done on approve, skipped on " +
		"reject) and the linked plan (`plan`, whose gate_node_id is then set to the node, else the plan already linked): " +
		"approval, approved_by = decided_by (default 'user'), approved_at, and on reject status back to 'in-progress'. " +
		"Returns {gate, node, plan}.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		node: nodeIdInput,
		status: z.enum(GATE_STATUSES.filter((s) => s !== "pending") as ["approved", "rejected"]),
		decision: z.string().nullable().optional(),
		decided_by: z.string().trim().min(1).max(64).optional(),
		plan: keyInput.optional(),
	}),
	handler: async ({ caller }, input) =>
		guildWrite(caller, input.workspace, input.actor, async (tx) => {
			const node = await findByKey(tx, "kumiai_graph_node", input.workspace, input.node, { lock: true });
			const [gate] = await tx.select().from(kumiaiGate).where(eq(kumiaiGate.nodeId, node.id)).for("update");
			if (node["kind"] !== "gate" || !gate) throw new GuildError("VALIDATION", `Node ${input.node} is not a gate.`);
			assertExpectedStatus(`Gate ${input.node}`, gate.status, "pending");

			const plans = await findPlansForGate(tx, input.workspace, node.id, input.plan);
			const approved = input.status === "approved";

			await tx
				.update(kumiaiGate)
				.set({ status: input.status, decision: input.decision ?? null, decidedAt: utcNow() })
				.where(eq(kumiaiGate.nodeId, node.id));
			await tx
				.update(kumiaiGraphNode)
				.set({ status: approved ? "done" : "skipped" })
				.where(eq(kumiaiGraphNode.id, node.id));
			for (const planId of plans) {
				await tx
					.update(kumiaiPlans)
					.set({
						approval: input.status,
						approvedBy: input.decided_by ?? "user",
						approvedAt: utcNow(),
						gateNodeId: node.id,
						...(approved ? {} : { status: "in-progress" as const }),
					})
					.where(eq(kumiaiPlans.id, planId));
			}

			const [planRow] =
				plans.length > 0 ? await readGuildRows(tx, "plan", input.workspace, { kumiai_id: plans[0] ?? "" }) : [];
			return {
				gate: await readGuildRow(tx, "gate", input.workspace, { node_id: input.node }),
				node: await readGuildRow(tx, "graph_node", input.workspace, { id: input.node }),
				plan: planRow ?? null,
			};
		}),
});

export const graphTools: GuildToolDef[] = [
	instantiateGraph,
	addGraphNode,
	addGraphEdge,
	addGraphDeviation,
	setNodeStatus,
	resolveGate,
];
