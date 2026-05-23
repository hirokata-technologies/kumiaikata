import { z } from "zod";
import { ObjectId } from "mongodb";

export const TEAM_MEMBERS_COLLECTION = "teammembers" as const;

export const TeamMemberSchema = z.object({
	_id: z.instanceof(ObjectId),
	teamId: z.instanceof(ObjectId),
	// Better Auth stores user._id as a string (UUID/CUID), not a MongoDB ObjectId.
	// userId is type-cast to ObjectId at write time to satisfy this schema, but the
	// raw string is stored in the DB. All queries against userId MUST use the raw
	// string value, not new ObjectId(userId).
	userId: z.instanceof(ObjectId),
	role: z.enum(["admin", "member"]),
	joinedAt: z.date(),
});

export type TeamMember = z.infer<typeof TeamMemberSchema>;
