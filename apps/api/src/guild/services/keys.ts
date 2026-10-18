import { sql } from "drizzle-orm";
import type { SqlExecutor } from "@kata/db";
import { GuildError } from "../registry.js";

/**
 * Guild key → Kumiai internal id, inside one workspace (contract §2 rule 3). A key that is
 * not in the workspace is NOT_FOUND, whether it is missing or belongs to another workspace.
 */

/** Tables addressed by a text key column, and that column. */
const KEYED = {
	kumiai_goals: "key",
	kumiai_projects: "key",
	kumiai_requirements: "key",
	kumiai_plans: "key",
	kumiai_tasks: "key",
	kumiai_bug: "key",
	kumiai_inspection: "key",
	kumiai_coverage: "key",
	kumiai_graph_node: "key",
	kumiai_doc: "slug",
} as const;
export type KeyedTable = keyof typeof KEYED;

/** The internal id of `key` in `table`, or null. `forUpdate` locks the row for the transaction. */
export async function findId(
	exec: SqlExecutor,
	table: KeyedTable,
	workspaceId: string,
	key: string,
	opts: { forUpdate?: boolean } = {},
): Promise<string | null> {
	const result = await exec.execute(sql`
		SELECT id FROM ${sql.identifier(table)}
		 WHERE workspace_id = ${workspaceId} AND ${sql.identifier(KEYED[table])} = ${key}
		 ${opts.forUpdate ? sql`FOR UPDATE` : sql``}`);
	const id = result.rows[0]?.["id"];
	return typeof id === "string" ? id : null;
}

/** Like `findId`, but NOT_FOUND names the missing `what` (`task TASK-404`). */
export async function requireId(
	exec: SqlExecutor,
	table: KeyedTable,
	workspaceId: string,
	key: string,
	what: string,
	opts: { forUpdate?: boolean } = {},
): Promise<string> {
	const id = await findId(exec, table, workspaceId, key, opts);
	if (id === null) throw new GuildError("NOT_FOUND", `${what} ${key} not found in this workspace.`);
	return id;
}

/** `requireId` for an optional/nullable key: undefined stays undefined, null stays null. */
export async function optionalId(
	exec: SqlExecutor,
	table: KeyedTable,
	workspaceId: string,
	key: string | null | undefined,
	what: string,
): Promise<string | null | undefined> {
	if (key === undefined || key === null) return key;
	return requireId(exec, table, workspaceId, key, what);
}

/** The `expect_status` guard (contract §2 rule 9): CONFLICT when `current` is not expected. */
export function checkExpected(
	current: string,
	expected: string | readonly string[] | undefined,
	what: string,
): void {
	if (expected === undefined) return;
	const allowed = typeof expected === "string" ? [expected] : expected;
	if (!allowed.includes(current)) {
		throw new GuildError(
			"CONFLICT",
			`${what} is ${current}, expected ${allowed.join(" or ")}. Nothing was written.`,
		);
	}
}
