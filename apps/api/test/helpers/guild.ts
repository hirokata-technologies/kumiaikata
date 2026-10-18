import { pool } from "../../src/db/client.js";
import { newId } from "../../src/db/ids.js";
import { seedTeamWithBoard, seedKumiaiWorkspace } from "./seed.js";

/**
 * Raw-SQL builders for guild warehouse tests. They leave `key` and `workspace_id` to the
 * triggers wherever the triggers can derive them, which is part of what the tests exercise.
 */

let boardCounter = 0;

export interface GuildBoard {
	teamId: string;
	workspaceId: string;
	goalId: string;
}

/** A team with a default workspace and one goal — one guild board. */
export async function seedGuildBoard(input?: { workspaceName?: string; teamId?: string }): Promise<GuildBoard> {
	let teamId = input?.teamId;
	let workspaceId: string;
	if (teamId === undefined) {
		boardCounter += 1;
		const { team } = await seedTeamWithBoard({ domain: `guild-${boardCounter}.test.com`, members: [] });
		teamId = team.id;
		workspaceId = (await seedKumiaiWorkspace(teamId)).id;
	} else {
		workspaceId = (await seedKumiaiWorkspace(teamId, { isDefault: false, name: input?.workspaceName ?? "other" })).id;
	}
	const goal = await one<{ id: string }>(
		`INSERT INTO kumiai_goals (id, team_id, workspace_id, title, status, priority, created_at, updated_at)
		 VALUES ($1, $2, $3, 'Goal', 'todo', 3, now(), now()) RETURNING id`,
		[newId(), teamId, workspaceId],
	);
	return { teamId, workspaceId, goalId: goal.id };
}

export async function one<T>(text: string, params: unknown[] = []): Promise<T> {
	const { rows } = await pool.query(text, params);
	if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}: ${text}`);
	return rows[0] as T;
}

export async function all<T>(text: string, params: unknown[] = []): Promise<T[]> {
	const { rows } = await pool.query(text, params);
	return rows as T[];
}

export interface Keyed {
	id: string;
	key: string;
}

export async function addProject(
	board: GuildBoard,
	input?: { ordinal?: number | null; concurrent?: boolean; status?: string; goalId?: string },
): Promise<Keyed> {
	return one<Keyed>(
		`INSERT INTO kumiai_projects (id, team_id, goal_id, title, ordinal, status, priority, impact, effort,
		   concurrent, created_at, updated_at)
		 VALUES ($1, $2, $3, 'Project', $4, $5, 'medium', 50, 5, $6, now(), now()) RETURNING id, key`,
		[newId(), board.teamId, input?.goalId ?? board.goalId, input?.ordinal ?? null, input?.status ?? "todo", input?.concurrent ?? false],
	);
}

export async function addRequirement(
	board: GuildBoard,
	input?: { projectId?: string | null; status?: string; title?: string },
): Promise<Keyed> {
	return one<Keyed>(
		`INSERT INTO kumiai_requirements (id, team_id, workspace_id, project_id, title, status, priority, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, 3, now(), now()) RETURNING id, key`,
		[
			newId(),
			board.teamId,
			input?.projectId ? null : board.workspaceId,
			input?.projectId ?? null,
			input?.title ?? "Requirement",
			input?.status ?? "todo",
		],
	);
}

export async function addTask(
	board: GuildBoard,
	requirementId: string,
	input?: { status?: string; agent?: string | null; parallelGroup?: string | null; title?: string; claimedAt?: string },
): Promise<Keyed> {
	return one<Keyed>(
		`INSERT INTO kumiai_tasks (id, team_id, requirement_id, title, status, priority, agent, parallel_group,
		   claimed_at, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, 3, $6, $7, $8, now(), now()) RETURNING id, key`,
		[
			newId(),
			board.teamId,
			requirementId,
			input?.title ?? "Task",
			input?.status ?? "todo",
			input?.agent ?? null,
			input?.parallelGroup ?? null,
			input?.claimedAt ?? null,
		],
	);
}

export async function addCapability(taskId: string, capability: string, required = true): Promise<void> {
	await pool.query(
		`INSERT INTO kumiai_task_capability (task_id, capability, required) VALUES ($1, $2, $3)`,
		[taskId, capability, required],
	);
}

export async function addDependency(taskId: string, dependsOn: string): Promise<void> {
	await pool.query(`INSERT INTO kumiai_task_dependency (task_id, depends_on) VALUES ($1, $2)`, [taskId, dependsOn]);
}

/** A graph node with id `<REQ key>/<node_key>[.<suffix>]`, as the guild composes it. */
export async function addNode(
	requirement: Keyed,
	nodeKey: string,
	input?: { kind?: "work" | "gate"; status?: string; suffix?: string; taskId?: string },
): Promise<Keyed> {
	const key = `${requirement.key}/${nodeKey}${input?.suffix ? `.${input.suffix}` : ""}`;
	return one<Keyed>(
		`INSERT INTO kumiai_graph_node (id, key, requirement_id, node_key, kind, task_id, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, key`,
		[newId(), key, requirement.id, nodeKey, input?.kind ?? "work", input?.taskId ?? null, input?.status ?? "pending"],
	);
}

export async function addEdge(from: Keyed, to: Keyed): Promise<void> {
	await pool.query(`INSERT INTO kumiai_graph_edge (from_node, to_node) VALUES ($1, $2)`, [from.id, to.id]);
}

export async function addGate(node: Keyed, prompt = "Approve?"): Promise<void> {
	await pool.query(`INSERT INTO kumiai_gate (node_id, prompt) VALUES ($1, $2)`, [node.id, prompt]);
}

export async function logWork(taskId: string, entry: string, input?: { agent?: string; ts?: string }): Promise<void> {
	await pool.query(
		`INSERT INTO kumiai_work_log (task_id, ts, agent, entry)
		 VALUES ($1, COALESCE($2::timestamp, now() AT TIME ZONE 'UTC'), $3, $4)`,
		[taskId, input?.ts ?? null, input?.agent ?? "developer", entry],
	);
}
