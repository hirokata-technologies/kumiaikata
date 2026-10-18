/**
 * The guild's closed vocabularies (guild `schema.sql` v9.3), shared by the Drizzle schema's
 * CHECK constraints and by the TypeScript types the services use. One list per column, so a
 * CHECK and its type cannot drift apart.
 */

export const GUILD_DIRECTION_STATUSES = ["todo", "in-progress", "done"] as const;
export type GuildDirectionStatus = (typeof GUILD_DIRECTION_STATUSES)[number];

/** Kumiai's own project vocabulary. The guild reads `backlog` as `todo` (see the views). */
export const KUMIAI_PROJECT_STATUSES = ["backlog", "todo", "in-progress", "blocked", "done"] as const;
export type KumiaiProjectStatus = (typeof KUMIAI_PROJECT_STATUSES)[number];

/** Kumiai's project priority. The guild reads it as an int: urgent=1 high=2 medium=3 low=4. */
export const KUMIAI_PROJECT_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type KumiaiProjectPriority = (typeof KUMIAI_PROJECT_PRIORITIES)[number];

export const PROJECT_ISOLATIONS = ["shared", "worktree"] as const;
export type ProjectIsolation = (typeof PROJECT_ISOLATIONS)[number];

export const PLAN_APPROVALS = ["pending", "approved", "rejected"] as const;
export type PlanApproval = (typeof PLAN_APPROVALS)[number];

export const TASK_STATUSES = ["todo", "in-progress", "done", "failed", "blocked", "waived"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const GRAPH_NODE_KINDS = ["work", "gate"] as const;
export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number];

export const GRAPH_NODE_STATUSES = ["pending", "ready", "running", "done", "failed", "skipped"] as const;
export type GraphNodeStatus = (typeof GRAPH_NODE_STATUSES)[number];

export const GRAPH_DEVIATION_KINDS = ["add-node", "drop-node", "reshape", "add-gate"] as const;
export type GraphDeviationKind = (typeof GRAPH_DEVIATION_KINDS)[number];

export const GATE_KINDS = ["approve", "select-findings"] as const;
export type GateKind = (typeof GATE_KINDS)[number];

export const GATE_STATUSES = ["pending", "approved", "rejected"] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];

export const FINDING_SEVERITIES = ["critical", "major", "minor", "nit"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const FINDING_DISPOSITIONS = ["open", "fixing", "fixed", "waived"] as const;
export type FindingDisposition = (typeof FINDING_DISPOSITIONS)[number];

/** `nit` exists on findings and NOT on bugs. A bug is not a nit. */
export const BUG_SEVERITIES = ["critical", "major", "minor"] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];

export const BUG_STATUSES = ["open", "fixing", "fixed", "wontfix"] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];

export const COVERAGE_RISKS = ["high", "medium", "low"] as const;
export type CoverageRisk = (typeof COVERAGE_RISKS)[number];

export const INSPECTION_VERDICTS = ["pass", "issues", "not-reached"] as const;
export type InspectionVerdict = (typeof INSPECTION_VERDICTS)[number];

export const DOC_KINDS = ["business", "technical", "decision", "research", "runbook", "reference"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const DOC_STATUSES = ["draft", "current", "superseded", "rejected"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const KNOWLEDGE_RELS = [
	"describes",
	"decides",
	"supersedes",
	"refines",
	"depends-on",
	"contradicts",
	"derived-from",
	"evidence-for",
] as const;
export type KnowledgeRel = (typeof KNOWLEDGE_RELS)[number];

export const KNOWLEDGE_TYPES = [
	"doc",
	"goal",
	"project",
	"requirement",
	"plan",
	"task",
	"bug",
	"coverage",
	"review_finding",
] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

/** Server-generated key prefixes (`GOAL-001`, …). Zero-padded to three digits. */
export const GUILD_KEY_PREFIXES = ["GOAL", "PROJ", "REQ", "PLAN", "TASK", "BUG", "INSP"] as const;
export type GuildKeyPrefix = (typeof GUILD_KEY_PREFIXES)[number];

/** `formatKey("TASK", 7)` → `TASK-007`. Numbers past 999 are written in full (`TASK-1000`). */
export function formatKey(prefix: GuildKeyPrefix, n: number): string {
	if (!Number.isInteger(n) || n < 1) throw new RangeError(`key number must be a positive integer, got ${n}`);
	return `${prefix}-${String(n).padStart(3, "0")}`;
}

/** Kumiai project priority → the guild's 1–5 integer. */
export const GUILD_PRIORITY_OF: Record<KumiaiProjectPriority, number> = {
	urgent: 1,
	high: 2,
	medium: 3,
	low: 4,
};

/** Guild 1–5 priority → Kumiai project priority (5 is stored as `low` and reads back as 4). */
export function kumiaiPriorityOf(priority: number): KumiaiProjectPriority {
	if (priority <= 1) return "urgent";
	if (priority === 2) return "high";
	if (priority === 3) return "medium";
	return "low";
}
