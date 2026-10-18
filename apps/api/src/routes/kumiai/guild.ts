import { Hono } from "hono";
import { every } from "hono/combine";
import type { Context, Next } from "hono";
import { z } from "zod";
import { requireSession } from "../../auth/middleware.js";
import { loadTeamAccess, type KumiaiVariables } from "../../auth/team-access.js";
import type { GuildCaller, GuildToolDef } from "../../guild/registry.js";
import { guildTools } from "../../guild/tools/index.js";
import { authenticateAccessToken, hasAccessToken } from "../../mcp/bearer.js";
import { callGuildTool, strictInput, toGuildErrorBody, type GuildErrorBody } from "../../mcp/guild-adapter.js";
import { REJECTION_MESSAGES } from "../../mcp/handler.js";
import { GUILD_CONTRACT_VERSION } from "../../mcp/resource.js";

/**
 * REST/RPC transport of the guild registry (docs/guild-contract.md §1):
 *
 * - `POST /api/kumiai/guild/:tool` — body = the tool's input (validated with the same zod
 *   schema as MCP), response = the tool's JSON result. Errors are `{code, message}` with
 *   404/403/400/409/401 (500 for an unexpected failure).
 * - `GET /api/kumiai/guild` — the tool catalog with each tool's input JSON Schema.
 *
 * Auth: a Better Auth session cookie, or the OAuth Bearer access token POST /mcp accepts
 * (verified the same way, see mcp/bearer.ts).
 */

interface GuildVariables extends KumiaiVariables {
	guildCaller: GuildCaller;
}

type GuildContext = Context<{ Variables: GuildVariables }>;

const STATUS: Record<GuildErrorBody["code"], 400 | 401 | 403 | 404 | 409 | 500> = {
	VALIDATION: 400,
	UNAUTHENTICATED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	CONFLICT: 409,
	INTERNAL: 500,
};

function errorResponse(c: GuildContext, body: GuildErrorBody, headers?: Record<string, string>): Response {
	return c.json(body, STATUS[body.code], headers);
}

const toolsByName = new Map<string, GuildToolDef>(guildTools.map((tool) => [tool.name, tool]));

let catalog: Record<string, unknown> | undefined;

/** The tool catalog, built on first use (the registry is static once loaded). */
function toolCatalog(): Record<string, unknown> {
	catalog ??= {
		contract: GUILD_CONTRACT_VERSION,
		tools: guildTools.map((tool) => ({
			name: tool.name,
			title: tool.title,
			description: tool.description,
			readOnly: tool.readOnly === true,
			inputSchema: z.toJSONSchema(strictInput(tool), { io: "input" }),
		})),
	};
	return catalog;
}

/** The session path: the same middleware pair every Kumiai REST route uses. */
const sessionAuth = every(requireSession, loadTeamAccess, async (c: GuildContext, next: Next) => {
	c.set("guildCaller", { userId: c.get("user").id, teamId: c.get("kumiaiTeamId") });
	await next();
});

/** Session cookie (requireSession + loadTeamAccess) or OAuth Bearer token → `guildCaller`. */
async function authenticate(c: GuildContext, next: Next): Promise<Response | void> {
	if (hasAccessToken(c.req.raw)) {
		const auth = await authenticateAccessToken(c.req.raw);
		if (!auth.ok) {
			const { failure } = auth;
			if (failure.kind === "rejected") {
				return errorResponse(c, { code: "FORBIDDEN", message: REJECTION_MESSAGES[failure.rejection] });
			}
			const body: GuildErrorBody =
				failure.status === 403
					? { code: "FORBIDDEN", message: "The access token lacks a required scope." }
					: { code: "UNAUTHENTICATED", message: "A valid access token is required." };
			return errorResponse(c, body, failure.challenge ? { "WWW-Authenticate": failure.challenge } : undefined);
		}
		c.set("guildCaller", { userId: auth.user.id, teamId: auth.user.team.id });
		await next();
		return;
	}

	await sessionAuth(c, next);
}

/** The JSON body, `{}` when empty. A body that is not JSON is a VALIDATION error. */
async function readInput(c: GuildContext): Promise<{ ok: true; value: unknown } | { ok: false }> {
	const text = await c.req.text();
	if (text.trim() === "") return { ok: true, value: {} };
	try {
		return { ok: true, value: JSON.parse(text) as unknown };
	} catch {
		return { ok: false };
	}
}

const r = new Hono<{ Variables: GuildVariables }>();

r.use("*", authenticate);

// GET /api/kumiai/guild — the tool catalog
r.get("/", (c) => c.json(toolCatalog()));

// POST /api/kumiai/guild/:tool — call one guild tool
r.post("/:tool", async (c) => {
	const tool = toolsByName.get(c.req.param("tool"));
	if (!tool) return errorResponse(c, { code: "NOT_FOUND", message: `Unknown guild tool: ${c.req.param("tool")}` });

	const input = await readInput(c);
	if (!input.ok) return errorResponse(c, { code: "VALIDATION", message: "The request body must be JSON." });

	const outcome = await callGuildTool(tool, c.get("guildCaller"), input.value);
	return outcome.ok ? c.json(outcome.result) : errorResponse(c, outcome.error);
});

// Session and team errors (AppError) and anything unexpected → contract `{code, message}`.
r.onError((err, c) => errorResponse(c, toGuildErrorBody(err, "guild-rest")));

export default r;
