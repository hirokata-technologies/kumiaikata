import { env } from "../env.js";

/** Public origin of the app (no trailing slash). Better Auth is served under /api/auth. */
export const APP_ORIGIN = env.BETTER_AUTH_URL.replace(/\/+$/, "");

/**
 * Canonical URL of the MCP endpoint (POST /mcp, served by apps/web). Access tokens
 * are audience-bound to it. Must be HTTPS except on loopback (local dev).
 */
export const MCP_RESOURCE = `${APP_ORIGIN}/mcp`;

/** Version of docs/guild-contract.md this server implements. */
export const GUILD_CONTRACT_VERSION = "1.0.0";
