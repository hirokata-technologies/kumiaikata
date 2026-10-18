import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, kumiaiWorkspaces, withGuildTx, type GuildTx } from "@kata/db";

/**
 * The guild tool registry (docs/guild-contract.md §4). Every guild tool is defined ONCE
 * here-shaped — name, zod input, handler — and served twice: as an MCP tool at POST /mcp and
 * as REST/RPC at POST /api/kumiai/guild/<name>. Transports never contain tool logic.
 */

/** Error codes of contract §2 rule 10. */
export type GuildErrorCode = "NOT_FOUND" | "FORBIDDEN" | "VALIDATION" | "CONFLICT" | "UNAUTHENTICATED";

/** A contract error. Transports render it as `{code, message}` (MCP isError / REST status). */
export class GuildError extends Error {
	constructor(
		public readonly code: GuildErrorCode,
		message: string,
	) {
		super(message);
		this.name = "GuildError";
	}
}

/** Who is calling, resolved by the transport (OAuth token or session). */
export interface GuildCaller {
	userId: string;
	teamId: string;
}

/** What a handler receives besides its input. */
export interface GuildToolContext {
	caller: GuildCaller;
}

export interface GuildToolDef<S extends z.ZodObject = z.ZodObject> {
	name: string;
	title: string;
	description: string;
	input: S;
	/** True for tools that never write (MCP readOnlyHint; REST allows them on any method). */
	readOnly?: boolean;
	handler: (ctx: GuildToolContext, input: z.infer<S>) => Promise<Record<string, unknown>>;
}

/** Identity helper that keeps the input type flowing into the handler. */
export function defineTool<S extends z.ZodObject>(def: GuildToolDef<S>): GuildToolDef<S> {
	return def;
}

// ── Shared input fragments ───────────────────────────────────────────────────

export const workspaceInput = z.string().min(1).describe("Kumiai workspace id");
export const actorInput = z
	.string()
	.trim()
	.min(1)
	.max(64)
	.describe("Guild member name for attribution: orchestrator, strategist, developer-svelte, user, …");
export const prioInput = z.number().int().min(1).max(5);

// ── Workspace scope ──────────────────────────────────────────────────────────

/** Contract §2 rule 1: the workspace must belong to the caller's team, else FORBIDDEN. */
export async function assertWorkspace(caller: GuildCaller, workspaceId: string): Promise<void> {
	const [row] = await db
		.select({ id: kumiaiWorkspaces.id })
		.from(kumiaiWorkspaces)
		.where(and(eq(kumiaiWorkspaces.id, workspaceId), eq(kumiaiWorkspaces.teamId, caller.teamId)))
		.limit(1);
	if (!row) throw new GuildError("FORBIDDEN", "Workspace not found in your team.");
}

/**
 * Run a write in one attributed transaction (contract §2 rules 2 and 5). Checks the
 * workspace first, sets actor/user/team/workspace for the event triggers, and maps
 * Postgres errors to contract codes.
 */
export async function guildWrite<R>(
	caller: GuildCaller,
	workspaceId: string,
	actor: string,
	fn: (tx: GuildTx) => Promise<R>,
): Promise<R> {
	await assertWorkspace(caller, workspaceId);
	try {
		return await withGuildTx(db, { actor, userId: caller.userId, teamId: caller.teamId, workspaceId }, fn);
	} catch (err) {
		throw toGuildError(err);
	}
}

/** Map a thrown value to a GuildError (packages/db/GUILD.md "Workspace scope" codes). */
export function toGuildError(err: unknown): unknown {
	if (err instanceof GuildError) return err;
	const pg = findPgError(err);
	if (!pg) return err;
	const message = pg.message;
	switch (pg.code) {
		case "23514": // check_violation
		case "23502": // not_null_violation
		case "22P02": // invalid_text_representation
		case "22023": // invalid_parameter_value
			return new GuildError("VALIDATION", message);
		case "23503": // foreign_key_violation
			return new GuildError("NOT_FOUND", message);
		case "23505": // unique_violation
			return new GuildError("CONFLICT", message);
		case "42501": // insufficient_privilege (scope trigger)
			return new GuildError("FORBIDDEN", message);
		default:
			return err;
	}
}

function findPgError(err: unknown): { code: string; message: string } | null {
	// drizzle wraps driver errors; walk `cause` to the pg error.
	let cur: unknown = err;
	for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
		const o = cur as { code?: unknown; message?: unknown; cause?: unknown };
		if (typeof o.code === "string" && /^[0-9A-Z]{5}$/.test(o.code)) {
			return { code: o.code, message: typeof o.message === "string" ? o.message : "Database error." };
		}
		cur = o.cause;
	}
	return null;
}
