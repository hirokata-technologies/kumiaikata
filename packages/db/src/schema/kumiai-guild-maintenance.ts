import { pgTable, text, timestamp, index, uniqueIndex, primaryKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { teams } from "./teams.js";
import { kumiaiWorkspaces } from "./kumiai-workspaces.js";
import { COVERAGE_RISKS, GUILD_DIRECTION_STATUSES, INSPECTION_VERDICTS } from "../guild-vocab.js";
import { keyShape, oneOf } from "./guild-checks.js";

/** guild `coverage` — evergreen quality areas. `key` is the guild's text id ('checkout-flow'). */
export const kumiaiCoverage = pgTable(
	"kumiai_coverage",
	{
		id: text("id").primaryKey(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "cascade" }),
		key: text("key").notNull(),
		/** Human name. */
		area: text("area").notNull(),
		risk: text("risk", { enum: COVERAGE_RISKS }).notNull().default("medium"),
		/** Committed e2e spec, if one exists. */
		specPath: text("spec_path"),
		lastInspectedAt: timestamp("last_inspected_at"),
		notes: text("notes").notNull().default(""),
	},
	(t) => [
		uniqueIndex("kumiai_coverage_workspace_key_idx").on(t.workspaceId, t.key),
		check("kumiai_coverage_risk_check", oneOf(t.risk, COVERAGE_RISKS)),
		check("kumiai_coverage_key_check", sql`length(${t.key}) > 0`),
	],
);

/**
 * guild `inspection` — one turn of the maintenance cycle. `trigger` has NO CHECK on purpose:
 * it is the one open enum in the guild schema.
 */
export const kumiaiInspection = pgTable(
	"kumiai_inspection",
	{
		id: text("id").primaryKey(),
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "cascade" }),
		key: text("key").notNull(),
		scope: text("scope").notNull(),
		trigger: text("trigger").notNull().default("manual"),
		status: text("status", { enum: GUILD_DIRECTION_STATUSES }).notNull().default("todo"),
		startedAt: timestamp("started_at"),
		finishedAt: timestamp("finished_at"),
	},
	(t) => [
		uniqueIndex("kumiai_inspection_workspace_key_idx").on(t.workspaceId, t.key),
		check("kumiai_inspection_status_check", oneOf(t.status, GUILD_DIRECTION_STATUSES)),
		check("kumiai_inspection_key_check", keyShape(t.key, "INSP")),
	],
);

/** `verdict` is NULL until the area is reached; 'not-reached' is not the same as NULL. */
export const kumiaiInspectionCoverage = pgTable(
	"kumiai_inspection_coverage",
	{
		teamId: text("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		workspaceId: text("workspace_id")
			.notNull()
			.references(() => kumiaiWorkspaces.id, { onDelete: "cascade" }),
		inspectionId: text("inspection_id")
			.notNull()
			.references(() => kumiaiInspection.id, { onDelete: "cascade" }),
		coverageId: text("coverage_id")
			.notNull()
			.references(() => kumiaiCoverage.id, { onDelete: "cascade" }),
		verdict: text("verdict", { enum: INSPECTION_VERDICTS }),
	},
	(t) => [
		primaryKey({ columns: [t.inspectionId, t.coverageId] }),
		index("kumiai_inspection_coverage_coverage_idx").on(t.coverageId),
		check(
			"kumiai_inspection_coverage_verdict_check",
			sql`${t.verdict} IS NULL OR ${oneOf(t.verdict, INSPECTION_VERDICTS)}`,
		),
	],
);
