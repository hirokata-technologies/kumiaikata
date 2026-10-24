import { describe, it, expect } from "vitest";
import {
	seedUser,
	seedTeamWithBoard,
} from "../helpers/index.js";
import {
	getTeamForUser,
	listMembers,
	setMemberRole,
} from "../../src/services/teams.js";

describe("getTeamForUser", () => {
	it("returns team info and role for a team member", async () => {
		const user = await seedUser({ email: "alice@test.com" });
		const { team } = await seedTeamWithBoard({
			domain: "test.com",
			members: [{ userId: user.id, role: "admin" }],
		});

		const result = await getTeamForUser(user.id);

		expect(result.id).toBe(team.id);
		expect(result.domain).toBe("test.com");
		expect(result.role).toBe("admin");
	});

	it("throws NOT_FOUND when the user has no team membership", async () => {
		const user = await seedUser();

		await expect(getTeamForUser(user.id)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("listMembers", () => {
	it("returns all members with non-empty emails (BUG-006 regression)", async () => {
		// BUG-006: the service was returning email: "" for members.
		// The fix at teams.ts:48-65 left-joins users.email so emails are populated.
		// This test confirms BUG-006 is resolved: listMembers must return real emails.
		const alice = await seedUser({ email: "alice@test.com", name: "Alice" });
		const bob = await seedUser({ email: "bob@test.com", name: "Bob" });

		const { team } = await seedTeamWithBoard({
			domain: "test.com",
			members: [
				{ userId: alice.id, role: "admin" },
				{ userId: bob.id, role: "member" },
			],
		});

		const members = await listMembers(team.id);

		expect(members).toHaveLength(2);

		const aliceRow = members.find((m) => m.userId === alice.id);
		const bobRow = members.find((m) => m.userId === bob.id);

		expect(aliceRow).toBeDefined();
		expect(aliceRow!.email).toBe("alice@test.com");
		expect(aliceRow!.name).toBe("Alice");
		expect(aliceRow!.imageUrl).toBeNull();
		expect(aliceRow!.role).toBe("admin");

		expect(bobRow).toBeDefined();
		expect(bobRow!.email).toBe("bob@test.com");
		expect(bobRow!.name).toBe("Bob");
		expect(bobRow!.imageUrl).toBeNull();
		expect(bobRow!.role).toBe("member");

		// Both emails must be non-empty (BUG-006 regression assertion)
		for (const member of members) {
			expect(member.email).toBeTruthy();
		}
	});

	it("returns null name and imageUrl when user has no name or image", async () => {
		const ghost = await seedUser({ email: "ghost@test.com", name: null });

		const { team } = await seedTeamWithBoard({
			domain: "null-fields.com",
			members: [{ userId: ghost.id, role: "member" }],
		});

		const members = await listMembers(team.id);
		expect(members).toHaveLength(1);

		const ghostRow = members[0]!;
		expect(ghostRow.name).toBeNull();
		expect(ghostRow.imageUrl).toBeNull();
	});
});

describe("setMemberRole", () => {
	it("promotes a member to admin when called by an existing admin", async () => {
		const alice = await seedUser({ email: "alice@test.com" });
		const bob = await seedUser({ email: "bob@test.com" });

		const { team } = await seedTeamWithBoard({
			domain: "test.com",
			members: [
				{ userId: alice.id, role: "admin" },
				{ userId: bob.id, role: "member" },
			],
		});

		const result = await setMemberRole(team.id, bob.id, "admin", alice.id);

		expect(result).toEqual({ userId: bob.id, role: "admin" });
	});

	it("throws CONFLICT when the last admin tries to demote themselves", async () => {
		const alice = await seedUser({ email: "alice@test.com" });
		const { team } = await seedTeamWithBoard({
			domain: "test.com",
			members: [{ userId: alice.id, role: "admin" }],
		});

		await expect(
			setMemberRole(team.id, alice.id, "member", alice.id),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "At least one admin must remain on the team.",
		});
	});

	it("throws FORBIDDEN when the actor is a member, not an admin", async () => {
		const alice = await seedUser({ email: "alice@test.com" });
		const bob = await seedUser({ email: "bob@test.com" });
		const charlie = await seedUser({ email: "charlie@test.com" });

		const { team } = await seedTeamWithBoard({
			domain: "test.com",
			members: [
				{ userId: alice.id, role: "admin" },
				{ userId: bob.id, role: "member" },
				{ userId: charlie.id, role: "member" },
			],
		});

		// Bob is a member — he cannot promote Charlie
		await expect(
			setMemberRole(team.id, charlie.id, "admin", bob.id),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("throws NOT_FOUND when the target user is not in the team", async () => {
		const alice = await seedUser({ email: "alice@test.com" });
		const nonMember = await seedUser({ email: "ghost@test.com" });

		const { team } = await seedTeamWithBoard({
			domain: "test.com",
			members: [{ userId: alice.id, role: "admin" }],
		});

		await expect(
			setMemberRole(team.id, nonMember.id, "admin", alice.id),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("allows demoting an admin when another admin exists", async () => {
		const alice = await seedUser({ email: "alice@test.com" });
		const bob = await seedUser({ email: "bob@test.com" });

		const { team } = await seedTeamWithBoard({
			domain: "test.com",
			members: [
				{ userId: alice.id, role: "admin" },
				{ userId: bob.id, role: "admin" },
			],
		});

		// Alice can demote Bob since Alice remains as admin
		const result = await setMemberRole(team.id, bob.id, "member", alice.id);
		expect(result).toEqual({ userId: bob.id, role: "member" });
	});
});
