import { DatabaseSync } from "node:sqlite";
import { loadSource, type GuildSource } from "../../src/guild/tursodb-import.js";
import { GUILD_SOURCE_DDL } from "./guild-source-ddl.js";

export const T = (day: string, time = "09:00:00"): string => `2026-10-${day}T${time}Z`;

/** A small but complete guild.db: every table the importer reads has a row. */
export function buildSource(options: { version?: number; mutate?: (db: DatabaseSync) => void } = {}): GuildSource {
	// A plan and a task point at each other; the guild's own file does not enforce it either.
	const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
	for (const ddl of GUILD_SOURCE_DDL) db.exec(ddl);
	db.exec(`
		INSERT INTO schema_version VALUES (1, ${options.version ?? 9}, '${T("01")}');
		INSERT INTO guild_state VALUES ('actor', 'orchestrator'), ('last-checkin', '${T("03")}'), ('graph-template:REQ-001', 'standard');
		INSERT INTO goal VALUES ('GOAL-001', 'Ship auth', 'body', 'in-progress', 2, '${T("01")}', '${T("02")}');
		INSERT INTO project VALUES ('PROJ-001', 'GOAL-001', 'Auth', '', 1, 'in-progress', 5, 1, 'worktree', '/tmp/wt', '${T("01")}', '${T("02")}');
		INSERT INTO requirement VALUES
			('REQ-001', 'PROJ-001', 'Login', 'login body', 'in-progress', 3, '${T("01")}', '${T("02")}'),
			('REQ-002', NULL, 'Loose requirement', '', 'todo', 3, '${T("01")}', '${T("02")}');
		INSERT INTO plan VALUES ('PLAN-001', 'REQ-001', 'TASK-001', 'Login plan', 'plan body', 'done', 'approved', 'user', '${T("03", "10:00:00")}', 'REQ-001/gate-plan', '${T("02")}', '${T("03", "10:00:00")}');
		INSERT INTO task VALUES
			('TASK-001', 'REQ-001', NULL, '[]', NULL, 'plan', 'Plan it', 'obj', '', 'done', 3, 'strategist', 'strategist', '${T("02")}', '${T("02")}', '${T("03")}'),
			('TASK-002', 'REQ-001', 'PLAN-001', '["src/a.ts","src/b.ts"]', 'g1', 'implement', 'Build it', '', '', 'in-progress', 2, 'developer', 'developer', '${T("04")}', '${T("03")}', '${T("04")}'),
			('TASK-003', 'REQ-002', NULL, '[]', NULL, NULL, 'Loose task', '', '', 'todo', 3, NULL, NULL, NULL, '${T("03")}', '${T("03")}');
		INSERT INTO task_dependency VALUES ('TASK-002', 'TASK-001');
		INSERT INTO task_capability VALUES ('TASK-002', 'svelte', 1), ('TASK-002', 'tests', 0);
		INSERT INTO graph_node VALUES
			('REQ-001/gate-plan', 'REQ-001', 'gate-plan', 'gate', NULL, NULL, 'done'),
			('REQ-001/implement.TASK-002', 'REQ-001', 'implement', 'work', 'TASK-002', 'g1', 'running');
		INSERT INTO graph_edge VALUES ('REQ-001/gate-plan', 'REQ-001/implement.TASK-002');
		INSERT INTO graph_deviation VALUES (4, 'REQ-001', 'add-node', 'security', 'auth change', '${T("03")}');
		INSERT INTO gate VALUES ('REQ-001/gate-plan', 'Approve the plan?', 'approve', 'approved', 'ok', '${T("03", "10:00:00")}');
		INSERT INTO work_log VALUES
			(1, 'TASK-001', '${T("02")}', 'strategist', 'drafted'),
			(2, 'TASK-001', '%Y-%m-%dT%H:%M:%SZ', 'strategist', 'time never filled in');
		INSERT INTO review_finding VALUES (7, 'TASK-002', 'reviewer-security', 'minor', 'Missing check', 'detail', 'src/a.ts', 12, 'open', NULL, '', '${T("05")}');
		INSERT INTO bug VALUES ('BUG-001', 'Crash', '', 'steps', 'major', 'open', 'qa-tester', 'REQ-001', NULL, '', '${T("05")}', '${T("05")}');
		INSERT INTO coverage VALUES ('checkout-flow', 'Checkout', 'high', 'e2e/checkout.spec.ts', '${T("05")}', 'notes');
		INSERT INTO inspection VALUES ('INSP-001', 'checkout', 'manual', 'done', '${T("05")}', '${T("05", "10:00:00")}');
		INSERT INTO inspection_coverage VALUES ('INSP-001', 'checkout-flow', 'pass');
		INSERT INTO doc VALUES ('auth-overview', 'Auth overview', 'how auth works', 'technical', 'current', 'auth', 'librarian', '${T("04")}', '${T("05")}');
		INSERT INTO doc_revision VALUES (3, 'auth-overview', 'Auth overview', 'older body', 'technical', 'draft', '${T("05")}');
		INSERT INTO knowledge_edge VALUES
			(1, 'describes', 'doc', 'auth-overview', 'requirement', 'REQ-001', '', 'librarian', '${T("05")}'),
			(2, 'evidence-for', 'review_finding', '7', 'doc', 'auth-overview', 'seen in review', 'reviewer-security', '${T("05")}');
		INSERT INTO event VALUES
			(1, '${T("01")}', 'orchestrator', 'created', 'goal', 'GOAL-001', '{"status":"in-progress","priority":2}'),
			(2, '${T("02", "09:30:00")}', 'reviewer-security', 'found', 'task', 'TASK-002', '{"finding_id":7,"severity":"minor"}'),
			(3, '%Y-%m-%dT%H:%M:%SZ', 'strategist', 'logged', 'task', 'TASK-001', '{"entry":"time never filled in"}');
	`);
	options.mutate?.(db);
	try {
		return loadSource(db);
	} finally {
		db.close();
	}
}
