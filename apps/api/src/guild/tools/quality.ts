import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
	BUG_SEVERITIES,
	BUG_STATUSES,
	COVERAGE_RISKS,
	FINDING_DISPOSITIONS,
	FINDING_SEVERITIES,
	GUILD_DIRECTION_STATUSES,
	INSPECTION_VERDICTS,
	allocateKey,
	kumiaiBug,
	kumiaiCoverage,
	kumiaiInspection,
	kumiaiInspectionCoverage,
	kumiaiReviewFinding,
	newId,
	type GuildTx,
} from "@kata/db";
import { GuildError, actorInput, defineTool, guildWrite, workspaceInput, type GuildToolDef } from "../registry.js";
import { checkExpected, optionalId, requireId } from "../services/keys.js";
import { guildTable, readRow, readRows, type GuildRow } from "../services/rows.js";
import { expectInput, instantInput, mustRow } from "../services/writes.js";

/**
 * Contract §4.6 — findings, bugs, coverage, inspections. Every write runs in one attributed
 * transaction (guildWrite), resolves keys inside the workspace (NOT_FOUND), patches only
 * what was sent, and returns the full guild-shaped row after the write. The events are the
 * warehouse triggers' (found / dispositioned / created / moved / inspected).
 */

const NOW = sql`kumiai_utc_now()`;
const taskKey = z.string().trim().min(1).describe("Task key, TASK-NNN");
const coverageKey = z.string().trim().min(1).max(128).describe("Coverage id, e.g. checkout-flow");

// ── Findings ─────────────────────────────────────────────────────────────────

const addFinding = defineTool({
	name: "add_finding",
	title: "Add a review finding",
	description: "File a review finding against a task. The reviewer is the actor. Returns the finding (its integer id).",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		task: taskKey,
		severity: z.enum(FINDING_SEVERITIES),
		summary: z.string().trim().min(1),
		detail: z.string().optional(),
		file: z.string().nullable().optional(),
		line: z.number().int().min(0).nullable().optional(),
	}),
	handler: async ({ caller }, i) =>
		guildWrite(caller, i.workspace, i.actor, async (tx) => {
			const taskId = await requireId(tx, "kumiai_tasks", i.workspace, i.task, "task");
			const [row] = await tx
				.insert(kumiaiReviewFinding)
				.values({
					teamId: caller.teamId,
					workspaceId: i.workspace,
					taskId,
					reviewer: i.actor,
					severity: i.severity,
					summary: i.summary,
					detail: i.detail ?? "",
					file: i.file ?? null,
					line: i.line ?? null,
					createdAt: NOW,
				})
				.returning({ id: kumiaiReviewFinding.id });
			const id = mustRow(row, "finding").id;
			return mustRow(await readRow(tx, guildTable("review_finding"), i.workspace, { id }), "finding");
		}),
});

const updateFinding = defineTool({
	name: "update_finding",
	title: "Update a review finding",
	description:
		"Patch a finding's disposition, fix_task or fix_ref. expect_status guards the current disposition (CONFLICT).",
	input: z.object({
		expect_status: expectInput(FINDING_DISPOSITIONS).optional(),
		workspace: workspaceInput,
		actor: actorInput,
		id: z.number().int().positive().describe("The finding's integer id"),
		disposition: z.enum(FINDING_DISPOSITIONS).optional(),
		fix_task: taskKey.nullable().optional(),
		fix_ref: z.string().nullable().optional(),
	}),
	handler: async ({ caller }, i) =>
		guildWrite(caller, i.workspace, i.actor, async (tx) => {
			const [current] = await tx
				.select({ disposition: kumiaiReviewFinding.disposition })
				.from(kumiaiReviewFinding)
				.where(and(eq(kumiaiReviewFinding.workspaceId, i.workspace), eq(kumiaiReviewFinding.id, i.id)))
				.for("update");
			if (!current) throw new GuildError("NOT_FOUND", `review_finding ${i.id} not found in this workspace.`);
			checkExpected(current.disposition, i.expect_status, `review_finding ${i.id}`);
			const patch: Partial<typeof kumiaiReviewFinding.$inferInsert> = {};
			if (i.disposition !== undefined) patch.disposition = i.disposition;
			const fixTaskId = await optionalId(tx, "kumiai_tasks", i.workspace, i.fix_task, "task");
			if (fixTaskId !== undefined) patch.fixTaskId = fixTaskId;
			if (i.fix_ref !== undefined) patch.fixRef = i.fix_ref ?? "";
			if (Object.keys(patch).length > 0) {
				await tx.update(kumiaiReviewFinding).set(patch).where(eq(kumiaiReviewFinding.id, i.id));
			}
			return mustRow(await readRow(tx, guildTable("review_finding"), i.workspace, { id: i.id }), "finding");
		}),
});

// ── Bugs ─────────────────────────────────────────────────────────────────────

const fileBug = defineTool({
	name: "file_bug",
	title: "File a bug",
	description: "File a bug. The server allocates BUG-NNN. found_by defaults to the actor. No `nit` — a bug is not a nit.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		title: z.string().trim().min(1),
		body: z.string().optional(),
		repro: z.string().optional(),
		severity: z.enum(BUG_SEVERITIES).optional(),
		requirement: z.string().trim().min(1).nullable().optional().describe("REQ-NNN"),
		found_by: z.string().trim().min(1).max(64).optional(),
	}),
	handler: async ({ caller }, i) =>
		guildWrite(caller, i.workspace, i.actor, async (tx) => {
			const requirementId = await optionalId(tx, "kumiai_requirements", i.workspace, i.requirement, "requirement");
			const key = await allocateKey(tx, i.workspace, "BUG");
			await tx.insert(kumiaiBug).values({
				id: newId(),
				teamId: caller.teamId,
				workspaceId: i.workspace,
				key,
				title: i.title,
				body: i.body ?? "",
				repro: i.repro ?? "",
				severity: i.severity ?? "major",
				status: "open",
				foundBy: i.found_by ?? i.actor,
				requirementId: requirementId ?? null,
				createdAt: NOW,
				updatedAt: NOW,
			});
			return mustRow(await readRow(tx, guildTable("bug"), i.workspace, { id: key }), "bug");
		}),
});

const updateBug = defineTool({
	name: "update_bug",
	title: "Update a bug",
	description: "Patch a bug. expect_status guards the current status (CONFLICT). fix_task: null clears it.",
	input: z.object({
		expect_status: expectInput(BUG_STATUSES).optional(),
		workspace: workspaceInput,
		actor: actorInput,
		key: z.string().trim().min(1).describe("BUG-NNN"),
		title: z.string().trim().min(1).optional(),
		body: z.string().optional(),
		repro: z.string().optional(),
		severity: z.enum(BUG_SEVERITIES).optional(),
		status: z.enum(BUG_STATUSES).optional(),
		fix_task: taskKey.nullable().optional(),
		fix_ref: z.string().nullable().optional(),
	}),
	handler: async ({ caller }, i) =>
		guildWrite(caller, i.workspace, i.actor, async (tx) => {
			const [current] = await tx
				.select({ id: kumiaiBug.id, status: kumiaiBug.status })
				.from(kumiaiBug)
				.where(and(eq(kumiaiBug.workspaceId, i.workspace), eq(kumiaiBug.key, i.key)))
				.for("update");
			if (!current) throw new GuildError("NOT_FOUND", `bug ${i.key} not found in this workspace.`);
			checkExpected(current.status, i.expect_status, `bug ${i.key}`);
			const patch: Partial<typeof kumiaiBug.$inferInsert> = {};
			if (i.title !== undefined) patch.title = i.title;
			if (i.body !== undefined) patch.body = i.body;
			if (i.repro !== undefined) patch.repro = i.repro;
			if (i.severity !== undefined) patch.severity = i.severity;
			if (i.status !== undefined) patch.status = i.status;
			const fixTaskId = await optionalId(tx, "kumiai_tasks", i.workspace, i.fix_task, "task");
			if (fixTaskId !== undefined) patch.fixTaskId = fixTaskId;
			if (i.fix_ref !== undefined) patch.fixRef = i.fix_ref ?? "";
			if (Object.keys(patch).length > 0) await tx.update(kumiaiBug).set(patch).where(eq(kumiaiBug.id, current.id));
			return mustRow(await readRow(tx, guildTable("bug"), i.workspace, { id: i.key }), "bug");
		}),
});

// ── Coverage ─────────────────────────────────────────────────────────────────

const upsertCoverage = defineTool({
	name: "upsert_coverage",
	title: "Upsert a coverage area",
	description:
		"Create a coverage area (needs `area`) or patch an existing one. Stamp last_inspected_at only when the area was actually inspected.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		id: coverageKey,
		area: z.string().trim().min(1).optional(),
		risk: z.enum(COVERAGE_RISKS).optional(),
		spec_path: z.string().nullable().optional(),
		notes: z.string().nullable().optional(),
		last_inspected_at: instantInput.nullable().optional(),
	}),
	handler: async ({ caller }, i) =>
		guildWrite(caller, i.workspace, i.actor, async (tx) => {
			const [current] = await tx
				.select({ id: kumiaiCoverage.id })
				.from(kumiaiCoverage)
				.where(and(eq(kumiaiCoverage.workspaceId, i.workspace), eq(kumiaiCoverage.key, i.id)))
				.for("update");
			if (!current) {
				if (i.area === undefined) throw new GuildError("VALIDATION", `coverage ${i.id} is new: area is required.`);
				await tx.insert(kumiaiCoverage).values({
					id: newId(),
					teamId: caller.teamId,
					workspaceId: i.workspace,
					key: i.id,
					area: i.area,
					risk: i.risk ?? "medium",
					specPath: i.spec_path ?? null,
					notes: i.notes ?? "",
					lastInspectedAt: i.last_inspected_at ?? null,
				});
			} else {
				const patch: Partial<typeof kumiaiCoverage.$inferInsert> = {};
				if (i.area !== undefined) patch.area = i.area;
				if (i.risk !== undefined) patch.risk = i.risk;
				if (i.spec_path !== undefined) patch.specPath = i.spec_path;
				if (i.notes !== undefined) patch.notes = i.notes ?? "";
				if (i.last_inspected_at !== undefined) patch.lastInspectedAt = i.last_inspected_at;
				if (Object.keys(patch).length > 0) {
					await tx.update(kumiaiCoverage).set(patch).where(eq(kumiaiCoverage.id, current.id));
				}
			}
			return mustRow(await readRow(tx, guildTable("coverage"), i.workspace, { id: i.id }), "coverage");
		}),
});

// ── Inspections ──────────────────────────────────────────────────────────────

/** An inspection row plus its areas (`inspection_coverage`), in coverage-id order. */
async function inspectionWithCoverage(tx: GuildTx, workspaceId: string, key: string): Promise<GuildRow> {
	const row = mustRow(await readRow(tx, guildTable("inspection"), workspaceId, { id: key }), "inspection");
	const areas = await readRows(tx, guildTable("inspection_coverage"), workspaceId, {
		where: { inspection_id: key },
		orderBy: [{ col: "coverage_id" }],
		limit: 500,
	});
	return { ...row, coverage: areas.rows.map((a) => ({ coverage_id: a["coverage_id"], verdict: a["verdict"] })) };
}

const createInspection = defineTool({
	name: "create_inspection",
	title: "Create an inspection",
	description:
		"Open an inspection (INSP-NNN) and seed its inspection_coverage rows (verdict NULL) for the given coverage ids.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		scope: z.string().trim().min(1),
		trigger: z.string().trim().min(1).max(64).optional().describe("Default 'manual' — the only trigger the guild allows"),
		coverage: z.array(coverageKey).max(500).optional(),
	}),
	handler: async ({ caller }, i) =>
		guildWrite(caller, i.workspace, i.actor, async (tx) => {
			const coverageIds: string[] = [];
			for (const key of new Set(i.coverage ?? [])) {
				coverageIds.push(await requireId(tx, "kumiai_coverage", i.workspace, key, "coverage"));
			}
			const key = await allocateKey(tx, i.workspace, "INSP");
			const id = newId();
			await tx.insert(kumiaiInspection).values({
				id,
				teamId: caller.teamId,
				workspaceId: i.workspace,
				key,
				scope: i.scope,
				trigger: i.trigger ?? "manual",
				status: "todo",
			});
			if (coverageIds.length > 0) {
				await tx.insert(kumiaiInspectionCoverage).values(
					coverageIds.map((coverageId) => ({
						teamId: caller.teamId,
						workspaceId: i.workspace,
						inspectionId: id,
						coverageId,
					})),
				);
			}
			return inspectionWithCoverage(tx, i.workspace, key);
		}),
});

const updateInspection = defineTool({
	name: "update_inspection",
	title: "Update an inspection",
	description: "Patch an inspection's status, started_at, finished_at. expect_status guards the current status (CONFLICT).",
	input: z.object({
		expect_status: expectInput(GUILD_DIRECTION_STATUSES).optional(),
		workspace: workspaceInput,
		actor: actorInput,
		key: z.string().trim().min(1).describe("INSP-NNN"),
		status: z.enum(GUILD_DIRECTION_STATUSES).optional(),
		started_at: instantInput.nullable().optional(),
		finished_at: instantInput.nullable().optional(),
	}),
	handler: async ({ caller }, i) =>
		guildWrite(caller, i.workspace, i.actor, async (tx) => {
			const [current] = await tx
				.select({ id: kumiaiInspection.id, status: kumiaiInspection.status })
				.from(kumiaiInspection)
				.where(and(eq(kumiaiInspection.workspaceId, i.workspace), eq(kumiaiInspection.key, i.key)))
				.for("update");
			if (!current) throw new GuildError("NOT_FOUND", `inspection ${i.key} not found in this workspace.`);
			checkExpected(current.status, i.expect_status, `inspection ${i.key}`);
			const patch: Partial<typeof kumiaiInspection.$inferInsert> = {};
			if (i.status !== undefined) patch.status = i.status;
			if (i.started_at !== undefined) patch.startedAt = i.started_at;
			if (i.finished_at !== undefined) patch.finishedAt = i.finished_at;
			if (Object.keys(patch).length > 0) {
				await tx.update(kumiaiInspection).set(patch).where(eq(kumiaiInspection.id, current.id));
			}
			return inspectionWithCoverage(tx, i.workspace, i.key);
		}),
});

const setInspectionVerdict = defineTool({
	name: "set_inspection_verdict",
	title: "Set an inspection verdict",
	description:
		"Record the verdict (pass | issues | not-reached) for one coverage area of an inspection. Adds the area to the inspection when it was not seeded.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		inspection: z.string().trim().min(1).describe("INSP-NNN"),
		coverage: coverageKey,
		verdict: z.enum(INSPECTION_VERDICTS),
	}),
	handler: async ({ caller }, i) =>
		guildWrite(caller, i.workspace, i.actor, async (tx) => {
			const inspectionId = await requireId(tx, "kumiai_inspection", i.workspace, i.inspection, "inspection");
			const coverageId = await requireId(tx, "kumiai_coverage", i.workspace, i.coverage, "coverage");
			await tx
				.insert(kumiaiInspectionCoverage)
				.values({ teamId: caller.teamId, workspaceId: i.workspace, inspectionId, coverageId, verdict: i.verdict })
				.onConflictDoUpdate({
					target: [kumiaiInspectionCoverage.inspectionId, kumiaiInspectionCoverage.coverageId],
					set: { verdict: i.verdict },
				});
			return mustRow(
				await readRow(tx, guildTable("inspection_coverage"), i.workspace, {
					inspection_id: i.inspection,
					coverage_id: i.coverage,
				}),
				"inspection_coverage",
			);
		}),
});

/** Contract §4.6 — findings, bugs, coverage, inspections. */
export const qualityTools: GuildToolDef[] = [
	addFinding,
	updateFinding,
	fileBug,
	updateBug,
	upsertCoverage,
	createInspection,
	updateInspection,
	setInspectionVerdict,
];
