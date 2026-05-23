import { z } from "zod";
import { ObjectId } from "mongodb";

export const BOARDS_COLLECTION = "boards" as const;

export const BoardSchema = z.object({
	_id: z.instanceof(ObjectId),
	kind: z.enum(["personal", "team"]),
	title: z.string(),
	ownerId: z.instanceof(ObjectId).optional(),
	teamId: z.instanceof(ObjectId).optional(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export type Board = z.infer<typeof BoardSchema>;
