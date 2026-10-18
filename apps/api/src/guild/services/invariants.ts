import type { PoolClient } from "pg";
import { pool } from "@kata/db";

/**
 * The guild's docs/expectations.md, ported to Kumiai's Postgres (contract §4.2
 * `check_invariants`). Each assertion is the guild's SQL translated over the workspace:
 * the guild's table and view names are bound, per query, to CTEs over `kumiai_g_*` /
 * `kumiai_v_*` filtered by `$1` (the workspace), so every clause reads like the original.
 * `$2` is the requirement key for per-requirement sections.
 *
 * Every assertion returns ZERO ROWS when healthy; the offending rows otherwise, as arrays of
 * text in the guild's column order, sorted byte-wise (SQLite's `ORDER BY breach, row_id`).
 *
 * SQLite → Postgres: GLOB → `~`, `instr`/`substr` → `position`/`split_part`, `json_*` →
 * `jsonb` operators, `group_concat` → `string_agg`, `COALESCE(ts,'')` → `IS NULL`, and
 * timestamps print through `kumiai_iso`. All SQL here is static: no input reaches it except
 * as a bound parameter.
 */

export interface Failure {
	id: string;
	description: string;
	rows: string[][];
	/** A report, not a failure (e.g. §9.c): it does not make `ok` false. */
	advisory?: true;
}

export interface Skipped {
	id: string;
	reason: string;
}

interface Ctx {
	client: PoolClient;
	workspaceId: string;
	requirement: string | null;
}

interface Invariant {
	id: string;
	description: string;
	/** `$1` = workspace, `$2` = requirement key (only when `perRequirement`). */
	sql?: string;
	/** Extra CTEs appended after the guild-name CTEs (e.g. the shift window). */
	with?: string;
	/** Assertions that need a value computed in JS first. */
	run?: (ctx: Ctx) => Promise<string[][]>;
	perRequirement?: true;
	advisory?: true;
}

// ── Guild names → workspace-scoped CTEs ──────────────────────────────────────

const GUILD_TABLES = [
	"goal",
	"project",
	"requirement",
	"plan",
	"task",
	"task_dependency",
	"task_capability",
	"graph_node",
	"graph_edge",
	"graph_deviation",
	"gate",
	"work_log",
	"review_finding",
	"bug",
	"coverage",
	"inspection",
	"inspection_coverage",
	"doc",
	"knowledge_edge",
	"doc_revision",
	"event",
	"guild_state",
];

const GUILD_VIEWS = [
	"v_task_who",
	"v_task_deps",
	"v_requirement_progress",
	"v_open_findings",
	"v_next_task",
	"v_ready_nodes",
	"v_blocked_tasks",
	"v_coverage_due",
	"v_knowledge_dangling",
];

function ctes(body: string): string[] {
	const out: string[] = [];
	for (const t of GUILD_TABLES) {
		if (new RegExp(`\\b${t}\\b`).test(body)) out.push(`${t} AS (SELECT * FROM kumiai_g_${t} WHERE workspace_id = $1)`);
	}
	for (const v of GUILD_VIEWS) {
		if (new RegExp(`\\b${v}\\b`).test(body)) out.push(`${v} AS (SELECT * FROM kumiai_${v} WHERE workspace_id = $1)`);
	}
	return out;
}

function compile(inv: Invariant): string {
	const body = inv.sql ?? "";
	const all = [...ctes(`${inv.with ?? ""}\n${body}`), ...(inv.with ? [inv.with] : [])];
	// Postgres needs $1 used for the parameter to be typed; every CTE uses it, and a query
	// with no CTE still filters by it below.
	return `${all.length > 0 ? `WITH ${all.join(",\n")}\n` : ""}${body}`;
}

/** The text of a guild_state value read as a JSON integer the SQLite way: CAST(x AS INTEGER). */
const SAFE_INT = (expr: string) => `COALESCE(NULLIF(substring(${expr} from '^\\s*([+-]?[0-9]+)'), ''), '0')::bigint`;

// ── G1 over the base tables (the g-views inner-join their parents) ──────────

function fk(
	ref: string,
	child: string,
	rowId: string,
	col: string,
	parent: string,
	nullable: boolean,
): string {
	return `SELECT '${ref}' AS ref, ${rowId} AS row_id,
	       COALESCE(kumiai_key_of('${parent}', c.${col}), c.${col}) AS missing
	  FROM ${child} c
	 WHERE c.workspace_id = $1${nullable ? ` AND c.${col} IS NOT NULL` : ""}
	   AND NOT EXISTS (SELECT 1 FROM ${parent} p WHERE p.id = c.${col} AND p.workspace_id = c.workspace_id)`;
}

const key = (table: string, col: string) => `COALESCE(kumiai_key_of('${table}', c.${col}), c.${col})`;

const G1 = [
	fk("task.requirement_id", "kumiai_tasks", "c.key", "requirement_id", "kumiai_requirements", false),
	fk("task.plan_id", "kumiai_tasks", "c.key", "plan_id", "kumiai_plans", true),
	fk("project.goal_id", "kumiai_projects", "c.key", "goal_id", "kumiai_goals", false),
	fk("requirement.project_id", "kumiai_requirements", "c.key", "project_id", "kumiai_projects", true),
	fk("plan.requirement_id", "kumiai_plans", "c.key", "requirement_id", "kumiai_requirements", false),
	fk("plan.gate_node_id", "kumiai_plans", "c.key", "gate_node_id", "kumiai_graph_node", true),
	// Kumiai: plan.task_id is the one guild FK Postgres does not enforce (circular import).
	fk("plan.task_id", "kumiai_plans", "c.key", "task_id", "kumiai_tasks", true),
	fk("graph_node.requirement_id", "kumiai_graph_node", "c.key", "requirement_id", "kumiai_requirements", false),
	fk("graph_node.task_id", "kumiai_graph_node", "c.key", "task_id", "kumiai_tasks", true),
	fk(
		"graph_edge.from_node",
		"kumiai_graph_edge",
		`${key("kumiai_graph_node", "from_node")} || ' -> ' || ${key("kumiai_graph_node", "to_node")}`,
		"from_node",
		"kumiai_graph_node",
		false,
	),
	fk(
		"graph_edge.to_node",
		"kumiai_graph_edge",
		`${key("kumiai_graph_node", "from_node")} || ' -> ' || ${key("kumiai_graph_node", "to_node")}`,
		"to_node",
		"kumiai_graph_node",
		false,
	),
	fk("gate.node_id", "kumiai_gate", key("kumiai_graph_node", "node_id"), "node_id", "kumiai_graph_node", false),
	fk(
		"task_dependency.task_id",
		"kumiai_task_dependency",
		`${key("kumiai_tasks", "task_id")} || ' -> ' || ${key("kumiai_tasks", "depends_on")}`,
		"task_id",
		"kumiai_tasks",
		false,
	),
	fk(
		"task_dependency.depends_on",
		"kumiai_task_dependency",
		`${key("kumiai_tasks", "task_id")} || ' -> ' || ${key("kumiai_tasks", "depends_on")}`,
		"depends_on",
		"kumiai_tasks",
		false,
	),
	fk("review_finding.task_id", "kumiai_review_finding", "c.id::text", "task_id", "kumiai_tasks", false),
	fk("review_finding.fix_task_id", "kumiai_review_finding", "c.id::text", "fix_task_id", "kumiai_tasks", true),
	fk("bug.fix_task_id", "kumiai_bug", "c.key", "fix_task_id", "kumiai_tasks", true),
	fk("bug.requirement_id", "kumiai_bug", "c.key", "requirement_id", "kumiai_requirements", true),
	fk("work_log.task_id", "kumiai_work_log", "c.id::text", "task_id", "kumiai_tasks", false),
	fk(
		"task_capability.task_id",
		"kumiai_task_capability",
		`${key("kumiai_tasks", "task_id")} || '/' || c.capability`,
		"task_id",
		"kumiai_tasks",
		false,
	),
	fk(
		"inspection_coverage.inspection_id",
		"kumiai_inspection_coverage",
		`${key("kumiai_inspection", "inspection_id")} || '/' || ${key("kumiai_coverage", "coverage_id")}`,
		"inspection_id",
		"kumiai_inspection",
		false,
	),
	fk(
		"inspection_coverage.coverage_id",
		"kumiai_inspection_coverage",
		`${key("kumiai_inspection", "inspection_id")} || '/' || ${key("kumiai_coverage", "coverage_id")}`,
		"coverage_id",
		"kumiai_coverage",
		false,
	),
	fk("graph_deviation.requirement_id", "kumiai_graph_deviation", "c.id::text", "requirement_id", "kumiai_requirements", false),
].join("\nUNION ALL\n");

// ── §3 Global invariants ─────────────────────────────────────────────────────

/** Guild tables a non-shift event may name, plus the guild's sanctioned exceptions. */
const SUBJECT_TYPES = [
	...GUILD_TABLES,
	"schema_version",
	"shift", // a span, not a row (G7)
	"agent", // history from migration 007 (G7)
	"capability_request", // history from migration 007 (G7)
	"release", // Kumiai: guild:release records `released` with subject_type 'release'
]
	.map((t) => `'${t}'`)
	.join(",");

const PRIO = (t: string) =>
	`SELECT '${t}.priority', id, CAST(priority AS TEXT) FROM ${t} WHERE priority NOT BETWEEN 1 AND 5`;
const KEY_SHAPE = (t: string, prefix: string) =>
	`SELECT '${t}' AS tbl, id FROM ${t} WHERE id !~ '^${prefix}-[0-9]{3,4}$'`;

export const GLOBAL_INVARIANTS: Invariant[] = [
	{ id: "G1", description: "referential health", sql: G1 },
	{
		id: "G2",
		description: "vocabulary conformance",
		sql: `
SELECT 'goal.status' AS col, id AS row_id, status AS value FROM goal WHERE status NOT IN ('todo','in-progress','done')
UNION ALL SELECT 'project.status', id, status FROM project WHERE status NOT IN ('todo','in-progress','done','blocked')
UNION ALL SELECT 'project.isolation', id, isolation FROM project WHERE isolation NOT IN ('shared','worktree')
UNION ALL SELECT 'project.concurrent', id, CAST(concurrent AS TEXT) FROM project WHERE concurrent NOT IN (0,1)
UNION ALL SELECT 'project.worktree_path', id, COALESCE(worktree_path,'') FROM project WHERE isolation = 'shared' AND worktree_path IS NOT NULL
UNION ALL SELECT 'requirement.status', id, status FROM requirement WHERE status NOT IN ('todo','in-progress','done')
UNION ALL SELECT 'plan.status', id, status FROM plan WHERE status NOT IN ('todo','in-progress','done')
UNION ALL SELECT 'plan.approval', id, approval FROM plan WHERE approval NOT IN ('pending','approved','rejected')
UNION ALL SELECT 'task.status', id, status FROM task WHERE status NOT IN ('todo','in-progress','done','failed','blocked','waived')
UNION ALL SELECT 'graph_node.kind', id, kind FROM graph_node WHERE kind NOT IN ('work','gate')
UNION ALL SELECT 'graph_node.status', id, status FROM graph_node WHERE status NOT IN ('pending','ready','running','done','failed','skipped')
UNION ALL SELECT 'graph_deviation.kind', CAST(id AS TEXT), kind FROM graph_deviation WHERE kind NOT IN ('add-node','drop-node','reshape','add-gate')
UNION ALL SELECT 'gate.kind', node_id, kind FROM gate WHERE kind NOT IN ('approve','select-findings')
UNION ALL SELECT 'gate.status', node_id, status FROM gate WHERE status NOT IN ('pending','approved','rejected')
UNION ALL SELECT 'review_finding.severity', CAST(id AS TEXT), severity FROM review_finding WHERE severity NOT IN ('critical','major','minor','nit')
UNION ALL SELECT 'review_finding.disposition', CAST(id AS TEXT), disposition FROM review_finding WHERE disposition NOT IN ('open','fixing','fixed','waived')
UNION ALL SELECT 'bug.severity', id, severity FROM bug WHERE severity NOT IN ('critical','major','minor')
UNION ALL SELECT 'bug.status', id, status FROM bug WHERE status NOT IN ('open','fixing','fixed','wontfix')
UNION ALL SELECT 'coverage.risk', id, risk FROM coverage WHERE risk NOT IN ('high','medium','low')
UNION ALL SELECT 'inspection.status', id, status FROM inspection WHERE status NOT IN ('todo','in-progress','done')
UNION ALL SELECT 'inspection_coverage.verdict', inspection_id || '/' || coverage_id, verdict FROM inspection_coverage WHERE verdict IS NOT NULL AND verdict NOT IN ('pass','issues','not-reached')
UNION ALL SELECT 'task_capability.required', task_id || '/' || capability, CAST(required AS TEXT) FROM task_capability WHERE required NOT IN (0,1)
UNION ALL ${PRIO("goal")}
UNION ALL ${PRIO("requirement")}
UNION ALL ${PRIO("task")}
UNION ALL SELECT 'event.payload', CAST(id AS TEXT), payload::text FROM event WHERE jsonb_typeof(payload) <> 'object'
UNION ALL SELECT 'task.files', id, files::text FROM task WHERE jsonb_typeof(files) <> 'array'`,
	},
	{
		id: "G3",
		description: "id conformance",
		sql: `
${KEY_SHAPE("goal", "GOAL")}
UNION ALL ${KEY_SHAPE("project", "PROJ")}
UNION ALL ${KEY_SHAPE("requirement", "REQ")}
UNION ALL ${KEY_SHAPE("plan", "PLAN")}
UNION ALL ${KEY_SHAPE("task", "TASK")}
UNION ALL ${KEY_SHAPE("bug", "BUG")}
UNION ALL ${KEY_SHAPE("inspection", "INSP")}
UNION ALL SELECT 'graph_node', id FROM graph_node WHERE split_part(id, '/', 1) <> requirement_id
UNION ALL SELECT 'graph_node.node_key', id FROM graph_node WHERE position('/' in id) = 0`,
	},
	{
		id: "G4",
		description: "gate integrity",
		sql: `
SELECT 'past-unresolved-gate' AS breach, n.id AS row_id, g.node_id AS detail
  FROM graph_node n
  JOIN graph_edge e ON e.to_node = n.id
  JOIN graph_node p ON p.id = e.from_node AND p.kind = 'gate'
  JOIN gate g ON g.node_id = p.id
 WHERE n.status IN ('running','done','failed') AND g.status = 'pending'
UNION ALL
SELECT 'built-before-gate-plan', t.id, g.status
  FROM task t
  JOIN graph_node n ON n.requirement_id = t.requirement_id AND n.node_key = 'gate-plan'
  JOIN gate g ON g.node_id = n.id
 WHERE g.status <> 'approved' AND t.status <> 'todo'
UNION ALL
SELECT 'gate-node-no-row', n.id, n.node_key FROM graph_node n
 WHERE n.kind = 'gate' AND NOT EXISTS (SELECT 1 FROM gate g WHERE g.node_id = n.id)
UNION ALL
SELECT 'gate-row-on-work-node', g.node_id, n.kind FROM gate g JOIN graph_node n ON n.id = g.node_id WHERE n.kind <> 'gate'
UNION ALL
SELECT 'decided-gate-node-not-moved', g.node_id, n.status FROM gate g JOIN graph_node n ON n.id = g.node_id
 WHERE g.status <> 'pending' AND n.status NOT IN ('done','skipped')
UNION ALL
SELECT 'gate-decided-no-timestamp', g.node_id, g.status FROM gate g WHERE g.status <> 'pending' AND g.decided_at IS NULL
UNION ALL
SELECT 'select-findings-no-decision', g.node_id, g.status FROM gate g WHERE g.kind = 'select-findings' AND g.status = 'approved' AND COALESCE(g.decision,'') = ''
UNION ALL
SELECT 'added-gate', n.id, n.node_key FROM graph_node n
 WHERE n.kind = 'gate'
   AND (SELECT value FROM guild_state WHERE key = 'graph-template:' || n.requirement_id) = 'standard'
   AND n.node_key NOT IN ('gate-plan','gate-repairs')
UNION ALL
SELECT 'dropped-gate', r.id, k.k
  FROM requirement r
 CROSS JOIN (SELECT 'gate-plan' AS k UNION ALL SELECT 'gate-repairs') k
 WHERE (SELECT value FROM guild_state WHERE key = 'graph-template:' || r.id) = 'standard'
   AND NOT EXISTS (SELECT 1 FROM graph_node n WHERE n.requirement_id = r.id AND n.node_key = k.k AND n.kind = 'gate')
UNION ALL
SELECT 'add-gate-deviation', CAST(d.id AS TEXT), d.node_key FROM graph_deviation d WHERE d.kind = 'add-gate'
UNION ALL
SELECT 'graph-without-template', n.requirement_id, 'guild_state graph-template missing'
  FROM graph_node n
 WHERE NOT EXISTS (SELECT 1 FROM guild_state s WHERE s.key = 'graph-template:' || n.requirement_id)
 GROUP BY n.requirement_id`,
	},
	{
		id: "G5",
		description: "ticket routing",
		sql: `
SELECT 'no-pin-no-capabilities' AS breach, t.id AS row_id, t.status AS detail
  FROM task t
 WHERE t.status IN ('todo','in-progress') AND COALESCE(t.agent,'') = ''
   AND NOT EXISTS (SELECT 1 FROM task_capability c WHERE c.task_id = t.id)
UNION ALL
SELECT 'preferred-only-capabilities', tc.task_id, 'no required=1 row'
  FROM task_capability tc JOIN task t ON t.id = tc.task_id
 WHERE t.status IN ('todo','in-progress') AND COALESCE(t.agent,'') = ''
   AND NOT EXISTS (SELECT 1 FROM task_capability r WHERE r.task_id = tc.task_id AND r.required = 1)
 GROUP BY tc.task_id
UNION ALL
SELECT 'blocked-with-a-pin', t.id, t.agent FROM task t
 WHERE t.status = 'blocked' AND COALESCE(t.agent,'') <> ''
UNION ALL
SELECT 'claimed-by-nobody-while-running', t.id, t.status FROM task t
 WHERE t.status = 'in-progress' AND COALESCE(t.claimed_by,'') = ''`,
	},
	{
		id: "G6",
		description: "closure and records",
		sql: `
SELECT 'requirement-done-over-open-task' AS breach, p.id AS row_id, 'tasks_open=' || p.tasks_open AS detail
  FROM v_requirement_progress p WHERE p.status = 'done' AND p.tasks_open > 0
UNION ALL
SELECT 'requirement-done-with-pending-gate', n.requirement_id, g.node_id
  FROM gate g JOIN graph_node n ON n.id = g.node_id JOIN requirement r ON r.id = n.requirement_id
 WHERE r.status = 'done' AND g.status = 'pending'
UNION ALL
SELECT 'requirement-done-with-unfinished-node', n.requirement_id, n.id || '=' || n.status
  FROM graph_node n JOIN requirement r ON r.id = n.requirement_id
 WHERE r.status = 'done' AND n.status NOT IN ('done','skipped')
UNION ALL
SELECT 'requirement-done-with-open-finding', f.requirement_id, CAST(f.id AS TEXT)
  FROM v_open_findings f JOIN requirement r ON r.id = f.requirement_id WHERE r.status = 'done'
UNION ALL
SELECT 'project-done-over-open-requirement', r.project_id, r.id
  FROM requirement r JOIN project p ON p.id = r.project_id WHERE p.status = 'done' AND r.status <> 'done'
UNION ALL
SELECT 'goal-done-over-open-project', p.goal_id, p.id
  FROM project p JOIN goal g ON g.id = p.goal_id WHERE g.status = 'done' AND p.status <> 'done'
UNION ALL
SELECT 'task-built-on-unapproved-plan', t.id, p.id || '=' || p.approval
  FROM task t JOIN plan p ON p.id = t.plan_id
 WHERE t.status IN ('in-progress','done') AND p.approval <> 'approved'
   AND p.task_id IS NULL
UNION ALL
SELECT 'finding-fixing-without-task', CAST(f.id AS TEXT), f.disposition FROM review_finding f WHERE f.disposition IN ('fixing','fixed') AND f.fix_task_id IS NULL AND trim(COALESCE(f.fix_ref,'')) = ''
UNION ALL
SELECT 'bug-fixing-without-task', b.id, b.status FROM bug b WHERE b.status IN ('fixing','fixed') AND b.fix_task_id IS NULL AND trim(COALESCE(b.fix_ref,'')) = ''
UNION ALL
SELECT 'finding-open-past-gate-repairs', CAST(f.id AS TEXT), f.requirement_id
  FROM v_open_findings f
  JOIN graph_node n ON n.requirement_id = f.requirement_id AND n.node_key = 'gate-repairs'
  JOIN gate g ON g.node_id = n.id
 WHERE g.status <> 'pending' AND f.disposition = 'open'
UNION ALL
SELECT 'in-progress-unclaimed', t.id, COALESCE(t.claimed_by,'(null)') FROM task t WHERE t.status = 'in-progress' AND COALESCE(t.claimed_by,'') = ''
UNION ALL
SELECT 'todo-but-claimed', t.id, t.claimed_by FROM task t WHERE t.status = 'todo' AND COALESCE(t.claimed_by,'') <> ''
UNION ALL
SELECT 'claimed-without-timestamp', t.id, t.claimed_by FROM task t WHERE COALESCE(t.claimed_by,'') <> '' AND t.claimed_at IS NULL
UNION ALL
SELECT 'updated-before-created', t.id, kumiai_iso(t.created_at) || ' > ' || kumiai_iso(t.updated_at) FROM task t WHERE t.updated_at < t.created_at
UNION ALL
SELECT 'requirement-updated-before-created', r.id, kumiai_iso(r.created_at) || ' > ' || kumiai_iso(r.updated_at) FROM requirement r WHERE r.updated_at < r.created_at
UNION ALL
SELECT 'cursor-multi-row', 'v_next_task', CAST((SELECT COUNT(*) FROM v_next_task) AS TEXT) WHERE (SELECT COUNT(*) FROM v_next_task) > 1`,
	},
	{
		id: "G7",
		description: "event coverage",
		sql: `
SELECT 'no-created-event' AS breach, 'goal' AS tbl, id AS row_id FROM goal g WHERE NOT EXISTS (SELECT 1 FROM event e WHERE e.subject_type='goal' AND e.subject_id=g.id AND e.verb='created')
UNION ALL SELECT 'no-created-event','project', id FROM project p WHERE NOT EXISTS (SELECT 1 FROM event e WHERE e.subject_type='project' AND e.subject_id=p.id AND e.verb='created')
UNION ALL SELECT 'no-created-event','requirement', id FROM requirement r WHERE NOT EXISTS (SELECT 1 FROM event e WHERE e.subject_type='requirement' AND e.subject_id=r.id AND e.verb='created')
UNION ALL SELECT 'no-created-event','plan', id FROM plan p WHERE NOT EXISTS (SELECT 1 FROM event e WHERE e.subject_type='plan' AND e.subject_id=p.id AND e.verb='created')
UNION ALL SELECT 'no-created-event','task', id FROM task t WHERE NOT EXISTS (SELECT 1 FROM event e WHERE e.subject_type='task' AND e.subject_id=t.id AND e.verb='created')
UNION ALL SELECT 'no-created-event','bug', id FROM bug b WHERE NOT EXISTS (SELECT 1 FROM event e WHERE e.subject_type='bug' AND e.subject_id=b.id AND e.verb='created')
UNION ALL SELECT 'no-created-event','coverage', id FROM coverage c WHERE NOT EXISTS (SELECT 1 FROM event e WHERE e.subject_type='coverage' AND e.subject_id=c.id AND e.verb='created')
UNION ALL SELECT 'no-found-event','review_finding', CAST(f.id AS TEXT) FROM review_finding f
 WHERE NOT EXISTS (SELECT 1 FROM event e WHERE e.subject_type='task' AND e.subject_id=f.task_id AND e.verb='found'
                     AND (e.payload->>'finding_id') = f.id::text)
UNION ALL SELECT 'no-created-event','work_log', CAST(w.id AS TEXT) FROM work_log w WHERE NOT EXISTS (SELECT 1 FROM event e WHERE e.subject_type='task' AND e.subject_id=w.task_id AND e.verb='logged')
UNION ALL
SELECT 'no-moved-event','task', t.id FROM task t WHERE t.status <> 'todo' AND NOT EXISTS (SELECT 1 FROM event e WHERE e.subject_type='task' AND e.subject_id=t.id AND e.verb='moved')
UNION ALL SELECT 'no-moved-event','requirement', r.id FROM requirement r WHERE r.status <> 'todo' AND NOT EXISTS (SELECT 1 FROM event e WHERE e.subject_type='requirement' AND e.subject_id=r.id AND e.verb='moved')
UNION ALL SELECT 'no-moved-event','graph_node', n.id FROM graph_node n WHERE n.status <> 'pending' AND NOT EXISTS (SELECT 1 FROM event e WHERE e.subject_type='graph_node' AND e.subject_id=n.id AND e.verb='node-moved')
UNION ALL SELECT 'no-decided-event','gate', g.node_id FROM gate g WHERE g.status <> 'pending' AND NOT EXISTS (SELECT 1 FROM event e WHERE e.subject_type='gate' AND e.subject_id=g.node_id AND e.verb='decided')
UNION ALL
SELECT 'empty-actor','event', CAST(e.id AS TEXT) FROM event e WHERE trim(e.actor) = ''
UNION ALL SELECT 'unknown-subject-type','event', CAST(e.id AS TEXT) || ':' || e.subject_type FROM event e
 WHERE e.subject_type NOT IN (${SUBJECT_TYPES})`,
	},
	{
		id: "G8",
		description: "graph structure",
		sql: `
SELECT 'orphan-node' AS breach, n.id AS row_id, 'no edge in or out' AS detail
  FROM graph_node n
 WHERE NOT EXISTS (SELECT 1 FROM graph_edge e WHERE e.from_node = n.id OR e.to_node = n.id)
   AND (SELECT COUNT(*) FROM graph_node m WHERE m.requirement_id = n.requirement_id) > 1
UNION ALL
SELECT 'cross-requirement-edge', e.from_node || ' -> ' || e.to_node, f.requirement_id || ' -> ' || t.requirement_id
  FROM graph_edge e JOIN graph_node f ON f.id = e.from_node JOIN graph_node t ON t.id = e.to_node
 WHERE f.requirement_id <> t.requirement_id
UNION ALL
SELECT 'two-cycle', e1.from_node || ' <-> ' || e1.to_node, 'mutual edge'
  FROM graph_edge e1 JOIN graph_edge e2 ON e2.from_node = e1.to_node AND e2.to_node = e1.from_node
 WHERE e1.from_node COLLATE "C" < e1.to_node
UNION ALL
SELECT 'dropped-required-node', r.id, k.k
  FROM requirement r CROSS JOIN (SELECT 'gate-plan' AS k UNION ALL SELECT 'implement'
                           UNION ALL SELECT 'gate-repairs' UNION ALL SELECT 'document') k
 WHERE (SELECT value FROM guild_state WHERE key = 'graph-template:' || r.id) = 'standard'
   AND NOT EXISTS (SELECT 1 FROM graph_node n WHERE n.requirement_id = r.id AND n.node_key = k.k)
UNION ALL
SELECT 'dropped-optional-node-no-deviation', r.id, k.k
  FROM requirement r CROSS JOIN (SELECT 'test-plan' AS k UNION ALL SELECT 'test-write'
                           UNION ALL SELECT 'review' UNION ALL SELECT 'repair') k
 WHERE (SELECT value FROM guild_state WHERE key = 'graph-template:' || r.id) = 'standard'
   AND NOT EXISTS (SELECT 1 FROM graph_node n WHERE n.requirement_id = r.id AND n.node_key = k.k)
   AND NOT EXISTS (SELECT 1 FROM graph_deviation d WHERE d.requirement_id = r.id AND d.kind = 'drop-node' AND d.node_key = k.k)
UNION ALL
SELECT 'skipped-assurance-step-no-deviation', n.id, n.node_key
  FROM graph_node n
 WHERE n.status = 'skipped' AND n.node_key IN ('test-plan','test-write','review')
   AND (SELECT value FROM guild_state WHERE key = 'graph-template:' || n.requirement_id) = 'standard'
   AND NOT EXISTS (SELECT 1 FROM graph_deviation d
                    WHERE d.requirement_id = n.requirement_id AND d.node_key = n.node_key
                      AND d.kind IN ('drop-node','reshape'))
UNION ALL
SELECT 'deviation-with-empty-reason', CAST(d.id AS TEXT), d.kind || ' ' || d.node_key
  FROM graph_deviation d WHERE trim(d.reason) = ''
UNION ALL
SELECT 'node-key-not-in-template', n.id, n.node_key
  FROM graph_node n
 WHERE (SELECT value FROM guild_state WHERE key = 'graph-template:' || n.requirement_id) = 'standard'
   AND n.node_key NOT IN ('gate-plan','implement','test-plan','test-write','review','gate-repairs','repair','document')
   AND NOT EXISTS (SELECT 1 FROM graph_deviation d WHERE d.requirement_id = n.requirement_id AND d.kind = 'add-node' AND d.node_key = n.node_key)
UNION ALL
SELECT 'work-node-done-without-task', n.id, n.node_key
  FROM graph_node n
 WHERE n.kind = 'work' AND n.status = 'done' AND n.task_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM task t WHERE t.requirement_id = n.requirement_id AND t.node_key = n.node_key)
UNION ALL
SELECT 'node-done-while-its-task-open', n.id, t.id || '=' || t.status
  FROM graph_node n JOIN task t ON t.id = n.task_id
 WHERE n.status = 'done' AND t.status IN ('todo','in-progress','blocked')`,
	},
	{
		id: "G9",
		description: "concurrency",
		sql: `
SELECT 'agent-double-booked' AS breach, t.claimed_by AS row_id, CAST(COUNT(*) AS TEXT) || ' in-flight' AS detail
  FROM task t
 WHERE t.status = 'in-progress' AND COALESCE(t.claimed_by,'') <> ''
 GROUP BY t.claimed_by HAVING COUNT(*) > 1
UNION ALL
SELECT 'parallel-group-crosses-requirements', t.parallel_group, string_agg(DISTINCT t.requirement_id, ',')
  FROM task t WHERE COALESCE(t.parallel_group,'') <> ''
 GROUP BY t.parallel_group HAVING COUNT(DISTINCT t.requirement_id) > 1`,
	},
	{
		id: "G10",
		description: "library integrity",
		sql: `
SELECT 'knowledge_edge.' || broken_side AS ref,
       CAST(edge_id AS TEXT)            AS row_id,
       rel || ' ' || missing_type || ':' || missing_id AS missing
  FROM v_knowledge_dangling
UNION ALL
SELECT 'doc.superseded-but-current', d.slug, d.status
  FROM doc d
 WHERE d.status = 'current'
   AND EXISTS (SELECT 1 FROM knowledge_edge ke
                WHERE ke.rel = 'supersedes' AND ke.to_type = 'doc' AND ke.to_id = d.slug)`,
	},
	{
		id: "G11",
		description: "nothing is deleted",
		sql: `
SELECT 'row-deleted' AS breach, e.subject_type || ':' || e.subject_id AS row_id,
       kumiai_iso(e.ts) || ' by ' || e.actor AS detail
  FROM event e WHERE e.verb = 'deleted'
UNION ALL
SELECT 'edge-unlinked',
       e.subject_type || ':' || e.subject_id || ' -> '
         || (e.payload->>'to_type') || ':' || (e.payload->>'to_id'),
       kumiai_iso(e.ts) || ' by ' || e.actor
  FROM event e
 WHERE e.verb = 'unlinked'
   AND (e.payload->>'to_type') <> 'doc'`,
	},
];

// ── §4 The build flow (per requirement: $2) ─────────────────────────────────

/** The ids a `select-findings` decision names, read the SQLite way (json_each + CAST AS INTEGER). */
export function decisionFindingIds(decision: string | null): number[] | null {
	if (decision === null || decision.trim() === "") return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(decision);
	} catch {
		return null; // json_valid() = 0: the clause is inert
	}
	const values = Array.isArray(parsed)
		? parsed
		: parsed !== null && typeof parsed === "object"
			? Object.values(parsed)
			: [parsed];
	const ids: number[] = [];
	for (const v of values) {
		if (typeof v === "number") ids.push(Math.trunc(v));
		else if (typeof v === "boolean") ids.push(v ? 1 : 0);
		else if (typeof v === "string") {
			const m = /^\s*([+-]?\d+)/.exec(v);
			ids.push(m ? Number(m[1]) : 0);
		}
	}
	return ids;
}

async function query(ctx: Ctx, text: string, params: unknown[]): Promise<string[][]> {
	const res = await ctx.client.query<unknown[]>({ text, values: params, rowMode: "array" });
	return res.rows.map((r) => r.map((v) => (v === null ? "" : String(v))));
}

const BUILD_FLOW: Invariant[] = [
	{
		id: "4.a",
		description: "after planning, before the gate: the requirement is untouched work",
		perRequirement: true,
		sql: `
SELECT 'task-already-moved' AS breach, t.id AS row_id, t.status AS detail FROM task t WHERE t.requirement_id=$2 AND t.status <> 'todo'
UNION ALL SELECT 'node-already-moved', n.id, n.status FROM graph_node n WHERE n.requirement_id=$2 AND n.status <> 'pending'
UNION ALL SELECT 'gate-plan-already-decided', g.node_id, g.status FROM gate g JOIN graph_node n ON n.id=g.node_id WHERE n.requirement_id=$2 AND n.node_key='gate-plan' AND g.status <> 'pending'
UNION ALL SELECT 'ticket-already-claimed', t.id, t.claimed_by FROM task t WHERE t.requirement_id=$2 AND COALESCE(t.claimed_by,'') <> ''
UNION ALL SELECT 'no-tickets', $2::text, '0' WHERE NOT EXISTS (SELECT 1 FROM task WHERE requirement_id=$2)
UNION ALL SELECT 'ticket-without-capability-or-pin', t.id, '' FROM task t
 WHERE t.requirement_id=$2 AND COALESCE(t.agent,'')='' AND NOT EXISTS (SELECT 1 FROM task_capability c WHERE c.task_id=t.id)
UNION ALL SELECT 'graph-cannot-start', $2::text, 'v_ready_nodes empty'
 WHERE NOT EXISTS (SELECT 1 FROM v_ready_nodes WHERE requirement_id=$2)`,
	},
	{
		// The guild states it as "expect exactly one row, the gate"; here as zero-rows.
		id: "4.b",
		description: "the graph's only entry point is the plan gate",
		perRequirement: true,
		sql: `
SELECT 'ready-node-not-gate-plan' AS breach, id AS row_id, node_key || ' | ' || kind || ' | ' || COALESCE(gate_status,'') AS detail
  FROM v_ready_nodes WHERE requirement_id = $2 AND NOT (node_key = 'gate-plan' AND kind = 'gate')
UNION ALL
SELECT 'gate-plan-not-the-ready-gate', $2::text, 'v_ready_nodes has no pending gate-plan row'
 WHERE NOT EXISTS (SELECT 1 FROM v_ready_nodes WHERE requirement_id = $2 AND node_key = 'gate-plan'
                     AND kind = 'gate' AND gate_status = 'pending')`,
	},
	{
		// N + 10 nodes, 2N + 11 edges, exactly 2 gates. A node/edge count is excused by a recorded
		// add/drop/reshape deviation (a deviated graph has its own arithmetic); the gate count never is.
		id: "4.c",
		description: "node, edge and gate counts",
		perRequirement: true,
		with: `c AS (SELECT (SELECT COUNT(*) FROM graph_node WHERE requirement_id = $2) AS nodes,
       (SELECT COUNT(*) FROM graph_edge WHERE requirement_id = $2) AS edges,
       (SELECT COUNT(*) FROM graph_node WHERE requirement_id = $2 AND kind = 'gate') AS gates,
       (SELECT COUNT(*) FROM task WHERE requirement_id = $2 AND node_key = 'implement') AS n,
       EXISTS (SELECT 1 FROM graph_deviation WHERE requirement_id = $2 AND kind IN ('add-node','drop-node','reshape')) AS deviated)`,
		sql: `
SELECT 'node-count-not-n-plus-10' AS breach, $2::text AS row_id, nodes || ' nodes, expected ' || (n + 10) AS detail FROM c WHERE nodes <> n + 10 AND NOT deviated
UNION ALL SELECT 'edge-count-not-2n-plus-11', $2::text, edges || ' edges, expected ' || (2 * n + 11) FROM c WHERE edges <> 2 * n + 11 AND NOT deviated
UNION ALL SELECT 'gate-count-not-two', $2::text, gates || ' gates' FROM c WHERE gates <> 2`,
	},
	{
		id: "4.d",
		description: "the plan, its tickets, and the review fan-out",
		perRequirement: true,
		sql: `
SELECT 'no-plan' AS breach, r.id AS row_id, '' AS detail FROM requirement r
 WHERE r.id=$2 AND NOT EXISTS (SELECT 1 FROM plan p WHERE p.requirement_id=r.id)
UNION ALL
SELECT 'plan-without-tasks', p.id, '' FROM plan p
 WHERE p.requirement_id=$2 AND NOT EXISTS (SELECT 1 FROM task t WHERE t.plan_id=p.id)
UNION ALL
SELECT 'implement-task-names-no-files', t.id, t.files::text FROM task t
 WHERE t.requirement_id=$2 AND t.node_key='implement' AND jsonb_array_length(t.files) = 0
UNION ALL
SELECT 'task-file-not-a-string', t.id, j.value::text FROM task t
 CROSS JOIN LATERAL jsonb_array_elements(t.files) AS j(value)
 WHERE t.requirement_id=$2 AND jsonb_typeof(j.value) <> 'string'
UNION ALL
SELECT 'tasks-share-a-file-in-one-parallel-group', t1.id || ' & ' || t2.id, j1.value
  FROM task t1
  JOIN task t2 ON t2.requirement_id = t1.requirement_id AND t2.id COLLATE "C" > t1.id
 CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(t1.files) = 'array' THEN t1.files ELSE '[]' END) AS j1(value)
  JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(t2.files) = 'array' THEN t2.files ELSE '[]' END) AS j2(value) ON j2.value = j1.value
 WHERE t1.requirement_id=$2
   AND COALESCE(t1.parallel_group,'') <> '' AND t1.parallel_group = t2.parallel_group
UNION ALL
SELECT 'implement-task-without-node', t.id, '' FROM task t
 WHERE t.requirement_id=$2 AND t.node_key='implement'
   AND NOT EXISTS (SELECT 1 FROM graph_node n WHERE n.requirement_id=t.requirement_id
                    AND n.node_key='implement' AND n.task_id = t.id)
UNION ALL
SELECT 'reviewer-count-not-four', $2::text, CAST((SELECT COUNT(*) FROM graph_node WHERE requirement_id=$2 AND node_key='review') AS TEXT)
 WHERE (SELECT COUNT(*) FROM graph_node WHERE requirement_id=$2 AND node_key='review') <> 4
UNION ALL
SELECT 'reviewers-not-one-parallel-group', MIN(n.requirement_id), COALESCE(string_agg(DISTINCT COALESCE(n.parallel_group,'(null)'), ','),'')
  FROM graph_node n WHERE n.requirement_id=$2 AND n.node_key='review'
 GROUP BY n.requirement_id
HAVING COUNT(DISTINCT COALESCE(n.parallel_group,'(null)')) <> 1 OR MIN(COALESCE(n.parallel_group,'')) <> 'review'`,
	},
	{
		id: "4.e",
		description: "review produced findings",
		perRequirement: true,
		sql: `
SELECT 'review-ran-but-produced-no-finding' AS breach, n.id AS row_id FROM graph_node n
 WHERE n.requirement_id=$2 AND n.node_key='review' AND n.status='done'
   AND NOT EXISTS (SELECT 1 FROM review_finding f JOIN task t ON t.id=f.task_id WHERE t.requirement_id=$2)`,
	},
	{
		// gate.decision is parsed in JS (json_valid + json_each): Postgres has no non-throwing
		// JSON cast. A decision that is not JSON leaves the clause inert, exactly as locally.
		id: "4.f",
		description: "approved findings became tasks, unapproved ones were dispositioned",
		perRequirement: true,
		run: async (ctx) => {
			const gates = await query(
				ctx,
				`SELECT g.decision FROM kumiai_g_gate g JOIN kumiai_g_graph_node n
				   ON n.workspace_id = g.workspace_id AND n.id = g.node_id
				 WHERE g.workspace_id = $1 AND n.requirement_id = $2 AND n.node_key = 'gate-repairs'
				   AND g.status = 'approved' AND g.decision IS NOT NULL`,
				[ctx.workspaceId, ctx.requirement],
			);
			const rows: string[][] = [];
			for (const [decision] of gates) {
				const ids = decisionFindingIds(decision ?? null);
				if (ids === null) continue;
				const inv: Invariant = {
					id: "4.f",
					description: "",
					sql: `
SELECT 'approved-finding-without-fix-task' AS breach, CAST(f.id AS TEXT) AS row_id, f.disposition AS detail
  FROM review_finding f JOIN task t ON t.id=f.task_id
 WHERE t.requirement_id=$2 AND f.id = ANY($3::bigint[]) AND f.fix_task_id IS NULL
UNION ALL
SELECT 'unselected-finding-not-dispositioned', CAST(f.id AS TEXT), f.disposition
  FROM review_finding f JOIN task t ON t.id=f.task_id
 WHERE t.requirement_id=$2 AND NOT (f.id = ANY($3::bigint[])) AND f.disposition = 'open'`,
				};
				rows.push(...(await query(ctx, compile(inv), [ctx.workspaceId, ctx.requirement, ids])));
			}
			return rows;
		},
	},
];

// ── §5 The brief ─────────────────────────────────────────────────────────────

const BRIEF_VIEWS = [
	"v_brief",
	"v_goal_progress",
	"v_requirement_progress",
	"v_in_flight",
	"v_open_bounties",
	"v_blocked_tasks",
	"v_open_bugs",
	"v_failed_tasks",
	"v_open_findings",
	"v_coverage_due",
	"v_gates_pending",
	"v_plans_pending_approval",
	"v_projects_runnable",
	"v_project_progress",
	"v_recent_activity",
];

const BRIEF: Invariant[] = [
	{
		id: "P5.a",
		description: "every view the brief reads exists",
		sql: `
SELECT 'missing-view' AS breach, v.n AS row_id FROM (VALUES ${BRIEF_VIEWS.map((v) => `('${v}')`).join(", ")}) AS v(n)
 WHERE to_regclass('kumiai_' || v.n) IS NULL AND $1::text IS NOT NULL`,
	},
];

// ── §7 The check-in loop ─────────────────────────────────────────────────────

const CHECK_IN: Invariant[] = [
	{
		id: "7.C",
		description: "check-in postconditions (C.a–C.g)",
		sql: `
SELECT 'claimed-against-its-own-pin' AS breach, t.id AS row_id,
       t.claimed_by || ' <> ' || t.agent AS detail
  FROM task t
 WHERE COALESCE(t.claimed_by,'') <> '' AND COALESCE(t.agent,'') <> ''
   AND t.agent <> 'reviewer' AND t.claimed_by <> t.agent
UNION ALL
SELECT 'status-moved-by-non-orchestrator', e.subject_type || ':' || e.subject_id, e.actor
  FROM event e
 WHERE e.verb IN ('moved','node-moved','decided','claimed')
   AND e.actor NOT IN ('orchestrator','user')
UNION ALL
SELECT 'gate-approved-while-predecessor-open', g.node_id, p.id || '=' || p.status
  FROM gate g
  JOIN graph_edge e ON e.to_node = g.node_id
  JOIN graph_node p ON p.id = e.from_node
 WHERE g.status = 'approved' AND p.status NOT IN ('done','skipped')
UNION ALL
SELECT 'task-done-node-still-running', t.id, n.id || '=' || n.status
  FROM task t JOIN graph_node n ON n.task_id = t.id
 WHERE t.status = 'done' AND n.status IN ('pending','running')
UNION ALL
SELECT 'node-done-task-still-open', n.id, t.id || '=' || t.status
  FROM graph_node n JOIN task t ON t.id = n.task_id
 WHERE n.status = 'done' AND t.status IN ('todo','in-progress','blocked')
UNION ALL
SELECT 'running-node-no-claimed-ticket', n.id, COALESCE(n.task_id,'(unbound)')
  FROM graph_node n
 WHERE n.status = 'running'
   AND NOT EXISTS (SELECT 1 FROM task t WHERE t.id = n.task_id AND t.status = 'in-progress')
UNION ALL
SELECT 'event-after-last-checkin-stamp', CAST(COUNT(*) AS TEXT), kumiai_iso(MAX(e.ts))
  FROM event e
 WHERE date_trunc('second', e.ts) > kumiai_try_ts((SELECT value FROM guild_state WHERE key='last-checkin'))
HAVING COUNT(*) > 0
UNION ALL
SELECT 'claimed-before-gate-plan', t.id, g.status
  FROM task t
  JOIN graph_node n ON n.requirement_id = t.requirement_id AND n.node_key = 'gate-plan'
  JOIN gate g ON g.node_id = n.id
 WHERE g.status <> 'approved' AND COALESCE(t.claimed_by,'') <> ''`,
	},
];

// ── §9 Cutting a release ─────────────────────────────────────────────────────

interface ReleaseRecord {
	key: string;
	value: string;
	parsed: unknown;
	valid: boolean;
}

async function releaseRecords(ctx: Ctx): Promise<ReleaseRecord[]> {
	const rows = await query(
		ctx,
		`SELECT key, value FROM kumiai_g_guild_state WHERE workspace_id = $1 AND key LIKE 'release:%' ORDER BY key COLLATE "C"`,
		[ctx.workspaceId],
	);
	return rows.map(([k = "", value = ""]) => {
		try {
			return { key: k, value, parsed: JSON.parse(value) as unknown, valid: true };
		} catch {
			return { key: k, value, parsed: null, valid: false };
		}
	});
}

/** `json_each(value, '$.requirements')` as text values (only for an array). */
function releasedRequirements(rec: ReleaseRecord): string[] | null {
	if (!rec.valid || rec.parsed === null || typeof rec.parsed !== "object") return null;
	const reqs = (rec.parsed as Record<string, unknown>)["requirements"];
	return Array.isArray(reqs) ? reqs.map((r) => (typeof r === "string" ? r : JSON.stringify(r))) : null;
}

const RELEASE: Invariant[] = [
	{
		id: "9.b",
		description: "the release record is well-formed and honest",
		run: async (ctx) => {
			const records = await releaseRecords(ctx);
			const statusRows = await query(ctx, `SELECT id, status FROM kumiai_g_requirement WHERE workspace_id = $1`, [
				ctx.workspaceId,
			]);
			const status = new Map(statusRows.map(([id = "", s = ""]) => [id, s]));
			const rows: string[][] = [];
			const times = new Map<string, number>();
			for (const rec of records) {
				if (!rec.valid) {
					rows.push(["release-value-not-json", rec.key, rec.value]);
					continue;
				}
				const obj = rec.parsed !== null && typeof rec.parsed === "object" ? (rec.parsed as Record<string, unknown>) : null;
				const released = obj && !Array.isArray(obj) ? obj["released"] : undefined;
				const reqs = releasedRequirements(rec);
				if (released === undefined || released === null || reqs === null) {
					rows.push(["release-missing-field", rec.key, released === undefined || released === null ? "released" : "requirements"]);
				}
				if (reqs !== null && reqs.length === 0) rows.push(["release-empty", rec.key, "0"]);
				for (const r of reqs ?? []) {
					const s = status.get(r) ?? "(missing)";
					if (s !== "done") rows.push(["released-requirement-not-done", r, s]);
					times.set(r, (times.get(r) ?? 0) + 1);
				}
			}
			for (const [r, n] of times) if (n > 1) rows.push(["requirement-released-twice", r, String(n)]);
			return rows;
		},
	},
	{
		id: "9.c",
		description: "released over an open task (advisory: the pre-release gate warns, it does not block)",
		advisory: true,
		run: async (ctx) => {
			const released = new Set((await releaseRecords(ctx)).flatMap((rec) => releasedRequirements(rec) ?? []));
			const rows = await query(
				ctx,
				`SELECT 'released-over-open-task', p.id,
				        'open=' || p.tasks_open || ' blocked=' || p.tasks_blocked || ' failed=' || p.tasks_failed
				   FROM kumiai_v_requirement_progress p
				  WHERE p.workspace_id = $1 AND (p.tasks_open > 0 OR p.tasks_failed > 0)`,
				[ctx.workspaceId],
			);
			return rows.filter((r) => released.has(r[1] ?? ""));
		},
	},
];

// ── §10 The maintenance cycle ────────────────────────────────────────────────

const TEMPLATE_OF = (reqCol: string) => `(SELECT value FROM guild_state WHERE key = 'graph-template:' || ${reqCol})`;

const QA: Invariant[] = [
	{
		id: "10.a",
		description: "the trigger was a person",
		sql: `
SELECT 'inspection-not-manual' AS breach, i.id AS row_id, i."trigger" AS detail
  FROM inspection i WHERE i."trigger" <> 'manual'
UNION ALL
SELECT 'inspection-without-maintenance-carrier', i.id, 'no graph-template:… = maintenance' FROM inspection i
 WHERE NOT EXISTS (SELECT 1 FROM guild_state s WHERE s.key LIKE 'graph-template:%' AND s.value = 'maintenance')
UNION ALL
SELECT 'inspection-before-qa-check', i.id, i.status FROM inspection i
 WHERE NOT EXISTS (SELECT 1 FROM graph_node n
                    WHERE n.node_key = 'qa-check' AND n.status IN ('done','skipped')
                      AND ${TEMPLATE_OF("n.requirement_id")} = 'maintenance')
UNION ALL
SELECT 'maintenance-carrier-has-a-plan', p.requirement_id, p.id FROM plan p
 WHERE ${TEMPLATE_OF("p.requirement_id")} = 'maintenance'`,
	},
	{
		id: "10.b",
		description: "the cheap exit is a complete exit",
		sql: `
SELECT 'early-end-left-work-open' AS breach, n.id AS row_id, n.status AS detail
  FROM graph_node n
 WHERE n.requirement_id IN (SELECT requirement_id FROM graph_node WHERE node_key = 'qa-plan' AND status = 'skipped')
   AND n.status NOT IN ('done','skipped')
UNION ALL
SELECT 'early-end-with-mission-ticket', t.id, t.status FROM task t
 WHERE t.node_key = 'qa-execute'
   AND t.requirement_id IN (SELECT requirement_id FROM graph_node WHERE node_key = 'qa-plan' AND status = 'skipped')
UNION ALL
SELECT 'early-end-gate-left-pending', g.node_id, g.status FROM gate g JOIN graph_node n ON n.id = g.node_id
 WHERE n.node_key = 'gate-repairs' AND g.status = 'pending'
   AND n.requirement_id IN (SELECT requirement_id FROM graph_node WHERE node_key = 'qa-plan' AND status = 'skipped')
UNION ALL
SELECT 'inspection-running-nothing-due', i.id, 'v_coverage_due is empty'
  FROM inspection i WHERE i.status = 'in-progress' AND NOT EXISTS (SELECT 1 FROM v_coverage_due)`,
	},
	{
		id: "10.c",
		description: "one tester, board-wide",
		sql: `
SELECT 'two-qa-execute-running' AS breach, n.id AS row_id, n.requirement_id AS detail
  FROM graph_node n
 WHERE n.node_key = 'qa-execute' AND n.status = 'running'
   AND (SELECT COUNT(*) FROM graph_node m WHERE m.node_key = 'qa-execute' AND m.status = 'running') > 1
UNION ALL
SELECT 'two-mission-tickets-in-flight', t.id, t.requirement_id FROM task t
 WHERE t.node_key = 'qa-execute' AND t.status = 'in-progress'
   AND (SELECT COUNT(*) FROM task u WHERE u.node_key = 'qa-execute' AND u.status = 'in-progress') > 1
UNION ALL
SELECT 'qa-execute-has-parallel-group', n.id, n.parallel_group FROM graph_node n
 WHERE n.node_key = 'qa-execute' AND n.parallel_group IS NOT NULL
UNION ALL
SELECT 'mission-ticket-has-parallel-group', t.id, t.parallel_group FROM task t
 WHERE t.node_key = 'qa-execute' AND COALESCE(t.parallel_group,'') <> ''
UNION ALL
SELECT 'qa-execute-running-node-unbound', n.id, 'task_id IS NULL' FROM graph_node n
 WHERE n.node_key = 'qa-execute' AND n.status = 'running' AND n.task_id IS NULL
UNION ALL
SELECT 'mission-ticket-unclaimed-while-running', t.id, '(null)' FROM task t
 WHERE t.node_key = 'qa-execute' AND t.status = 'in-progress' AND COALESCE(t.claimed_by,'') = ''`,
	},
	{
		id: "10.d",
		description: "the report was compiled and the stamp was made",
		sql: `
SELECT 'qa-report-done-inspection-still-open' AS breach, i.id AS row_id, i.status AS detail
  FROM inspection i
 WHERE i.status <> 'done'
   AND EXISTS (SELECT 1 FROM graph_node n WHERE n.node_key = 'qa-report' AND n.status = 'done'
                 AND ${TEMPLATE_OF("n.requirement_id")} = 'maintenance')
UNION ALL
SELECT 'reached-area-not-stamped', ic.inspection_id || '/' || ic.coverage_id, COALESCE(kumiai_iso(c.last_inspected_at),'(never)')
  FROM inspection_coverage ic JOIN inspection i ON i.id = ic.inspection_id
  JOIN coverage c ON c.id = ic.coverage_id
 WHERE i.status = 'done' AND ic.verdict IN ('pass','issues')
   AND i.started_at IS NOT NULL AND (c.last_inspected_at IS NULL OR c.last_inspected_at < i.started_at)
UNION ALL
SELECT 'inspection-done-with-unreported-area', ic.inspection_id || '/' || ic.coverage_id, 'verdict IS NULL'
  FROM inspection_coverage ic JOIN inspection i ON i.id = ic.inspection_id
 WHERE i.status = 'done' AND ic.verdict IS NULL
UNION ALL
SELECT 'issues-found-but-no-bug-filed', n.requirement_id, 'qa-report done, 0 bugs'
  FROM graph_node n
 WHERE n.node_key = 'qa-report' AND n.status = 'done'
   AND ${TEMPLATE_OF("n.requirement_id")} = 'maintenance'
   AND EXISTS (SELECT 1 FROM inspection_coverage ic WHERE ic.verdict = 'issues')
   AND NOT EXISTS (SELECT 1 FROM bug b WHERE b.requirement_id = n.requirement_id)
UNION ALL
SELECT 'inspection-done-no-finished-at', i.id, '(null)' FROM inspection i
 WHERE i.status = 'done' AND i.finished_at IS NULL`,
	},
	{
		id: "10.e",
		description: "the shared tail (gate-repairs → repair), every template",
		// Kumiai: §10.e says `repair` is terminal, but the guild's own standard template (and
		// G8's required `document`) puts `repair -> document`; that one successor is allowed.
		sql: `
SELECT 'tail-missing-gate-repairs' AS breach, substr(s.key,16) AS row_id, s.value AS detail
  FROM guild_state s WHERE s.key LIKE 'graph-template:%'
   AND NOT EXISTS (SELECT 1 FROM graph_node n WHERE n.requirement_id = substr(s.key,16)
                    AND n.node_key = 'gate-repairs' AND n.kind = 'gate')
UNION ALL
SELECT 'tail-gate-not-select-findings', g.node_id, g.kind FROM gate g JOIN graph_node n ON n.id = g.node_id
 WHERE n.node_key = 'gate-repairs' AND g.kind <> 'select-findings'
UNION ALL
SELECT 'tail-gate-not-followed-by-repair', n.id, 'no edge to repair' FROM graph_node n
 WHERE n.node_key = 'gate-repairs'
   AND NOT EXISTS (SELECT 1 FROM graph_edge e JOIN graph_node r ON r.id = e.to_node
                    WHERE e.from_node = n.id AND r.node_key = 'repair')
UNION ALL
SELECT 'tail-repair-predecessor-not-the-gate', r.id, p.node_key
  FROM graph_node r JOIN graph_edge e ON e.to_node = r.id JOIN graph_node p ON p.id = e.from_node
 WHERE r.node_key = 'repair' AND p.node_key <> 'gate-repairs'
UNION ALL
SELECT 'tail-repair-not-terminal', r.id, e.to_node
  FROM graph_node r JOIN graph_edge e ON e.from_node = r.id JOIN graph_node d ON d.id = e.to_node
 WHERE r.node_key = 'repair' AND d.node_key <> 'document'
UNION ALL
SELECT 'tail-repair-fanned-out', n.requirement_id, CAST(COUNT(*) AS TEXT) || ' repair nodes'
  FROM graph_node n WHERE n.node_key = 'repair' GROUP BY n.requirement_id HAVING COUNT(*) <> 1`,
	},
	{
		id: "10.f",
		description: "the maintenance graph matches its template",
		sql: `
SELECT 'added-gate' AS breach, n.id AS row_id, n.node_key AS detail FROM graph_node n
 WHERE n.kind = 'gate' AND n.node_key <> 'gate-repairs'
   AND ${TEMPLATE_OF("n.requirement_id")} = 'maintenance'
UNION ALL
SELECT 'dropped-required-node', r.id, k.k
  FROM requirement r CROSS JOIN (SELECT 'qa-check' AS k UNION ALL SELECT 'qa-report'
                           UNION ALL SELECT 'gate-repairs') k
 WHERE ${TEMPLATE_OF("r.id")} = 'maintenance'
   AND NOT EXISTS (SELECT 1 FROM graph_node n WHERE n.requirement_id = r.id AND n.node_key = k.k)
UNION ALL
SELECT 'dropped-optional-node-no-deviation', r.id, k.k
  FROM requirement r CROSS JOIN (SELECT 'qa-plan' AS k UNION ALL SELECT 'qa-execute'
                           UNION ALL SELECT 'repair') k
 WHERE ${TEMPLATE_OF("r.id")} = 'maintenance'
   AND NOT EXISTS (SELECT 1 FROM graph_node n WHERE n.requirement_id = r.id AND n.node_key = k.k)
   AND NOT EXISTS (SELECT 1 FROM graph_deviation d WHERE d.requirement_id = r.id
                     AND d.kind = 'drop-node' AND d.node_key = k.k)
UNION ALL
SELECT 'node-key-not-in-template', n.id, n.node_key FROM graph_node n
 WHERE ${TEMPLATE_OF("n.requirement_id")} = 'maintenance'
   AND n.node_key NOT IN ('qa-check','qa-plan','qa-execute','qa-report','gate-repairs','repair')
   AND NOT EXISTS (SELECT 1 FROM graph_deviation d WHERE d.requirement_id = n.requirement_id
                     AND d.kind = 'add-node' AND d.node_key = n.node_key)
UNION ALL
SELECT 'node-count-not-six', r.id, CAST((SELECT COUNT(*) FROM graph_node n WHERE n.requirement_id = r.id) AS TEXT)
  FROM requirement r
 WHERE ${TEMPLATE_OF("r.id")} = 'maintenance'
   AND (SELECT COUNT(*) FROM graph_node n WHERE n.requirement_id = r.id) <> 6
   AND NOT EXISTS (SELECT 1 FROM graph_deviation d WHERE d.requirement_id = r.id)
UNION ALL
SELECT 'edge-count-not-five', r.id, CAST((SELECT COUNT(*) FROM graph_edge e
        JOIN graph_node n ON n.id = e.to_node WHERE n.requirement_id = r.id) AS TEXT)
  FROM requirement r
 WHERE ${TEMPLATE_OF("r.id")} = 'maintenance'
   AND (SELECT COUNT(*) FROM graph_edge e JOIN graph_node n ON n.id = e.to_node
         WHERE n.requirement_id = r.id) <> 5
   AND NOT EXISTS (SELECT 1 FROM graph_deviation d WHERE d.requirement_id = r.id)
UNION ALL
SELECT 'gate-count-not-one', r.id, CAST((SELECT COUNT(*) FROM graph_node n
        WHERE n.requirement_id = r.id AND n.kind = 'gate') AS TEXT)
  FROM requirement r
 WHERE ${TEMPLATE_OF("r.id")} = 'maintenance'
   AND (SELECT COUNT(*) FROM graph_node n WHERE n.requirement_id = r.id AND n.kind = 'gate') <> 1`,
	},
];

// ── §11 The unattended shift ─────────────────────────────────────────────────

/**
 * The shift window: [start of the newest `started` second, end of its `ended` second (or now)].
 * The guild truncates both ends to the second as text; this is the same window as instants.
 * The `ended` row is the one for the newest shift (same subject_id), so an open shift's window
 * runs to now even when an earlier shift has ended.
 */
const SHIFT_WINDOW = `s0 AS (SELECT subject_id, ts FROM event WHERE subject_type='shift' AND verb='started' ORDER BY ts DESC, id DESC LIMIT 1),
w(t0, t1) AS (
  SELECT date_trunc('second', (SELECT ts FROM s0)),
         date_trunc('second', COALESCE((SELECT e.ts FROM event e, s0 WHERE e.subject_type='shift' AND e.verb='ended'
                                         AND e.subject_id = s0.subject_id ORDER BY e.ts DESC, e.id DESC LIMIT 1),
                                       kumiai_utc_now())) + interval '1 second' - interval '1 microsecond')`;

const SHIFT: Invariant[] = [
	{
		id: "11.a",
		description: "it stopped at a gate and never past one",
		with: SHIFT_WINDOW,
		sql: `
SELECT 'gate-decided-during-shift' AS breach, e.subject_id AS row_id, kumiai_iso(e.ts) || ' ' || e.actor AS detail
  FROM event e, w WHERE e.subject_type='gate' AND e.verb='decided' AND e.ts >= w.t0 AND e.ts <= w.t1
UNION ALL
SELECT 'gate-approved-with-no-shift-boundary', g.node_id, g.status || ' at ' || COALESCE(kumiai_iso(g.decided_at),'(null)')
  FROM gate g, w WHERE g.status <> 'pending'
   AND g.decided_at >= w.t0 AND g.decided_at <= w.t1
UNION ALL
SELECT 'work-past-unresolved-gate', n.id, g.node_id
  FROM graph_node n
  JOIN graph_edge e ON e.to_node = n.id
  JOIN graph_node p ON p.id = e.from_node AND p.kind = 'gate'
  JOIN gate g ON g.node_id = p.id
 WHERE n.status IN ('running','done','failed') AND g.status = 'pending'
UNION ALL
SELECT 'node-moved-past-pending-gate-during-shift', e.subject_id, kumiai_iso(e.ts)
  FROM event e CROSS JOIN w
  JOIN graph_node n ON n.id = e.subject_id
 WHERE e.subject_type='graph_node' AND e.verb='node-moved' AND e.ts >= w.t0 AND e.ts <= w.t1
   AND EXISTS (SELECT 1 FROM graph_edge ge JOIN gate g2 ON g2.node_id = ge.from_node
                WHERE ge.to_node = n.id AND g2.status = 'pending')`,
	},
	{
		id: "11.b",
		description: "what it never touched",
		with: SHIFT_WINDOW,
		sql: `
SELECT 'shift-started-an-inspection' AS breach, e.subject_id AS row_id, kumiai_iso(e.ts) AS detail
  FROM event e, w
 WHERE e.subject_type='graph_node' AND e.verb='node-moved'
   AND (e.payload->>'node_key') = 'qa-check'
   AND (e.payload->>'from') = 'pending'
   AND e.ts >= w.t0 AND e.ts <= w.t1
UNION ALL
SELECT 'shift-opened-an-inspection-row', i.id, kumiai_iso(i.started_at)
  FROM inspection i, w
 WHERE i.started_at >= w.t0 AND i.started_at <= w.t1
UNION ALL
SELECT 'shift-declared-a-coverage-area', e.subject_id, kumiai_iso(e.ts)
  FROM event e, w
 WHERE e.subject_type='coverage' AND e.verb='created' AND e.ts >= w.t0 AND e.ts <= w.t1
UNION ALL
SELECT 'shift-touched-the-direction', e.subject_type || ':' || e.subject_id, e.verb || ' at ' || kumiai_iso(e.ts)
  FROM event e, w
 WHERE e.subject_type IN ('goal','project') AND e.ts >= w.t0 AND e.ts <= w.t1`,
	},
	{
		id: "11.c",
		description: "the failure policy was followed and the shift did not deadlock",
		with: SHIFT_WINDOW,
		sql: `
SELECT 'retried-more-than-once' AS breach, l.task_id AS row_id, CAST(COUNT(*) AS TEXT) || ' retries' AS detail
  FROM work_log l, w
 WHERE l.entry LIKE 'Shift retry%' AND l.ts >= w.t0 AND l.ts <= w.t1
 GROUP BY l.task_id HAVING COUNT(*) > 1
UNION ALL
SELECT 'given-up-without-a-retry', t.id, t.status
  FROM task t, w
 WHERE t.status = 'failed'
   AND t.updated_at >= w.t0 AND t.updated_at <= w.t1
   AND NOT EXISTS (SELECT 1 FROM work_log l WHERE l.task_id = t.id AND l.entry LIKE 'Shift retry%'
                     AND l.ts >= w.t0 AND l.ts <= w.t1)
UNION ALL
SELECT 'failed-ticket-with-no-reason-logged', t.id, ''
  FROM task t WHERE t.status = 'failed'
   AND NOT EXISTS (SELECT 1 FROM work_log l WHERE l.task_id = t.id AND l.entry NOT LIKE 'Shift retry%')
UNION ALL
SELECT 'failed-node-live-ticket', n.id, t.id || '=' || t.status
  FROM graph_node n JOIN task t ON t.id = n.task_id
 WHERE n.status = 'failed' AND t.status NOT IN ('failed','blocked')
UNION ALL
SELECT 'failed-ticket-live-node', t.id, n.id || '=' || n.status
  FROM task t JOIN graph_node n ON n.task_id = t.id
 WHERE t.status = 'failed' AND n.status NOT IN ('failed','skipped')
UNION ALL
SELECT 'retry-left-the-ticket-claimed', t.id, COALESCE(t.claimed_by,'')
  FROM task t WHERE t.status = 'todo' AND COALESCE(t.claimed_by,'') <> ''
UNION ALL
SELECT 'shift-deadlocked-with-work-available', 'shift', e.payload->>'reason'
  FROM event e, w
 WHERE e.subject_type='shift' AND e.verb='ended'
   AND (e.payload->>'reason') = 'idle'
   AND EXISTS (SELECT 1 FROM v_ready_nodes n WHERE n.kind = 'work'
                AND NOT EXISTS (SELECT 1 FROM task tb WHERE tb.id = n.task_id
                                 AND tb.status IN ('blocked','failed')))`,
	},
	{
		id: "11.d",
		description: "a blocked ticket became a roster gap, not a silent skip",
		sql: `
SELECT 'uncoverable-ticket-left-todo' AS breach, t.id AS row_id, w.who AS detail
  FROM task t JOIN v_task_who w ON w.task_id = t.id
 WHERE t.status = 'todo' AND COALESCE(t.agent,'') = ''
   AND EXISTS (SELECT 1 FROM task_capability c WHERE c.task_id = t.id)
   AND NOT EXISTS (SELECT 1 FROM v_task_deps d WHERE d.task_id = t.id)
   AND EXISTS (SELECT 1 FROM event WHERE subject_type = 'shift' AND verb = 'ended')
UNION ALL
SELECT 'blocked-ticket-invisible-as-a-gap', t.id, ''
  FROM task t WHERE t.status = 'blocked'
   AND NOT EXISTS (SELECT 1 FROM v_blocked_tasks b WHERE b.id = t.id)
UNION ALL
SELECT 'blocked-with-a-pin', t.id, t.agent
  FROM task t WHERE t.status = 'blocked' AND COALESCE(t.agent,'') <> ''`,
	},
	{
		id: "11.e",
		description: "the shift said why it stopped, every time",
		sql: `
SELECT 'shift-never-said-why-it-stopped' AS breach, eo.subject_id AS row_id, kumiai_iso(eo.ts) AS detail
  FROM event eo
 WHERE eo.subject_type='shift' AND eo.verb='started'
   AND NOT EXISTS (SELECT 1 FROM event ec WHERE ec.subject_type='shift' AND ec.verb='ended'
                     AND ec.subject_id = eo.subject_id)
   AND eo.id < (SELECT MAX(id) FROM event WHERE subject_type='shift' AND verb='started')
UNION ALL
SELECT 'two-shifts-open-at-once', 'shift', CAST(COUNT(*) AS TEXT) || ' open'
  FROM event eo
 WHERE eo.subject_type='shift' AND eo.verb='started'
   AND NOT EXISTS (SELECT 1 FROM event ec WHERE ec.subject_type='shift' AND ec.verb='ended'
                     AND ec.subject_id = eo.subject_id)
HAVING COUNT(*) > 1
UNION ALL
SELECT 'stop-reason-outside-the-vocabulary', e.subject_id, COALESCE(e.payload->>'reason','(null)')
  FROM event e
 WHERE e.subject_type='shift' AND e.verb='ended'
   AND COALESCE(e.payload->>'reason','') NOT IN
       ('gate','infrastructure','max-tasks','max-minutes','idle','collision','operator')
UNION ALL
SELECT 'shift-opened-without-a-budget', e.subject_id, e.payload::text
  FROM event e
 WHERE e.subject_type='shift' AND e.verb='started'
   AND (e.payload->'max_tasks' IS NULL OR jsonb_typeof(e.payload->'max_tasks') = 'null'
        OR e.payload->'max_minutes' IS NULL OR jsonb_typeof(e.payload->'max_minutes') = 'null')
UNION ALL
SELECT 'budget-changed-mid-shift', eo.subject_id, CAST(COUNT(*) AS TEXT) || ' started rows'
  FROM event eo WHERE eo.subject_type='shift' AND eo.verb='started'
 GROUP BY eo.subject_id HAVING COUNT(*) > 1
UNION ALL
SELECT 'shift-ended-that-never-started', ec.subject_id, kumiai_iso(ec.ts)
  FROM event ec WHERE ec.subject_type='shift' AND ec.verb='ended'
   AND NOT EXISTS (SELECT 1 FROM event eo WHERE eo.subject_type='shift' AND eo.verb='started'
                     AND eo.subject_id = ec.subject_id)
UNION ALL
SELECT 'over-budget', e.subject_id, 'tasks=' || COALESCE(e.payload->>'tasks','?')
  FROM event e JOIN event s ON s.subject_id = e.subject_id AND s.verb='started' AND s.subject_type='shift'
 WHERE e.subject_type='shift' AND e.verb='ended'
   AND ${SAFE_INT("e.payload->>'tasks'")} > ${SAFE_INT("s.payload->>'max_tasks'")}`,
	},
];

// ── Processes ────────────────────────────────────────────────────────────────

export const INVARIANT_PROCESSES = ["new-requirement", "brief", "dashboard", "check-in", "release", "qa", "shift"] as const;
export type InvariantProcess = (typeof INVARIANT_PROCESSES)[number];

/** Processes whose section is per requirement (§4's REQ-NNN). */
export const PER_REQUIREMENT_PROCESSES: ReadonlySet<InvariantProcess> = new Set(["new-requirement"]);

const PROCESS_INVARIANTS: Record<InvariantProcess, Invariant[]> = {
	"new-requirement": BUILD_FLOW,
	brief: BRIEF,
	dashboard: [],
	"check-in": CHECK_IN,
	release: RELEASE,
	qa: QA,
	shift: SHIFT,
};

/** What stays local per the guild's kumiai.md / validate skill — reported, never silently dropped. */
const ALWAYS_SKIPPED: Skipped[] = [
	{ id: "G5.roster", reason: "whether a declared capability is one some agent declares — roster.py --covers, not SQL" },
	{ id: "G9.serial", reason: "whether a double-booked member is serial lives in agent frontmatter — roster.py" },
];

const PROCESS_SKIPPED: Record<InvariantProcess, Skipped[]> = {
	"new-requirement": [
		{ id: "P4.a", reason: "schema_version: Kumiai's schema is versioned by its migrations" },
		{ id: "P4.b", reason: "the roster is the agent files — roster.py, not SQL" },
		{ id: "P4.c", reason: "preflight read before instantiation — list graph_node for the requirement" },
	],
	brief: [
		{ id: "5.a", reason: "a before/after comparison — call fingerprint before and after the brief" },
		{ id: "5.b", reason: "the roll call is checked against the brief's text, which is not on the board" },
		{ id: "5.c", reason: "a reference read (read_view v_brief), not an assertion" },
		{ id: "5.d", reason: "a reference read (get_state last-checkin), not an assertion" },
	],
	dashboard: [{ id: "6", reason: "asserts over the built .guild/dashboard.html — run locally as written" }],
	"check-in": [{ id: "P7.a", reason: "the roster is the agent files — roster.py, not SQL" }],
	release: [
		{ id: "9.a", reason: "a before/after comparison — use the fingerprint tool before and after the release writes" },
		{ id: "P9", reason: "preconditions are reads (P9.a/P9.b) plus git — run before the release" },
	],
	qa: [{ id: "P11", reason: "preconditions are run before the cycle starts (and roster.py for staffing)" }],
	shift: [
		{ id: "11.f", reason: "git safety (G-1…G-7) — run locally as written" },
		{ id: "11.G-8", reason: "the git-trailer cross-check needs the repository — run locally" },
	],
};

export interface InvariantReport {
	ok: boolean;
	failures: Failure[];
	checked: string[];
	skipped: Skipped[];
}

/**
 * Run §3 (always) plus `process`'s postconditions against the workspace in ONE read-only,
 * repeatable-read snapshot. The caller has already checked the workspace and resolved
 * `requirement` (a guild key in this workspace) where the process needs it.
 */
export async function runInvariants(
	workspaceId: string,
	process: InvariantProcess | undefined,
	requirement: string | null,
): Promise<InvariantReport> {
	const selected = [...GLOBAL_INVARIANTS, ...(process ? PROCESS_INVARIANTS[process] : [])];
	const client = await pool.connect();
	const failures: Failure[] = [];
	try {
		await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
		const ctx: Ctx = { client, workspaceId, requirement };
		for (const inv of selected) {
			const params = inv.perRequirement ? [workspaceId, requirement] : [workspaceId];
			const rows = inv.run ? await inv.run(ctx) : await query(ctx, compile(inv), params);
			if (rows.length === 0) continue;
			rows.sort(compareRows);
			failures.push({
				id: inv.id,
				description: inv.description,
				rows,
				...(inv.advisory ? { advisory: true as const } : {}),
			});
		}
		await client.query("COMMIT");
	} catch (err) {
		await client.query("ROLLBACK").catch(() => undefined);
		throw err;
	} finally {
		client.release();
	}
	return {
		ok: failures.every((f) => f.advisory),
		failures,
		checked: selected.map((i) => i.id),
		skipped: [...ALWAYS_SKIPPED, ...(process ? PROCESS_SKIPPED[process] : [])],
	};
}

/** Byte-wise row order (SQLite BINARY collation). */
function compareRows(a: string[], b: string[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] ?? "";
		const y = b[i] ?? "";
		if (x !== y) return Buffer.compare(Buffer.from(x), Buffer.from(y));
	}
	return 0;
}

/** Exposed for tests: the compiled SQL of every SQL-backed assertion. */
export function compiledInvariants(): { id: string; sql: string; perRequirement: boolean }[] {
	return [...GLOBAL_INVARIANTS, ...Object.values(PROCESS_INVARIANTS).flat()]
		.filter((i) => i.sql !== undefined && i.run === undefined)
		.map((i) => ({ id: i.id, sql: compile(i), perRequirement: i.perRequirement === true }));
}
