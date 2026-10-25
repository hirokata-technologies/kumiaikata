import { z } from "zod";
import { pool } from "@kata/db";
import {
	GUILD_SOURCE_TABLES,
	GuildImportError,
	SUPPORTED_SCHEMA_VERSION,
	importGuildSource,
	sourceFromJson,
} from "../tursodb-import.js";
import {
	GuildError,
	actorInput,
	assertWorkspace,
	defineTool,
	toGuildError,
	workspaceInput,
	type GuildToolDef,
} from "../registry.js";

/**
 * Contract §4.10 — importing a local guild board. The guild's `.guild/guild.db` (tursodb) is a
 * file on the caller's machine, so the caller reads it and sends its rows; the server cannot.
 * The same importer backs `pnpm guild:import`, which reads the file itself.
 */

const rows = z.array(z.record(z.string(), z.unknown()));

const sourceInput = z
	.object({
		schema_version: z.literal(SUPPORTED_SCHEMA_VERSION).describe("The guild schema.sql version of the file"),
		...(Object.fromEntries(GUILD_SOURCE_TABLES.map((table) => [table, rows.optional()])) as Record<
			string,
			z.ZodOptional<typeof rows>
		>),
	})
	.strict()
	.describe(
		"The guild.db as JSON: schema_version plus, per table, the rows exactly as `SELECT *` returns them (goal, project, requirement, plan, task, task_dependency, task_capability, graph_node, graph_edge, graph_deviation, gate, work_log, review_finding, bug, coverage, inspection, inspection_coverage, doc, doc_revision, knowledge_edge, event, guild_state). A table left out is empty.",
	);

/** Input problems are VALIDATION; a workspace that already has data is CONFLICT. */
function toImportError(err: unknown): unknown {
	if (err instanceof GuildImportError) return new GuildError(err.conflict ? "CONFLICT" : "VALIDATION", err.message);
	return toGuildError(err);
}

const importGuild = defineTool({
	name: "import_guild",
	title: "Import a local guild board",
	description:
		"Load a local guild board (the rows of `.guild/guild.db`) into this workspace, keeping every guild key and the original event feed. The workspace must hold no guild data yet (CONFLICT otherwise). All of it lands or none of it does; `dry_run` does everything and rolls it back. Returns the row counts written and any warnings.",
	input: z.object({
		workspace: workspaceInput,
		actor: actorInput,
		source: sourceInput,
		dry_run: z.boolean().optional().describe("Run the whole import, then roll it back"),
	}),
	handler: async ({ caller }, input) => {
		await assertWorkspace(caller, input.workspace);
		try {
			const report = await importGuildSource(pool, sourceFromJson(input.source), {
				workspace: input.workspace,
				teamId: caller.teamId,
				actor: input.actor,
				dryRun: input.dry_run ?? false,
			});
			return { workspace: report.workspaceId, dry_run: report.dryRun, counts: report.counts, warnings: report.warnings };
		} catch (err) {
			throw toImportError(err);
		}
	},
});

/** Contract §4.10 — import. */
export const importTools: GuildToolDef[] = [importGuild];
