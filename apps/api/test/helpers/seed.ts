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
