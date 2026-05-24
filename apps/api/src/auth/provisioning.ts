import { ObjectId } from "mongodb";
import { withTransaction } from "../db/connection.js";
import {
	boards as boardsColl,
	teams as teamsColl,
	teamMembers as teamMembersColl,
	users as usersColl,
} from "../db/schemas/index.js";
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
		await withTransaction(async (session) => {
			// 1. Personal board — title falls back to "My Board" when name is absent.
			const firstName = (user.name ?? "").split(" ")[0] ?? "";
			const boardTitle = firstName ? `${firstName}'s Board` : "My Board";

			// Better Auth stores user._id as a string (UUID/CUID), not a MongoDB ObjectId.
			// We type-cast here to satisfy the schema type while preserving the string value in the DB.
			// All queries against ownerId/userId MUST use the raw string, not new ObjectId(user.id).
			const personalBoardInsert = await boardsColl().insertOne(
				{
					_id: new ObjectId(),
					kind: "personal",
					title: boardTitle,
					ownerId: user.id as unknown as ObjectId,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				{ session },
			);

			// Better Auth user._id is a string — filter with the raw string value.
			await usersColl().updateOne(
				{ _id: user.id },
				{ $set: { personalBoardId: personalBoardInsert.insertedId } },
				{ session },
			);

			// 2. Team find-or-create (atomic upsert prevents duplicate teams on
			//    concurrent first-logins from the same domain).
			const domain = domainOf(user.email);
			const teamResult = await teamsColl().findOneAndUpdate(
				{ domain },
				{
					$setOnInsert: {
						domain,
						name: domain,
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				},
				{ upsert: true, returnDocument: "after", session },
			);
			if (!teamResult) {
				throw new Error(
					`[provisioning] team upsert returned null for domain ${domain}`,
				);
			}

			// 3. Team board find-or-create (only if the team has no board yet).
			if (!teamResult.teamBoardId) {
				const teamBoardInsert = await boardsColl().insertOne(
					{
						_id: new ObjectId(),
						kind: "team",
						title: `${domain} Board`,
						teamId: teamResult._id,
						createdAt: new Date(),
						updatedAt: new Date(),
					},
					{ session },
				);
				await teamsColl().updateOne(
					{ _id: teamResult._id },
					{ $set: { teamBoardId: teamBoardInsert.insertedId } },
					{ session },
				);
			}

			// 4. Team membership — first member becomes admin.
			const existingCount = await teamMembersColl().countDocuments(
				{ teamId: teamResult._id },
				{ session },
			);
			const role: "admin" | "member" = existingCount === 0 ? "admin" : "member";

			// userId is a Better Auth string ID, stored as-is with a type cast to
			// satisfy the schema's ObjectId type annotation.
			await teamMembersColl().updateOne(
				{
					teamId: teamResult._id,
					userId: user.id as unknown as ObjectId,
				},
				{
					$setOnInsert: {
						teamId: teamResult._id,
						userId: user.id as unknown as ObjectId,
						role,
						joinedAt: new Date(),
					},
				},
				{ upsert: true, session },
			);
		});
	} catch (err) {
		// Log with full context so operations can manually remediate. The user
		// account itself was already created by Better Auth before this runs.
		console.error("[provisioning] failed to provision user", {
			userId: user.id,
			email: user.email,
			error: err,
		});
		throw err;
	}
}
