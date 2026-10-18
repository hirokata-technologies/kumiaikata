import { sql, type SQLWrapper } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema/index.js";
import type { GuildKeyPrefix } from "./guild-vocab.js";

/**
 * Guild warehouse helpers. See packages/db/GUILD.md for the full contract: the
 * transaction-local settings the triggers read, and what each trigger writes.
 */

/** Anything that can run raw SQL: the `db` client or a transaction. */
export interface SqlExecutor {
	execute(query: SQLWrapper | string): PromiseLike<{ rows: Record<string, unknown>[] }>;
}

/**
 * Allocates the next guild key (`TASK-007`) for a workspace, atomically: the counter row is
 * locked until the surrounding transaction ends, so call it inside the same transaction as
 * the insert that uses the key. A rolled-back transaction gives the number back.
 *
 * Inserting with `key` left NULL does the same thing in a trigger; this helper is for callers
 * that need the key before the insert (e.g. to compose a graph node id `REQ-001/implement`).
 */
export async function allocateKey(
	executor: SqlExecutor,
	workspaceId: string,
	prefix: GuildKeyPrefix,
): Promise<string> {
	const result = await executor.execute(sql`SELECT kumiai_allocate_key(${workspaceId}, ${prefix}) AS key`);
	const key = result.rows[0]?.["key"];
	if (typeof key !== "string") throw new Error("[kata/db] kumiai_allocate_key returned no key");
	return key;
}

/** Who is writing, for the event feed. */
export interface GuildActorContext {
	/** The guild member name: `orchestrator`, `strategist`, `developer-svelte`, `user`, … */
	actor: string;
	/** The authenticated Kumiai user (users.id), recorded on every event as `user_id`. */
	userId?: string | null | undefined;
	teamId: string;
	/** Every guild row written in the transaction must belong to this workspace. */
	workspaceId: string;
}

type Db = NodePgDatabase<typeof schema>;
export type GuildTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Runs `fn` in ONE transaction with the guild attribution set transaction-locally
 * (`set_config(…, true)`), so every trigger-written event carries `actor` and `user_id`, and
 * the scope trigger refuses rows outside `workspaceId`. The settings vanish at COMMIT or
 * ROLLBACK, so a pooled connection never leaks them into the next request.
 */
export async function withGuildTx<R>(
	database: Db,
	ctx: GuildActorContext,
	fn: (tx: GuildTx) => Promise<R>,
): Promise<R> {
	return database.transaction(async (tx) => {
		await setGuildContext(tx, ctx);
		return fn(tx);
	});
}

/** Sets the guild attribution on an already-open transaction (what withGuildTx does first). */
export async function setGuildContext(executor: SqlExecutor, ctx: GuildActorContext): Promise<void> {
	await executor.execute(sql`SELECT
		set_config('kumiai.actor', ${ctx.actor}, true),
		set_config('kumiai.user_id', ${ctx.userId ?? ""}, true),
		set_config('kumiai.team_id', ${ctx.teamId}, true),
		set_config('kumiai.workspace_id', ${ctx.workspaceId}, true)`);
}

/**
 * A guild timestamp as ISO-8601 UTC (`2026-10-18T09:00:00Z`). Kumiai stores UTC wall-clock
 * `timestamp without time zone`; raw SQL reads return it as `2026-10-18 09:00:00.123`, which
 * this reads as UTC. Dates pass through. Sub-second precision is kept only when present.
 */
export function toIsoUtc(value: Date | string | null | undefined): string | null {
	if (value === null || value === undefined) return null;
	const date =
		value instanceof Date
			? value
			: new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
	if (Number.isNaN(date.getTime())) return null;
	const iso = date.toISOString();
	return iso.endsWith(".000Z") ? `${iso.slice(0, -5)}Z` : iso;
}
