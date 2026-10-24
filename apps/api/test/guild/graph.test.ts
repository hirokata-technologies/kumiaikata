import { describe, it, expect } from "vitest";
import { seedUser } from "../helpers/index.js";
import { seedGuildBoard, all, one, type GuildBoard } from "../helpers/guild.js";
import { graphTools } from "../../src/guild/tools/graph.js";
import { workTools } from "../../src/guild/tools/work.js";
import type { GuildCaller } from "../../src/guild/registry.js";

interface Ctx {
	board: GuildBoard;
	caller: GuildCaller;
}

type Row = Record<string, unknown>;

async function setup(): Promise<Ctx> {
	const user = await seedUser();
	const board = await seedGuildBoard();
	return { board, caller: { userId: user.id, teamId: board.teamId } };
}

/** Parse like a transport does, then run the handler. */
async function call(ctx: Ctx, name: string, input: Row): Promise<Row> {
	const tool = [...graphTools, ...workTools].find((t) => t.name === name);
	if (!tool) throw new Error(`no tool ${name}`);
	const parsed = tool.input.parse({ workspace: ctx.board.workspaceId, actor: "orchestrator", ...input });
	return (await tool.handler({ caller: ctx.caller }, parsed)) as Row;
}

function events(ws: string, subject: string) {
	return all<{ verb: string; actor: string; user_id: string | null; payload: Row }>(
		`SELECT verb, actor, user_id, payload FROM kumiai_event WHERE workspace_id = $1 AND subject_id = $2 ORDER BY id`,
		[ws, subject],
	);
}

async function count(sql: string): Promise<number> {
	return (await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`)).n;
}

/** REQ-001 with TASK-001 and TASK-002, and PLAN-001. */
async function seedWork(ctx: Ctx): Promise<void> {
	await call(ctx, "create_requirement", { title: "R" });
	await call(ctx, "create_task", { requirement: "REQ-001", title: "A" });
	await call(ctx, "create_task", { requirement: "REQ-001", title: "B" });
	await call(ctx, "create_plan", { requirement: "REQ-001", title: "P" });
}

/** The kumiai.md `standard` template with two implement tickets. */
const STANDARD = {
	actor: "strategist",
	requirement: "REQ-001",
	nodes: [
		{ node_key: "gate-plan", kind: "gate", gate: { kind: "approve", prompt: "Plan for REQ-001 is ready — approve?" } },
		{ node_key: "implement", suffix: "TASK-001", kind: "work", task: "TASK-001", parallel_group: "wave-1" },
		{ node_key: "implement", suffix: "TASK-002", kind: "work", task: "TASK-002", parallel_group: "wave-1" },
		{ node_key: "test-plan", kind: "work" },
		{ node_key: "test-write", kind: "work", status: "skipped" },
		{ node_key: "review", suffix: "reviewer-security", kind: "work", parallel_group: "review" },
		{ node_key: "review", suffix: "reviewer-architecture", kind: "work", parallel_group: "review" },
		{ node_key: "review", suffix: "reviewer-business-logic", kind: "work", parallel_group: "review" },
		{ node_key: "review", suffix: "reviewer-edge-case", kind: "work", parallel_group: "review" },
		{ node_key: "gate-repairs", kind: "gate", gate: { kind: "select-findings", prompt: "Which get repaired?" } },
		{ node_key: "repair", kind: "work" },
		{ node_key: "document", kind: "work" },
	],
	edges: [
		{ from: "gate-plan", to: "implement.TASK-001" },
		{ from: "gate-plan", to: "implement.TASK-002" },
		{ from: "implement.TASK-001", to: "test-plan" },
		{ from: "implement.TASK-002", to: "test-plan" },
		{ from: "test-plan", to: "test-write" },
		{ from: "test-write", to: "review.reviewer-security" },
		{ from: "test-write", to: "review.reviewer-architecture" },
		{ from: "test-write", to: "review.reviewer-business-logic" },
		{ from: "test-write", to: "review.reviewer-edge-case" },
		{ from: "review.reviewer-security", to: "gate-repairs" },
		{ from: "review.reviewer-architecture", to: "gate-repairs" },
		{ from: "review.reviewer-business-logic", to: "gate-repairs" },
		{ from: "review.reviewer-edge-case", to: "gate-repairs" },
		{ from: "gate-repairs", to: "repair" },
		{ from: "repair", to: "document" },
	],
	deviations: [{ kind: "drop-node", node_key: "test-write", reason: "Verification is `checks`; no test" }],
};

describe("instantiate_graph", () => {
	it("writes nodes with fanned ids and bare node_keys, edges by nodeRef, gates and deviations", async () => {
		const ctx = await setup();
		await seedWork(ctx);
		const graph = (await call(ctx, "instantiate_graph", STANDARD)) as {
			nodes: Row[];
			edges: Row[];
			gates: Row[];
			deviations: Row[];
		};
		expect(graph.nodes).toHaveLength(12);
		expect(graph.edges).toHaveLength(15);
		expect(graph.gates).toHaveLength(2);
		expect(graph.nodes.find((n) => n["id"] === "REQ-001/implement.TASK-001")).toMatchObject({
			requirement_id: "REQ-001",
			node_key: "implement",
			kind: "work",
			task_id: "TASK-001",
			parallel_group: "wave-1",
			status: "pending",
		});
		expect(graph.nodes.find((n) => n["id"] === "REQ-001/test-write")).toMatchObject({ status: "skipped" });
		expect(graph.nodes.filter((n) => n["node_key"] === "review")).toHaveLength(4);
		expect(graph.edges).toContainEqual(
			expect.objectContaining({ from_node: "REQ-001/gate-plan", to_node: "REQ-001/implement.TASK-002", requirement_id: "REQ-001" }),
		);
		expect(graph.gates).toContainEqual(
			expect.objectContaining({ node_id: "REQ-001/gate-repairs", kind: "select-findings", status: "pending", requirement_id: "REQ-001" }),
		);
		expect(graph.deviations).toEqual([
			expect.objectContaining({ kind: "drop-node", node_key: "test-write", requirement_id: "REQ-001" }),
		]);
		const ev = await events(ctx.board.workspaceId, "REQ-001");
		expect(ev.at(-1)).toMatchObject({ verb: "deviated", actor: "strategist", user_id: ctx.caller.userId });

		// what the guild reads next: gate-plan is ready, the implement nodes wait on it, and the
		// reviewers are ready because a `skipped` predecessor counts as finished
		const ready = await all<{ id: string }>(`SELECT id FROM kumiai_v_ready_nodes WHERE workspace_id = $1 ORDER BY id`, [
			ctx.board.workspaceId,
		]);
		expect(ready.map((r) => r.id)).toEqual([
			"REQ-001/gate-plan",
			"REQ-001/review.reviewer-architecture",
			"REQ-001/review.reviewer-business-logic",
			"REQ-001/review.reviewer-edge-case",
			"REQ-001/review.reviewer-security",
		]);
	});

	it("is atomic: an unknown edge ref, duplicate node or missing task writes nothing", async () => {
		const ctx = await setup();
		await seedWork(ctx);
		const base = { requirement: "REQ-001", nodes: [{ node_key: "a", kind: "work" }, { node_key: "b", kind: "work" }] };
		await expect(call(ctx, "instantiate_graph", { ...base, edges: [{ from: "a", to: "c" }] })).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(
			call(ctx, "instantiate_graph", { ...base, nodes: [...base.nodes, { node_key: "a", kind: "work" }], edges: [] }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(
			call(ctx, "instantiate_graph", { ...base, nodes: [{ node_key: "a", kind: "work", task: "TASK-404" }], edges: [] }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			call(ctx, "instantiate_graph", { ...base, nodes: [{ node_key: "g", kind: "gate" }], edges: [] }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(
			call(ctx, "instantiate_graph", { ...base, edges: [{ from: "a", to: "a" }] }),
		).rejects.toMatchObject({ code: "VALIDATION" });
		expect(await count(`kumiai_graph_node`)).toBe(0);
		expect(await count(`kumiai_graph_edge`)).toBe(0);
	});

	it("refuses a dotted node_key and an unknown requirement; FORBIDDEN elsewhere", async () => {
		const ctx = await setup();
		await seedWork(ctx);
		await expect(
			call(ctx, "instantiate_graph", { requirement: "REQ-001", nodes: [{ node_key: "implement.x", kind: "work" }], edges: [] }),
		).rejects.toThrow();
		await expect(
			call(ctx, "instantiate_graph", { requirement: "REQ-404", nodes: [{ node_key: "a", kind: "work" }], edges: [] }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		const other = await seedGuildBoard();
		await expect(
			call({ ...ctx, board: other }, "instantiate_graph", { requirement: "REQ-001", nodes: [{ node_key: "a", kind: "work" }], edges: [] }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

describe("add_graph_node / add_graph_edge / add_graph_deviation", () => {
	it("fans a node out later and wires it in", async () => {
		const ctx = await setup();
		await seedWork(ctx);
		await call(ctx, "instantiate_graph", STANDARD);
		const node = await call(ctx, "add_graph_node", {
			requirement: "REQ-001",
			node_key: "repair",
			suffix: "TASK-002",
			kind: "work",
			task: "TASK-002",
		});
		expect(node).toMatchObject({ id: "REQ-001/repair.TASK-002", node_key: "repair", task_id: "TASK-002", gate: null });
		const edge = await call(ctx, "add_graph_edge", { from: "REQ-001/gate-repairs", to: "REQ-001/repair.TASK-002" });
		expect(edge).toEqual({ from_node: "REQ-001/gate-repairs", to_node: "REQ-001/repair.TASK-002", requirement_id: "REQ-001" });
		await expect(
			call(ctx, "add_graph_edge", { from: "REQ-001/gate-repairs", to: "REQ-001/repair.TASK-002" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(call(ctx, "add_graph_edge", { from: "REQ-001/nope", to: "REQ-001/repair" })).rejects.toMatchObject({ code: "NOT_FOUND" });
		// the same node twice collides on the node id
		await expect(
			call(ctx, "add_graph_node", { requirement: "REQ-001", node_key: "repair", suffix: "TASK-002", kind: "work" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("adds a gate node with its gate row", async () => {
		const ctx = await setup();
		await seedWork(ctx);
		const node = await call(ctx, "add_graph_node", {
			requirement: "REQ-001",
			node_key: "gate-extra",
			kind: "gate",
			gate: { prompt: "Ship it?" },
		});
		expect(node["gate"]).toMatchObject({ node_id: "REQ-001/gate-extra", prompt: "Ship it?", kind: "approve", status: "pending" });
	});

	it("records a deviation with its reason; an empty reason is refused", async () => {
		const ctx = await setup();
		await seedWork(ctx);
		const dev = await call(ctx, "add_graph_deviation", {
			actor: "strategist",
			requirement: "REQ-001",
			kind: "add-node",
			node_key: "research",
			reason: "The webhook API is undocumented",
		});
		expect(dev).toMatchObject({ requirement_id: "REQ-001", kind: "add-node", node_key: "research", reason: "The webhook API is undocumented" });
		expect(typeof dev["id"]).toBe("number");
		await expect(
			call(ctx, "add_graph_deviation", { requirement: "REQ-001", kind: "add-node", node_key: "x", reason: "   " }),
		).rejects.toThrow();
		await expect(
			call(ctx, "add_graph_deviation", { requirement: "REQ-001", kind: "rewrite", node_key: "x", reason: "y" }),
		).rejects.toThrow();
	});
});

describe("set_node_status", () => {
	it("runs a node, binding its task, guarded by expect_status", async () => {
		const ctx = await setup();
		await seedWork(ctx);
		await call(ctx, "instantiate_graph", STANDARD);
		const running = await call(ctx, "set_node_status", {
			node: "REQ-001/test-plan",
			status: "running",
			expect_status: ["pending", "ready"],
			task: "TASK-002",
		});
		expect(running).toMatchObject({ id: "REQ-001/test-plan", status: "running", task_id: "TASK-002" });
		await expect(
			call(ctx, "set_node_status", { node: "REQ-001/test-plan", status: "done", expect_status: "pending" }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await one<{ status: string }>(`SELECT status FROM kumiai_graph_node WHERE key = 'REQ-001/test-plan'`)).toEqual({ status: "running" });
		const ev = await events(ctx.board.workspaceId, "REQ-001/test-plan");
		expect(ev).toEqual([
			expect.objectContaining({ verb: "node-moved", actor: "orchestrator", payload: expect.objectContaining({ from: "pending", to: "running", task_id: "TASK-002" }) }),
		]);
		await expect(call(ctx, "set_node_status", { node: "REQ-001/nope", status: "done" })).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("resolve_gate", () => {
	it("approve: gate, node done and the linked plan approved by 'user', in one call", async () => {
		const ctx = await setup();
		await seedWork(ctx);
		await call(ctx, "instantiate_graph", STANDARD);
		const result = (await call(ctx, "resolve_gate", {
			node: "REQ-001/gate-plan",
			status: "approved",
			decision: "Go",
			plan: "PLAN-001",
		})) as { gate: Row; node: Row; plan: Row };
		expect(result.gate).toMatchObject({ node_id: "REQ-001/gate-plan", status: "approved", decision: "Go" });
		expect(typeof result.gate["decided_at"]).toBe("string");
		expect(result.node).toMatchObject({ id: "REQ-001/gate-plan", status: "done" });
		expect(result.plan).toMatchObject({
			id: "PLAN-001",
			approval: "approved",
			approved_by: "user",
			gate_node_id: "REQ-001/gate-plan",
			status: "todo",
		});
		expect(typeof result.plan["approved_at"]).toBe("string");

		expect((await events(ctx.board.workspaceId, "REQ-001/gate-plan")).map((e) => [e.verb, e.actor])).toEqual([
			["decided", "orchestrator"],
			["node-moved", "orchestrator"],
		]);
		expect((await events(ctx.board.workspaceId, "PLAN-001")).at(-1)).toMatchObject({ verb: "decided", actor: "user" });

		// the implement nodes are now ready
		const ready = await all<{ id: string }>(
			`SELECT id FROM kumiai_v_ready_nodes WHERE workspace_id = $1 AND node_key = 'implement' ORDER BY id`,
			[ctx.board.workspaceId],
		);
		expect(ready.map((r) => r.id)).toEqual(["REQ-001/implement.TASK-001", "REQ-001/implement.TASK-002"]);

		// a decided gate is not decided again
		await expect(call(ctx, "resolve_gate", { node: "REQ-001/gate-plan", status: "rejected" })).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("reject: node skipped, plan rejected and back to in-progress, found through gate_node_id", async () => {
		const ctx = await setup();
		await seedWork(ctx);
		await call(ctx, "instantiate_graph", STANDARD);
		await call(ctx, "update_plan", { key: "PLAN-001", status: "done", gate_node_id: "REQ-001/gate-plan" });
		const result = (await call(ctx, "resolve_gate", {
			node: "REQ-001/gate-plan",
			status: "rejected",
			decided_by: "guild-master",
		})) as { gate: Row; node: Row; plan: Row };
		expect(result.gate).toMatchObject({ status: "rejected", decision: null });
		expect(result.node).toMatchObject({ status: "skipped" });
		expect(result.plan).toMatchObject({ approval: "rejected", approved_by: "guild-master", status: "in-progress" });
		const verbs = (await events(ctx.board.workspaceId, "PLAN-001")).map((e) => [e.verb, e.actor]);
		expect(verbs.slice(-2)).toEqual([
			["moved", "orchestrator"],
			["decided", "guild-master"],
		]);
	});

	it("a gate with no plan behind it resolves alone; a work node is not a gate", async () => {
		const ctx = await setup();
		await seedWork(ctx);
		await call(ctx, "instantiate_graph", STANDARD);
		const result = await call(ctx, "resolve_gate", { node: "REQ-001/gate-repairs", status: "approved", decision: "[1,2]" });
		expect(result["plan"]).toBeNull();
		expect(result["node"]).toMatchObject({ status: "done" });
		await expect(call(ctx, "resolve_gate", { node: "REQ-001/repair", status: "approved" })).rejects.toMatchObject({ code: "VALIDATION" });
		await expect(call(ctx, "resolve_gate", { node: "REQ-001/gate-plan", status: "approved", plan: "PLAN-404" })).rejects.toMatchObject({ code: "NOT_FOUND" });
		// the failed call left the gate pending
		expect(await one<{ status: string }>(
			`SELECT g.status FROM kumiai_gate g JOIN kumiai_graph_node n ON n.id = g.node_id WHERE n.key = 'REQ-001/gate-plan'`,
		)).toEqual({ status: "pending" });
	});
});
