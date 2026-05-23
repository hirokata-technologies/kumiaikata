/**
 * Hono context variable types for the kata API.
 * These are populated by auth middleware (requireSession, loadBoardAccess).
 */

import type { ObjectId } from "mongodb";

export interface UserSession {
	id: string;
	email: string;
	name?: string;
}

export type BoardAccess =
	| { kind: "personal-owner"; boardId: string }
	| { kind: "team-admin"; boardId: string; teamId: string }
	| { kind: "team-member"; boardId: string; teamId: string };

/** Minimal board shape stored on the context by loadBoardAccess middleware. */
export interface ContextBoard {
	_id: ObjectId;
	kind: string;
	title: string;
	ownerId?: ObjectId;
	teamId?: ObjectId;
}

// Variables stored on the Hono context by middleware.
export interface AppVariables {
	user: UserSession;
	session: unknown;
	board: ContextBoard;
	access: BoardAccess;
}
