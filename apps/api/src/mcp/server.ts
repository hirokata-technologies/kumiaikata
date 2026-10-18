import { McpServer } from "@modelcontextprotocol/server";
import { guildTools } from "../guild/tools/index.js";
import { registerGuildTools } from "./guild-adapter.js";
import { GUILD_CONTRACT_VERSION } from "./resource.js";
import { boardTools } from "./tools/boards.js";

/**
 * Build a fresh Kumiai MCP server. `createMcpHandler` calls this once per HTTP
 * request (the endpoint is stateless), so nothing here may hold per-user state —
 * tools read the caller with `getMcpUser(ctx)`.
 *
 * Serves every guild registry tool (contract §4.1–4.8) plus the MCP-only board
 * tools (§4.9).
 */
export function createKumiaiMcpServer(): McpServer {
	const server = new McpServer({ name: "kumiai", version: GUILD_CONTRACT_VERSION });
	registerGuildTools(server, guildTools);
	registerGuildTools(server, boardTools);
	return server;
}
