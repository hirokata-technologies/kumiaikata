import { z } from "zod";
import { ObjectId } from "mongodb";

export const ATTACHMENTS_COLLECTION = "attachments" as const;

export const AttachmentSchema = z.object({
	_id: z.instanceof(ObjectId),
	cardId: z.instanceof(ObjectId),
	boardId: z.instanceof(ObjectId),
	filename: z.string(),
	mimeType: z.string(),
	sizeBytes: z.number(),
	storageKey: z.string(),
	uploadedBy: z.instanceof(ObjectId),
	createdAt: z.date(),
});

export type Attachment = z.infer<typeof AttachmentSchema>;
