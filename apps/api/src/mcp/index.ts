// MCP server (docs/guild-contract.md §1). apps/web mounts `mcpHandler` at POST /mcp
// and `wellKnownHandler` at /.well-known/*.
export { mcpHandler } from "./handler.js";
export { wellKnownHandler } from "./discovery.js";
export { createKumiaiMcpServer } from "./server.js";
export { getMcpUser, type McpUser } from "./context.js";
export { toolResult, toolError, type McpToolErrorCode } from "./result.js";
export { MCP_RESOURCE, GUILD_CONTRACT_VERSION } from "./resource.js";
