import { eq, sql } from "drizzle-orm";
import { kumiaiTasks, type GuildTx } from "@kata/db";
import { GuildError } from "../registry.js";
import { findByKey, readTask, utcNow, type GuildRow } from "./work-support.js";

/**
 * claim_task (contract §4.4). The claim names `claimant`; the status move is attributed to the
 * transaction's actor by the event trigger, so the orchestrator can claim on a member's behalf.
 *
 * Without a key it follows `kumiai_v_next_task` — resume the lowest in-progress task, else claim
 * the lowest actionable todo — under a per-workspace advisory lock, re-checking the row under
 * `FOR UPDATE`. A "resume" only hands back an in-progress task that is unclaimed or already the
 * claimant's: an in-progress task somebody else holds means there is nothing for this caller
 * (the view never claims new work while one is running), so two claims never get one task.
 */
export async function claimTask(
	tx: GuildTx,
	input: { workspaceId: string; key?: string | undefined; claimant: string },
): Promise<GuildRow | null> {
	if (input.key !== undefined) {
		const row = await findByKey(tx, "kumiai_tasks", input.workspaceId, input.key, { lock: true });
		if (!(await take(tx, row, input.claimant))) {
			throw new GuildError(
				"CONFLICT",
				`Task ${input.key} is '${String(row["status"])}'${row["claimed_by"] ? ` and claimed by ${String(row["claimed_by"])}` : ""}.`,
			);
		}
		return readTask(tx, input.workspaceId, input.key);
	}

	// Serialize cursor claims per workspace. The statements after it take a fresh snapshot
	// (READ COMMITTED), so they see the claim the previous holder committed.
	await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`kumiai.claim:${input.workspaceId}`}, 0))`);

	// A concurrent set_task_status (which does not take the lock) can still move the row
	// between the view read and the row lock; then read the view again.
	for (let attempt = 0; attempt < 3; attempt++) {
		const next = await tx.execute(
			sql`SELECT id, reason FROM kumiai_v_next_task WHERE workspace_id = ${input.workspaceId} LIMIT 1`,
		);
		const cursor = next.rows[0] as { id: string; reason: string } | undefined;
		if (!cursor) return null;
		const row = await findByKey(tx, "kumiai_tasks", input.workspaceId, cursor.id, { lock: true });
		const expected = cursor.reason === "resume" ? "in-progress" : "todo";
		if (row["status"] !== expected) continue;
		if (!(await take(tx, row, input.claimant))) return null;
		return readTask(tx, input.workspaceId, cursor.id);
	}
	return null;
}

/** Takes a locked task for `claimant`; false when it is not theirs to take. */
async function take(tx: GuildTx, row: GuildRow & { id: string }, claimant: string): Promise<boolean> {
	const claimedBy = (row["claimed_by"] as string | null) ?? null;
	if (row["status"] === "todo") {
		await tx
			.update(kumiaiTasks)
			.set({ status: "in-progress", claimedBy: claimant, claimedAt: utcNow() })
			.where(eq(kumiaiTasks.id, row.id));
		return true;
	}
	if (row["status"] === "in-progress" && (claimedBy === null || claimedBy === claimant)) {
		if (claimedBy === null) {
			await tx.update(kumiaiTasks).set({ claimedBy: claimant, claimedAt: utcNow() }).where(eq(kumiaiTasks.id, row.id));
		}
		return true;
	}
	return false;
}
