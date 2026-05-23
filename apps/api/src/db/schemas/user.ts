import { z } from "zod";
import { ObjectId } from "mongodb";

export const USER_COLLECTION = "user" as const;

// Better Auth owns this collection. _id is a string (UUID/cuid), not ObjectId.
// We use passthrough() to allow additional Better Auth fields.
export const UserSchema = z
	.object({
		_id: z.string(),
		email: z.string(),
		name: z.string().optional(),
		personalBoardId: z.instanceof(ObjectId).optional(),
	})
	.passthrough();

export type User = z.infer<typeof UserSchema>;
