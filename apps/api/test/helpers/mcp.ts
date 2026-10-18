import { createMcpHandler } from "@modelcontextprotocol/server";
import { buildAuthInfo, resolveMcpUser, type McpUser } from "../../src/mcp/context.js";
import { MCP_RESOURCE } from "../../src/mcp/resource.js";
import { createKumiaiMcpServer } from "../../src/mcp/server.js";
import { seedPersonalBoard, seedTeamWithBoard, seedUser } from "./seed.js";

/**
 * Drive the real MCP server in-process as an authenticated user — the same path
 * `mcpHandler` takes after verifying a token (handler.test.ts covers the token check).
 */

const handler = createMcpHandler(() => createKumiaiMcpServer());
let rpcId = 0;
let userCounter = 0;

export interface McpToolResult {
	isError?: boolean;
	content: Array<{ type: string; text: string }>;
	structuredContent?: Record<string, unknown>;
}

/** Load the {@link McpUser} for a seeded user (must have an allow-listed email and a team). */
export async function mcpUserFor(userId: string): Promise<McpUser> {
	const resolved = await resolveMcpUser(userId);
	if (!("user" in resolved)) throw new Error(`user ${userId} cannot use MCP: ${resolved.rejection}`);
	return resolved.user;
}

/** A user on test.com with a team (and its team board) and a personal board. */
export async function seedMcpUser(domain: string): Promise<{
	user: McpUser;
	teamBoardId: string;
	personalBoardId: string;
}> {
	userCounter += 1;
	const seeded = await seedUser({ email: `mcp-${userCounter}-${domain.replace(/\W/g, "-")}@test.com` });
	const { board } = await seedTeamWithBoard({ domain, members: [{ userId: seeded.id, role: "member" }] });
	const personal = await seedPersonalBoard(seeded.id);
	return { user: await mcpUserFor(seeded.id), teamBoardId: board.id, personalBoardId: personal.id };
}

/** Send one JSON-RPC request; returns the parsed JSON-RPC response body. */
export async function mcpRpc(user: McpUser, method: string, params: unknown): Promise<Record<string, unknown>> {
	rpcId += 1;
	const authInfo = buildAuthInfo({
		token: "test-token",
		clientId: "test-client",
		scopes: [],
		expiresAt: undefined,
		resource: MCP_RESOURCE,
		user,
	});
	const res = await handler.fetch(
		new Request(MCP_RESOURCE, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
			body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
		}),
		{ authInfo },
	);
	if (res.status !== 200) throw new Error(`MCP answered ${res.status}: ${await res.text()}`);
	const text = await res.text();
	// The stateless transport may answer as JSON or as a single SSE event.
	const json = text.startsWith("{") ? text : (text.match(/^data: (.*)$/m)?.[1] ?? "");
	return JSON.parse(json) as Record<string, unknown>;
}

/** `tools/call` → the tool result. */
export async function mcpCall(user: McpUser, name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
	const body = await mcpRpc(user, "tools/call", { name, arguments: args });
	if (!body.result) throw new Error(`tools/call ${name} failed: ${JSON.stringify(body.error)}`);
	return body.result as McpToolResult;
}

/** The `{code, message}` of a tool error result (throws if the call succeeded). */
export function errorOf(result: McpToolResult): { code: string; message: string } {
	if (!result.isError) throw new Error(`expected a tool error, got ${JSON.stringify(result.structuredContent)}`);
	return JSON.parse(result.content[0]!.text) as { code: string; message: string };
}

/** The structuredContent of a successful tool result (throws on a tool error). */
export function dataOf<T = Record<string, unknown>>(result: McpToolResult): T {
	if (result.isError) throw new Error(`tool error: ${result.content[0]?.text ?? ""}`);
	return result.structuredContent as T;
}
