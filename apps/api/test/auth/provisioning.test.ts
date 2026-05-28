import { describe, it, expect, beforeEach } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "../../src/db/client.js";
import { boards, teams, teamMembers, users } from "../../src/db/schema/index.js";
import { truncateAll, seedUser } from "../helpers/index.js";
import { provisionUser } from "../../src/auth/provisioning.js";

beforeEach(() => truncateAll());

describe("provisionUser — first user for a domain", () => {
	it("creates a personal board, links it to the user, creates team and team board, and makes user admin", async () => {
		const user = await seedUser({ email: "alice@corp.com", name: "Alice Smith" });

		await provisionUser({ id: user.id, email: user.email, name: "Alice Smith" });

		// (a) Personal board with correct shape
		const personalBoards = await db
			.select()
			.from(boards)
			.where(and(eq(boards.kind, "personal"), eq(boards.ownerId, user.id)));

		expect(personalBoards).toHaveLength(1);
		const personalBoard = personalBoards[0]!;
		expect(personalBoard.title).toBe("Alice's Board");
		expect(personalBoard.ownerId).toBe(user.id);

		// (b) users.personalBoardId updated
		const [userRow] = await db
			.select({ personalBoardId: users.personalBoardId })
			.from(users)
			.where(eq(users.id, user.id));
		expect(userRow!.personalBoardId).toBe(personalBoard.id);

		// (c) A teams row exists for corp.com
		const teamRows = await db
			.select()
			.from(teams)
			.where(eq(teams.domain, "corp.com"));
		expect(teamRows).toHaveLength(1);
		const team = teamRows[0]!;

		// (d) A team board with kind: "team" exists
		const teamBoards = await db
			.select()
			.from(boards)
			.where(and(eq(boards.kind, "team"), eq(boards.teamId, team.id)));
		expect(teamBoards).toHaveLength(1);
		expect(teamBoards[0]!.title).toBe("corp.com Board");

		// (e) team_members row for user has role: "admin" (first member is promoted)
		const [membership] = await db
			.select()
			.from(teamMembers)
			.where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, user.id)));
		expect(membership).toBeDefined();
		expect(membership!.role).toBe("admin");
	});
});

describe("provisionUser — second user for the same domain", () => {
	it("reuses the existing team, adds the second user as member, keeps first user as admin", async () => {
		const alice = await seedUser({ email: "alice@corp.com", name: "Alice" });
		await provisionUser({ id: alice.id, email: alice.email, name: "Alice" });

		const bob = await seedUser({ email: "bob@corp.com", name: "Bob" });
		await provisionUser({ id: bob.id, email: bob.email, name: "Bob" });

		// (a) Still exactly one teams row for corp.com
		const teamRows = await db
			.select()
			.from(teams)
			.where(eq(teams.domain, "corp.com"));
		expect(teamRows).toHaveLength(1);

		const team = teamRows[0]!;

		// (b) Two team_members rows
		const members = await db
			.select()
			.from(teamMembers)
			.where(eq(teamMembers.teamId, team.id));
		expect(members).toHaveLength(2);

		// (c) Alice is admin, Bob is member
		const aliceMember = members.find((m) => m.userId === alice.id);
		const bobMember = members.find((m) => m.userId === bob.id);
		expect(aliceMember!.role).toBe("admin");
		expect(bobMember!.role).toBe("member");

		// (d) Still exactly one kind: "team" board for the team
		const teamBoards = await db
			.select()
			.from(boards)
			.where(and(eq(boards.kind, "team"), eq(boards.teamId, team.id)));
		expect(teamBoards).toHaveLength(1);
	});
});

describe("provisionUser — name fallback", () => {
	it("uses 'My Board' as personal board title when name is null", async () => {
		const user = await seedUser({ email: "noname@corp.com", name: null });

		await provisionUser({ id: user.id, email: user.email, name: null });

		const [personalBoard] = await db
			.select()
			.from(boards)
			.where(and(eq(boards.kind, "personal"), eq(boards.ownerId, user.id)));

		expect(personalBoard!.title).toBe("My Board");
	});
});

describe("provisionUser — empty id guard", () => {
	it("throws INTERNAL_ERROR when id is an empty string", async () => {
		await expect(
			provisionUser({ id: "", email: "x@corp.com", name: "X" }),
		).rejects.toMatchObject({
			code: "INTERNAL_ERROR",
			message: expect.stringContaining("non-empty string"),
		});
	});
});

describe("provisionUser — idempotency", () => {
	it("calling provisionUser twice for the same user does not duplicate team_members rows", async () => {
		const user = await seedUser({ email: "alice@corp.com", name: "Alice" });

		await provisionUser({ id: user.id, email: user.email, name: "Alice" });

		// Second call for the same user must not throw
		await expect(
			provisionUser({ id: user.id, email: user.email, name: "Alice" }),
		).resolves.toBeUndefined();

		// team_members still has exactly one row for the user
		const [team] = await db
			.select()
			.from(teams)
			.where(eq(teams.domain, "corp.com"));

		const memberRows = await db
			.select()
			.from(teamMembers)
			.where(and(eq(teamMembers.teamId, team!.id), eq(teamMembers.userId, user.id)));

		expect(memberRows).toHaveLength(1);
	});
});
