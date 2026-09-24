import { pool } from "../../src/db/client.js";
import { newId } from "../../src/db/ids.js";
import { appendAfter } from "../../src/ordering/fractional.js";

// ── seedUser ──────────────────────────────────────────────────────────────────

export interface SeededUser {
	id: string;
	email: string;
	name: string | null;
	personalBoardId: string | null;
}

export async function seedUser(input?: {
	id?: string;
	email?: string;
	name?: string | null;
}): Promise<SeededUser> {
	const id = input?.id ?? newId();
	const email = input?.email ?? `user-${id}@test.com`;
	const name = input?.name !== undefined ? input.name : `User ${id}`;
	const now = new Date();

	const { rows } = await pool.query<SeededUser>(
		`INSERT INTO users (id, email, name, email_verified, created_at, updated_at, personal_board_id)
		 VALUES ($1, $2, $3, false, $4, $4, NULL)
		 RETURNING id, email, name, personal_board_id AS "personalBoardId"`,
		[id, email, name, now],
	);
	return rows[0]!;
}

// ── seedPersonalBoard ─────────────────────────────────────────────────────────

export interface SeededPersonalBoard {
	id: string;
	kind: "personal";
	title: string;
	ownerId: string;
	teamId: null;
}

export async function seedPersonalBoard(
	ownerId: string,
	input?: { title?: string },
): Promise<SeededPersonalBoard> {
	const id = newId();
	const title = input?.title ?? "Personal Board";
	const now = new Date();

	const { rows } = await pool.query<SeededPersonalBoard>(
		`INSERT INTO boards (id, kind, title, owner_id, team_id, created_at, updated_at)
		 VALUES ($1, 'personal', $2, $3, NULL, $4, $4)
		 RETURNING id, kind, title, owner_id AS "ownerId", team_id AS "teamId"`,
		[id, title, ownerId, now],
	);

	const board = rows[0]!;

	// Update user's personalBoardId
	await pool.query(
		`UPDATE users SET personal_board_id = $1, updated_at = $2 WHERE id = $3`,
		[id, now, ownerId],
	);

	return board as SeededPersonalBoard;
}

// ── seedTeamWithBoard ─────────────────────────────────────────────────────────

export interface SeededTeam {
	id: string;
	domain: string;
	name: string;
}

export interface SeededTeamBoard {
	id: string;
	title: string;
	teamId: string;
}

export interface SeededTeamWithBoard {
	team: SeededTeam;
	board: SeededTeamBoard;
}

export async function seedTeamWithBoard(input: {
	domain: string;
	members: Array<{ userId: string; role: "admin" | "member" }>;
	teamName?: string;
	boardTitle?: string;
}): Promise<SeededTeamWithBoard> {
	const teamId = newId();
	const boardId = newId();
	const name = input.teamName ?? `Team ${input.domain}`;
	const boardTitle = input.boardTitle ?? `${name} Board`;
	const now = new Date();

	// Insert team
	const { rows: teamRows } = await pool.query<SeededTeam>(
		`INSERT INTO teams (id, domain, name, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $4)
		 RETURNING id, domain, name`,
		[teamId, input.domain, name, now],
	);
	const team = teamRows[0]!;

	// Insert team board
	const { rows: boardRows } = await pool.query<SeededTeamBoard>(
		`INSERT INTO boards (id, kind, title, owner_id, team_id, created_at, updated_at)
		 VALUES ($1, 'team', $2, NULL, $3, $4, $4)
		 RETURNING id, title, team_id AS "teamId"`,
		[boardId, boardTitle, teamId, now],
	);
	const board = boardRows[0]!;

	// Insert team members
	for (const member of input.members) {
		await pool.query(
			`INSERT INTO team_members (id, team_id, user_id, role, joined_at)
			 VALUES ($1, $2, $3, $4, $5)`,
			[newId(), teamId, member.userId, member.role, now],
		);
	}

	return { team, board };
}

// ── seedColumn ────────────────────────────────────────────────────────────────

export interface SeededColumn {
	id: string;
	boardId: string;
	title: string;
	position: string;
}

export async function seedColumn(
	boardId: string,
	input?: { title?: string; position?: string },
): Promise<SeededColumn> {
	const id = newId();
	const title = input?.title ?? "Column";
	const position = input?.position ?? "a0";
	const now = new Date();

	const { rows } = await pool.query<SeededColumn>(
		`INSERT INTO columns (id, board_id, title, position, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $5)
		 RETURNING id, board_id AS "boardId", title, position`,
		[id, boardId, title, position, now],
	);
	return rows[0]!;
}

// ── seedCard ──────────────────────────────────────────────────────────────────

export interface SeededCard {
	id: string;
	boardId: string;
	columnId: string;
	title: string;
	position: string;
}

export async function seedCard(
	boardId: string,
	columnId: string,
	input?: { title?: string; position?: string },
): Promise<SeededCard> {
	const id = newId();
	const title = input?.title ?? "Card";
	const now = new Date();

	let position: string;
	if (input?.position !== undefined) {
		position = input.position;
	} else {
		// Compute a position that appends after the last existing card in the column
		const { rows: existingCards } = await pool.query<{ position: string }>(
			`SELECT position FROM cards WHERE column_id = $1 ORDER BY position DESC LIMIT 1`,
			[columnId],
		);
		const lastPosition = existingCards.length > 0 ? existingCards[0]!.position : null;
		position = appendAfter(lastPosition);
	}

	const { rows } = await pool.query<SeededCard>(
		`INSERT INTO cards (id, board_id, column_id, title, position, label_ids, assignee_ids, attachment_ids, comments, checklists, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, '{}', '{}', '{}', '[]', '[]', $6, $6)
		 RETURNING id, board_id AS "boardId", column_id AS "columnId", title, position`,
		[id, boardId, columnId, title, position, now],
	);
	return rows[0]!;
}

// ── seedLabel ─────────────────────────────────────────────────────────────────

export interface SeededLabel {
	id: string;
	boardId: string;
	name: string;
	color: string;
}

export async function seedLabel(
	boardId: string,
	input?: { name?: string; color?: string },
): Promise<SeededLabel> {
	const id = newId();
	const name = input?.name ?? "Label";
	const color = input?.color ?? "#6366f1";

	const { rows } = await pool.query<SeededLabel>(
		`INSERT INTO labels (id, board_id, name, color)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, board_id AS "boardId", name, color`,
		[id, boardId, name, color],
	);
	return rows[0]!;
}

// ── seedKumiaiGoal ────────────────────────────────────────────────────────────

export interface SeededKumiaiGoal {
	id: string;
	teamId: string;
	title: string;
	body: string;
	status: "todo" | "in-progress" | "done";
	priority: number;
}

export async function seedKumiaiGoal(
	teamId: string,
	input?: {
		title?: string;
		body?: string;
		status?: "todo" | "in-progress" | "done";
		priority?: number;
	},
): Promise<SeededKumiaiGoal> {
	const id = newId();
	const title = input?.title ?? "Goal";
	const body = input?.body ?? "";
	const status = input?.status ?? "todo";
	const priority = input?.priority ?? 3;
	const now = new Date();

	const { rows } = await pool.query<SeededKumiaiGoal>(
		`INSERT INTO kumiai_goals (id, team_id, title, body, status, priority, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
		 RETURNING id, team_id AS "teamId", title, body, status, priority`,
		[id, teamId, title, body, status, priority, now],
	);
	return rows[0]!;
}

// ── seedKumiaiProject ─────────────────────────────────────────────────────────

export interface SeededKumiaiProject {
	id: string;
	teamId: string;
	goalId: string;
	title: string;
	body: string;
	ordinal: number | null;
	status: "backlog" | "todo" | "in-progress" | "blocked" | "done";
	priority: "urgent" | "high" | "medium" | "low";
	impact: number;
	effort: number;
	targetWindowKind: "week" | "month" | "quarter" | null;
	targetWindowLabel: string | null;
	targetWindowYear: number | null;
	targetWindowNumber: number | null;
	blockedReason: string | null;
}

export async function seedKumiaiProject(
	teamId: string,
	goalId: string,
	input?: {
		title?: string;
		body?: string;
		ordinal?: number | null;
		status?: "backlog" | "todo" | "in-progress" | "blocked" | "done";
		priority?: "urgent" | "high" | "medium" | "low";
		impact?: number;
		effort?: number;
		targetWindowKind?: "week" | "month" | "quarter" | null;
		targetWindowLabel?: string | null;
		targetWindowYear?: number | null;
		targetWindowNumber?: number | null;
		blockedReason?: string | null;
	},
): Promise<SeededKumiaiProject> {
	const id = newId();
	const title = input?.title ?? "Project";
	const body = input?.body ?? "";
	const ordinal = input?.ordinal ?? null;
	const status = input?.status ?? "backlog";
	const priority = input?.priority ?? "medium";
	const impact = input?.impact ?? 50;
	const effort = input?.effort ?? 5;
	const targetWindowKind = input?.targetWindowKind ?? null;
	const targetWindowLabel = input?.targetWindowLabel ?? null;
	const targetWindowYear = input?.targetWindowYear ?? null;
	const targetWindowNumber = input?.targetWindowNumber ?? null;
	const blockedReason =
		input?.blockedReason !== undefined
			? input.blockedReason
			: status === "blocked"
				? "Blocked"
				: null;
	const now = new Date();

	const { rows } = await pool.query<SeededKumiaiProject>(
		`INSERT INTO kumiai_projects (
			id, team_id, goal_id, title, body, ordinal, status, priority, impact, effort,
			target_window_kind, target_window_label, target_window_year, target_window_number,
			blocked_reason, created_at, updated_at
		 )
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
		 RETURNING id, team_id AS "teamId", goal_id AS "goalId", title, body, ordinal, status,
			priority, impact, effort, target_window_kind AS "targetWindowKind",
			target_window_label AS "targetWindowLabel", target_window_year AS "targetWindowYear",
			target_window_number AS "targetWindowNumber", blocked_reason AS "blockedReason"`,
		[
			id,
			teamId,
			goalId,
			title,
			body,
			ordinal,
			status,
			priority,
			impact,
			effort,
			targetWindowKind,
			targetWindowLabel,
			targetWindowYear,
			targetWindowNumber,
			blockedReason,
			now,
		],
	);
	return rows[0]!;
}

// ── seedKumiaiRequirement ─────────────────────────────────────────────────────

export interface SeededKumiaiRequirement {
	id: string;
	teamId: string;
	projectId: string | null;
	title: string;
	body: string;
	status: "todo" | "in-progress" | "done";
	priority: number;
}

export async function seedKumiaiRequirement(
	teamId: string,
	input?: {
		projectId?: string | null;
		title?: string;
		body?: string;
		status?: "todo" | "in-progress" | "done";
		priority?: number;
	},
): Promise<SeededKumiaiRequirement> {
	const id = newId();
	const projectId = input?.projectId ?? null;
	const title = input?.title ?? "Requirement";
	const body = input?.body ?? "";
	const status = input?.status ?? "todo";
	const priority = input?.priority ?? 3;
	const now = new Date();

	const { rows } = await pool.query<SeededKumiaiRequirement>(
		`INSERT INTO kumiai_requirements (id, team_id, project_id, title, body, status, priority, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
		 RETURNING id, team_id AS "teamId", project_id AS "projectId", title, body, status, priority`,
		[id, teamId, projectId, title, body, status, priority, now],
	);
	return rows[0]!;
}

// ── seedKumiaiPlan ────────────────────────────────────────────────────────────

export interface SeededKumiaiPlan {
	id: string;
	teamId: string;
	requirementId: string;
	taskId: string | null;
	title: string;
	body: string;
	status: "todo" | "in-progress" | "done";
	approval: "pending" | "approved" | "rejected";
	approvedBy: string | null;
	approvedAt: Date | null;
}

export async function seedKumiaiPlan(
	teamId: string,
	requirementId: string,
	input?: {
		taskId?: string | null;
		title?: string;
		body?: string;
		status?: "todo" | "in-progress" | "done";
		approval?: "pending" | "approved" | "rejected";
		approvedBy?: string | null;
		approvedAt?: Date | null;
	},
): Promise<SeededKumiaiPlan> {
	const id = newId();
	const taskId = input?.taskId ?? null;
	const title = input?.title ?? "Plan";
	const body = input?.body ?? "";
	const status = input?.status ?? "todo";
	const approval = input?.approval ?? "pending";
	const approvedBy = input?.approvedBy ?? null;
	const approvedAt = input?.approvedAt ?? null;
	const now = new Date();

	const { rows } = await pool.query<SeededKumiaiPlan>(
		`INSERT INTO kumiai_plans (
			id, team_id, requirement_id, task_id, title, body, status, approval,
			approved_by, approved_at, created_at, updated_at
		 )
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
		 RETURNING id, team_id AS "teamId", requirement_id AS "requirementId", task_id AS "taskId",
			title, body, status, approval, approved_by AS "approvedBy", approved_at AS "approvedAt"`,
		[id, teamId, requirementId, taskId, title, body, status, approval, approvedBy, approvedAt, now],
	);
	return rows[0]!;
}

// ── seedKumiaiTask ────────────────────────────────────────────────────────────

export interface SeededKumiaiTask {
	id: string;
	teamId: string;
	requirementId: string;
	planId: string | null;
	title: string;
	objective: string;
	body: string;
	status: "todo" | "in-progress" | "done" | "failed" | "blocked" | "waived";
	priority: number;
}

export async function seedKumiaiTask(
	teamId: string,
	requirementId: string,
	input?: {
		planId?: string | null;
		title?: string;
		objective?: string;
		body?: string;
		status?: "todo" | "in-progress" | "done" | "failed" | "blocked" | "waived";
		priority?: number;
	},
): Promise<SeededKumiaiTask> {
	const id = newId();
	const planId = input?.planId ?? null;
	const title = input?.title ?? "Task";
	const objective = input?.objective ?? "";
	const body = input?.body ?? "";
	const status = input?.status ?? "todo";
	const priority = input?.priority ?? 3;
	const now = new Date();

	const { rows } = await pool.query<SeededKumiaiTask>(
		`INSERT INTO kumiai_tasks (id, team_id, requirement_id, plan_id, title, objective, body, status, priority, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
		 RETURNING id, team_id AS "teamId", requirement_id AS "requirementId", plan_id AS "planId",
			title, objective, body, status, priority`,
		[id, teamId, requirementId, planId, title, objective, body, status, priority, now],
	);
	return rows[0]!;
}
