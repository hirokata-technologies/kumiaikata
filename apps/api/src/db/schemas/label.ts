import { z } from "zod";
import { ObjectId } from "mongodb";

export const LABELS_COLLECTION = "labels" as const;

export const LabelSchema = z.object({
	_id: z.instanceof(ObjectId),
	boardId: z.instanceof(ObjectId),
	name: z.string(),
	color: z.string(),
});

export type Label = z.infer<typeof LabelSchema>;
