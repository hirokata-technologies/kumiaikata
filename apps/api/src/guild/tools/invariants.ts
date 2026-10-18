import { z } from "zod";
import { db } from "@kata/db";
import { GuildError, assertWorkspace, defineTool, workspaceInput, type GuildToolDef } from "../registry.js";
import { findId } from "../services/keys.js";
import { INVARIANT_PROCESSES, PER_REQUIREMENT_PROCESSES, runInvariants } from "../services/invariants.js";

const checkInvariants = defineTool({
	name: "check_invariants",
	title: "Check the guild's invariants",
	description:
		"Run guild docs/expectations.md against the workspace: the global invariants G1–G11, plus a process's postconditions when `process` is given (new-requirement needs `requirement`). Returns {ok, failures:[{id, description, rows}], checked, skipped}. Dashboard (§6), git (§11.f) and before/after fingerprint checks stay local and are listed in `skipped`.",
	input: z.object({
		workspace: workspaceInput,
		process: z.enum(INVARIANT_PROCESSES).optional(),
		requirement: z.string().trim().min(1).optional().describe("REQ-NNN for a per-requirement section (§4)"),
	}),
	readOnly: true,
	handler: async ({ caller }, { workspace, process, requirement }) => {
		await assertWorkspace(caller, workspace);
		if (requirement !== undefined && (await findId(db, "kumiai_requirements", workspace, requirement)) === null) {
			throw new GuildError("NOT_FOUND", `requirement ${requirement} not found in this workspace.`);
		}
		if (process && PER_REQUIREMENT_PROCESSES.has(process) && requirement === undefined) {
			throw new GuildError(
				"VALIDATION",
				`process "${process}" is per requirement: pass requirement (REQ-NNN), as §4's REQ-NNN.`,
			);
		}
		const report = await runInvariants(workspace, process, requirement ?? null);
		return { ...report, ...(requirement ? { requirement } : {}) };
	},
});

/** Contract §4.2 — check_invariants. */
export const invariantsTools: GuildToolDef[] = [checkInvariants];
