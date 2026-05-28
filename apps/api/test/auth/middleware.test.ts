import { describe, it, expect, beforeEach } from "vitest";
import {
	truncateAll,
	seedUser,
	seedPersonalBoard,
	seedTeamWithBoard,
} from "../helpers/index.js";
import {
	deriveAccess,
	fetchBoardWithMembership,
	type BoardWithMembership,
} from "../../src/auth/middleware.js";

beforeEach(() => truncateAll());

// ── deriveAccess (pure, no DB) ────────────────────────────────────────────────

describe("deriveAccess — pure logic", () => {
	it("returns personal-owner access for a personal board with matching ownerId", () => {
		const board: BoardWithMembership = {
			id: "board-1",
			kind: "personal",
			title: "My Board",
			ownerId: "user-1",
			teamId: null,
			membership: null,
		};
		const user = { id: "user-1" };

		const access = deriveAccess(board, user);

		expect(access).toEqual({ kind: "personal-owner", boardId: "board-1" });
	});

	it("returns null for a personal board with non-matching ownerId", () => {
		const board: BoardWithMembership = {
			id: "board-1",
			kind: "personal",
			title: "My Board",
			ownerId: "user-1",
			teamId: null,
			membership: null,
		};
		const user = { id: "user-2" };

		const access = deriveAccess(board, user);

		expect(access).toBeNull();
	});

	it("returns team-admin access for a team board when membership.role is admin", () => {
		const board: BoardWithMembership = {
			id: "board-2",
			kind: "team",
			title: "Team Board",
			ownerId: null,
			teamId: "team-1",
			membership: { role: "admin" },
		};
		const user = { id: "user-1" };

		const access = deriveAccess(board, user);

		expect(access).toEqual({ kind: "team-admin", boardId: "board-2", teamId: "team-1" });
	});

	it("returns null for a team board when membership is null", () => {
		const board: BoardWithMembership = {
			id: "board-2",
			kind: "team",
			title: "Team Board",
			ownerId: null,
			teamId: "team-1",
			membership: null,
		};
		const user = { id: "user-3" };

		const access = deriveAccess(board, user);

		expect(access).toBeNull();
	});

	it("returns team-member access for a team board when membership.role is member", () => {
		const board: BoardWithMembership = {
			id: "board-2",
			kind: "team",
			title: "Team Board",
			ownerId: null,
			teamId: "team-1",
			membership: { role: "member" },
		};
		const user = { id: "user-2" };

		const access = deriveAccess(board, user);

		expect(access).toEqual({ kind: "team-member", boardId: "board-2", teamId: "team-1" });
	});
});

// ── fetchBoardWithMembership (DB) ─────────────────────────────────────────────

describe("fetchBoardWithMembership — DB queries", () => {
	it("returns null immediately for an empty string boardId", async () => {
		const result = await fetchBoardWithMembership("", "any-user-id");
		expect(result).toBeNull();
	});

	it("returns null when the boardId does not exist in the database", async () => {
		const user = await seedUser();
		const result = await fetchBoardWithMembership("nonexistent-board-id", user.id);
		expect(result).toBeNull();
	});

	it("returns BoardWithMembership with non-null membership for a team member", async () => {
		const user = await seedUser({ email: "alice@test.com" });
		const { team, board } = await seedTeamWithBoard({
			domain: "test.com",
			members: [{ userId: user.id, role: "admin" }],
		});

		const result = await fetchBoardWithMembership(board.id, user.id);

		expect(result).not.toBeNull();
		expect(result!.id).toBe(board.id);
		expect(result!.kind).toBe("team");
		expect(result!.teamId).toBe(team.id);
		expect(result!.membership).not.toBeNull();
		expect(result!.membership!.role).toBe("admin");
	});

	it("returns BoardWithMembership with null membership for a non-member on a team board", async () => {
		const member = await seedUser({ email: "member@test.com" });
		const nonMember = await seedUser({ email: "other@test.com" });
		const { board } = await seedTeamWithBoard({
			domain: "test.com",
			members: [{ userId: member.id, role: "admin" }],
		});

		const result = await fetchBoardWithMembership(board.id, nonMember.id);

		expect(result).not.toBeNull();
		expect(result!.membership).toBeNull();
	});

	it("returns a personal board with correct ownerId and null membership", async () => {
		const user = await seedUser();
		const board = await seedPersonalBoard(user.id, { title: "Personal" });

		const result = await fetchBoardWithMembership(board.id, user.id);

		expect(result).not.toBeNull();
		expect(result!.kind).toBe("personal");
		expect(result!.ownerId).toBe(user.id);
		expect(result!.membership).toBeNull();
	});
});
