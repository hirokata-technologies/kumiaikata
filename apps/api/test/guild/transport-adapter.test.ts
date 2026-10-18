import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { AppError } from "@kata/http";
import { GuildError, defineTool } from "../../src/guild/registry.js";
import { guildTools } from "../../src/guild/tools/index.js";
import { seedKumiaiWorkspace } from "../helpers/seed.js";
import { dataOf, errorOf, mcpCall, mcpRpc, seedMcpUser } from "../helpers/mcp.js";
import { callGuildTool, outcomeToToolResult, toGuildErrorBody } from "../../src/mcp/guild-adapter.js";
import { GUILD_CONTRACT_VERSION } from "../../src/mcp/resource.js";
import { boardTools } from "../../src/mcp/tools/boards.js";

const caller = { userId: "u1", teamId: "t1" };

function throwing(err: unknown) {
	return defineTool({
		name: "boom",
		title: "Boom",
		description: "Throws.",
		input: z.object({ n: z.number().int() }),
		handler: () => Promise.reject(err),
	});
}

afterEach(() => {
	vi.restoreAllMocks();
});

// ── Error mapping ─────────────────────────────────────────────────────────────

describe("callGuildTool error mapping", () => {
	it("renders a GuildError as its contract code and message", async () => {
		const outcome = await callGuildTool(throwing(new GuildError("CONFLICT", "Status moved.")), caller, { n: 1 });
		expect(outcome).toEqual({ ok: false, error: { code: "CONFLICT", message: "Status moved." } });

		const result = outcomeToToolResult(outcome);
		expect(result.isError).toBe(true);
		expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
			code: "CONFLICT",
			message: "Status moved.",
		});
	});

	it.each([
		["NOT_FOUND", "NOT_FOUND"],
		["FORBIDDEN", "FORBIDDEN"],
		["DOMAIN_NOT_ALLOWED", "FORBIDDEN"],
		["CONFLICT", "CONFLICT"],
		["VALIDATION_ERROR", "VALIDATION"],
		["UNAUTHENTICATED", "UNAUTHENTICATED"],
	] as const)("maps AppError %s to %s", async (appCode, contractCode) => {
		const outcome = await callGuildTool(throwing(new AppError(appCode, "msg")), caller, { n: 1 });
		expect(outcome).toEqual({ ok: false, error: { code: contractCode, message: "msg" } });
	});

	it("maps Postgres constraint errors through the registry", () => {
		const pg = Object.assign(new Error("violates check constraint"), { code: "23514" });
		expect(toGuildErrorBody(new Error("wrapped", { cause: pg }))).toEqual({
			code: "VALIDATION",
			message: "violates check constraint",
		});
	});

	it("logs an unexpected error and answers a generic INTERNAL error without internals", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const outcome = await callGuildTool(throwing(new Error("connection string postgres://secret")), caller, { n: 1 });

		expect(outcome).toEqual({ ok: false, error: { code: "INTERNAL", message: "Internal error." } });
		expect(log).toHaveBeenCalledOnce();
		const internal = await callGuildTool(throwing(new AppError("INTERNAL_ERROR", "db exploded")), caller, { n: 1 });
		expect(internal).toEqual({ ok: false, error: { code: "INTERNAL", message: "Internal error." } });
	});

	it("validates input with the tool's zod schema before calling the handler", async () => {
		const handler = vi.fn();
		const tool = defineTool({ name: "t", title: "T", description: "", input: z.object({ n: z.number() }), handler });

		const outcome = await callGuildTool(tool, caller, { n: "one" });

		expect(handler).not.toHaveBeenCalled();
		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.error.code).toBe("VALIDATION");
		expect(outcome.error.issues?.[0]?.path).toEqual(["n"]);
	});
});

// ── MCP transport ─────────────────────────────────────────────────────────────

describe("MCP transport", () => {
	it("lists every registry tool and every board tool with its readOnly hint and input schema", async () => {
		const { user } = await seedMcpUser("adapter-list.com");

		const body = await mcpRpc(user, "tools/list", {});
		const tools = (body.result as { tools: Array<Record<string, unknown>> }).tools;
		const byName = new Map(tools.map((t) => [t.name as string, t]));

		const expected = [...guildTools, ...boardTools];
		expect(tools).toHaveLength(expected.length);
		for (const def of expected) {
			const listed = byName.get(def.name);
			expect(listed, def.name).toBeDefined();
			expect(listed?.title).toBe(def.title);
			expect((listed?.annotations as { readOnlyHint: boolean }).readOnlyHint).toBe(def.readOnly === true);
			expect((listed?.inputSchema as { type: string }).type).toBe("object");
		}
		expect(byName.get("whoami")).toBeDefined();
		expect((byName.get("create_workspace")?.inputSchema as { required: string[] }).required).toEqual(["name"]);
	});

	it("serves whoami from the registry with the contract version", async () => {
		const { user } = await seedMcpUser("adapter-whoami.com");

		const data = dataOf(await mcpCall(user, "whoami"));

		expect(data).toEqual({
			user: { id: user.id, email: user.email, name: user.name },
			team: user.team,
			contract: GUILD_CONTRACT_VERSION,
		});
	});

	it("answers bad input with a contract VALIDATION error, not the SDK's text", async () => {
		const { user } = await seedMcpUser("adapter-validation.com");

		const error = errorOf(await mcpCall(user, "create_workspace", { name: 42 }));

		expect(error.code).toBe("VALIDATION");
	});

	it("answers FORBIDDEN for a workspace of another team", async () => {
		const { user } = await seedMcpUser("adapter-mine.com");
		const other = await seedMcpUser("adapter-theirs.com");
		const theirs = await seedKumiaiWorkspace(other.user.team.id);

		const error = errorOf(await mcpCall(user, "get_state", { workspace: theirs.id }));

		expect(error).toEqual({ code: "FORBIDDEN", message: "Workspace not found in your team." });
	});
});
