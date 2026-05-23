import { z } from "zod";
import { ObjectId } from "mongodb";

export const COLUMNS_COLLECTION = "columns" as const;

export const ColumnSchema = z.object({
	_id: z.instanceof(ObjectId),
	boardId: z.instanceof(ObjectId),
	title: z.string(),
	position: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export type Column = z.infer<typeof ColumnSchema>;
