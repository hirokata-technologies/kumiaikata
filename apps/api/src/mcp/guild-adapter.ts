import type { CallToolResult, McpServer, ServerContext, StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { z } from "zod";
import { AppError } from "@kata/http";
import type { ErrorCode } from "@kata/http";
import { GuildError, toGuildError, type GuildCaller, type GuildErrorCode, type GuildToolDef } from "../guild/registry.js";
import { guildTools } from "../guild/tools/index.js";
import { getMcpUser } from "./context.js";
import { toolError, toolResult, type McpToolErrorCode } from "./result.js";

/**
 * Serves the guild tool registry (src/guild) over a transport. The registry defines each
 * tool once; this module is the only place that turns a call into a result or a contract
 * error, so MCP (`registerGuildTools`) and REST (routes/kumiai/guild.ts) answer alike.
 */

/** A contract error body (§2 rule 10), plus zod issues for VALIDATION. */
export interface GuildErrorBody {
	code: McpToolErrorCode;
	message: string;
	issues?: z.core.$ZodIssue[];
}

export type GuildCallOutcome =
	| { ok: true; result: Record<string, unknown> }
	| { ok: false; error: GuildErrorBody };

/** Older services throw AppError; map their codes onto the contract's. */
const APP_ERROR_CODES: Partial<Record<ErrorCode, GuildErrorCode>> = {
	UNAUTHENTICATED: "UNAUTHENTICATED",
	FORBIDDEN: "FORBIDDEN",
	DOMAIN_NOT_ALLOWED: "FORBIDDEN",
	NOT_FOUND: "NOT_FOUND",
	CONFLICT: "CONFLICT",
	VALIDATION_ERROR: "VALIDATION",
	PAYLOAD_TOO_LARGE: "VALIDATION",
	UNSUPPORTED_MEDIA_TYPE: "VALIDATION",
};

const INTERNAL_MESSAGE = "Internal error.";

/**
 * Turn any thrown value into a contract error body. GuildError and AppError keep their
 * message (they are written for callers); Postgres constraint errors map through the
 * registry's `toGuildError`; anything else is logged and answered generically so no
 * internals leak.
 */
export function toGuildErrorBody(err: unknown, label = "guild"): GuildErrorBody {
	const mapped = toGuildError(err);
	if (mapped instanceof GuildError) return { code: mapped.code, message: mapped.message };
	if (mapped instanceof AppError) {
		const code = APP_ERROR_CODES[mapped.code];
		if (code) return { code, message: mapped.message };
	}
	if (mapped instanceof z.ZodError) return validationBody(mapped);
	console.error(`[${label}]`, err);
	return { code: "INTERNAL", message: INTERNAL_MESSAGE };
}

function validationBody(error: z.ZodError): GuildErrorBody {
	return { code: "VALIDATION", message: z.prettifyError(error), issues: error.issues };
}

/**
 * The tool's input schema with unknown top-level arguments refused (contract §2 rule 8). A
 * misspelled argument must be a VALIDATION error, never silently dropped: a dropped
 * `expect_status` would turn a guarded move into an overwrite that still answers 200.
 */
export function strictInput(tool: GuildToolDef): z.ZodObject {
	return tool.input.strict();
}

/**
 * Validate `rawInput` with the tool's zod schema and run it for `caller`. Never throws:
 * failures come back as a contract error body.
 */
export async function callGuildTool(
	tool: GuildToolDef,
	caller: GuildCaller,
	rawInput: unknown,
): Promise<GuildCallOutcome> {
	const parsed = strictInput(tool).safeParse(rawInput ?? {});
	if (!parsed.success) return { ok: false, error: validationBody(parsed.error) };
	try {
		return { ok: true, result: await tool.handler({ caller }, parsed.data) };
	} catch (err) {
		return { ok: false, error: toGuildErrorBody(err, `guild:${tool.name}`) };
	}
}

/** Render an outcome as an MCP tool result (errors as `isError` + `{code,message}` JSON). */
export function outcomeToToolResult(outcome: GuildCallOutcome): CallToolResult {
	if (outcome.ok) return toolResult(outcome.result);
	return toolError(outcome.error.code, outcome.error.message);
}

/**
 * The tool's zod schema as the MCP SDK sees it: the same JSON Schema in `tools/list`, but
 * validation always passes so the adapter validates with zod and answers a contract
 * `VALIDATION` error instead of the SDK's plain-text one.
 */
export function advertisedSchema(schema: z.ZodObject): StandardSchemaWithJSON<unknown, unknown> {
	const standard = schema["~standard"];
	return {
		"~standard": {
			...standard,
			validate: (value: unknown) => ({ value }),
		},
	};
}

/** The guild caller of an MCP tool call (the OAuth token's user and their team). */
export function guildCallerOf(ctx: Pick<ServerContext, "http">): GuildCaller {
	const user = getMcpUser(ctx);
	return { userId: user.id, teamId: user.team.id };
}

/** Register every tool of `tools` (the whole registry by default) on an MCP server. */
export function registerGuildTools(server: McpServer, tools: readonly GuildToolDef[] = guildTools): void {
	for (const tool of tools) {
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: advertisedSchema(strictInput(tool)),
				annotations: { readOnlyHint: tool.readOnly === true, openWorldHint: false },
			},
			async (args, ctx) => outcomeToToolResult(await callGuildTool(tool, guildCallerOf(ctx), args)),
		);
	}
}
