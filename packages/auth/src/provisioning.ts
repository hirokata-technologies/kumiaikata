import { eq, and, sql } from "drizzle-orm";
import { generateNKeysBetween } from "fractional-indexing";
import { db, newId } from "@kata/db";
import { boards, columns, teams, teamMembers, users } from "@kata/db";
import { AppError } from "@kata/http";
import { domainOf } from "./domain-allowlist.js";

const DEFAULT_COLUMNS = ["Backlog", "Priorities", "In Progress", "Done"] as const;

async function seedDefaultColumns(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	boardId: string,
	now: Date,
): Promise<void> {
	const positions = generateNKeysBetween(null, null, DEFAULT_COLUMNS.length);
	await tx.insert(columns).values(
		DEFAULT_COLUMNS.map((title, i) => ({
			id: newId(),
			boardId,
			title,
			position: positions[i]!,
			createdAt: now,
			updatedAt: now,
		})),
	);
}

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
			await seedDefaultColumns(tx, personalBoardId, now);

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
				const teamBoardId = newId();
				await tx.insert(boards).values({
					id: teamBoardId,
					kind: "team",
					title: `${domain} Board`,
					teamId: team.id,
					createdAt: now,
					updatedAt: now,
				});
				await seedDefaultColumns(tx, teamBoardId, now);
			}

			// 5. Membership — insert as member, then promote to admin if sole member.
			//    Promotes after insert to avoid a pre-insert count race where two
			//    concurrent first-sign-ins both see count=0 and both try to be admin.
			await tx.insert(teamMembers).values({
				id: newId(),
				teamId: team.id,
				userId: user.id,
				role: "member",
				joinedAt: now,
			}).onConflictDoNothing({
				target: [teamMembers.teamId, teamMembers.userId],
			});

			const memberCount = await tx
				.select({ count: sql<number>`count(*)` })
				.from(teamMembers)
				.where(eq(teamMembers.teamId, team.id));

			if (Number(memberCount[0]?.count) === 1) {
				await tx
					.update(teamMembers)
					.set({ role: "admin" })
					.where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, user.id)));
			}
		});
	} catch (err) {
		console.error("[provisioning] failed to provision user", {
			userId: user.id,
			error: err instanceof Error ? err.message : String(err),
		});
		throw err;
	}
}
