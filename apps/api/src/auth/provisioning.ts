import { eq, and, count } from "drizzle-orm";
import { db } from "../db/client.js";
import { newId } from "../db/ids.js";
import { boards, teams, teamMembers, users } from "../db/schema/index.js";
import { AppError } from "../http/error.js";
import { domainOf } from "./domain-allowlist.js";

export async function provisionUser(user: {
	id: string;
	email: string;
	name?: string | null | undefined;
}): Promise<void> {
	if (typeof user.id !== "string" || !user.id) {
		throw new AppError("INTERNAL_ERROR", "Better Auth user.id must be a non-empty string");
	}

	try {
		await db.transaction(async (tx) => {
			const now = new Date();

			// 1. Personal board — title fallback preserved exactly.
			const firstName = (user.name ?? "").split(" ")[0] ?? "";
			const boardTitle = firstName ? `${firstName}'s Board` : "My Board";
			const personalBoardId = newId();

			await tx.insert(boards).values({
				id: personalBoardId,
				kind: "personal",
				title: boardTitle,
				ownerId: user.id,
				createdAt: now,
				updatedAt: now,
			});

			// 2. Denormalised pointer back on the user row.
			await tx.update(users)
				.set({ personalBoardId })
				.where(eq(users.id, user.id));

			// 3. Team upsert by domain. ON CONFLICT DO UPDATE … RETURNING returns
			//    the existing row when the unique constraint fires, the new row
			//    when it inserts. Updating updated_at is a harmless no-op-ish
			//    side effect that lets us use DO UPDATE for the RETURNING clause.
			const domain = domainOf(user.email);
			const [team] = await tx.insert(teams).values({
				id: newId(),
				domain,
				name: domain,
				createdAt: now,
				updatedAt: now,
			})
				.onConflictDoUpdate({
					target: teams.domain,
					set: { updatedAt: now },
				})
				.returning();

			if (!team) {
				throw new Error(`[provisioning] team upsert returned null for domain ${domain}`);
			}

			// 4. Team board — insert only if the team has none yet.
			const [existingTeamBoard] = await tx
				.select({ id: boards.id })
				.from(boards)
				.where(and(eq(boards.kind, "team"), eq(boards.teamId, team.id)))
				.limit(1);

			if (!existingTeamBoard) {
				await tx.insert(boards).values({
					id: newId(),
					kind: "team",
					title: `${domain} Board`,
					teamId: team.id,
					createdAt: now,
					updatedAt: now,
				});
			}

			// 5. Membership — first member is admin, subsequent are members.
			//    Use ON CONFLICT DO NOTHING to handle concurrent first-sign-ins.
			const [memberCount] = await tx
				.select({ value: count() })
				.from(teamMembers)
				.where(eq(teamMembers.teamId, team.id));

			const role: "admin" | "member" = (memberCount?.value ?? 0) === 0 ? "admin" : "member";

			await tx.insert(teamMembers).values({
				id: newId(),
				teamId: team.id,
				userId: user.id,
				role,
				joinedAt: now,
			}).onConflictDoNothing({
				target: [teamMembers.teamId, teamMembers.userId],
			});
		});
	} catch (err) {
		console.error("[provisioning] failed to provision user", {
			userId: user.id,
			email: user.email,
			error: err,
		});
		throw err;
	}
}
