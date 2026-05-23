import { z } from "zod";
import { ObjectId } from "mongodb";

export const TEAMS_COLLECTION = "teams" as const;

export const TeamSchema = z.object({
	_id: z.instanceof(ObjectId),
	domain: z.string(),
	name: z.string(),
	teamBoardId: z.instanceof(ObjectId).optional(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export type Team = z.infer<typeof TeamSchema>;
