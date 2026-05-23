import { z } from "zod";
import { ObjectId } from "mongodb";

export const CARDS_COLLECTION = "cards" as const;

const CommentSchema = z.object({
	_id: z.instanceof(ObjectId),
	authorId: z.instanceof(ObjectId),
	body: z.string(),
	createdAt: z.date(),
	updatedAt: z.date().optional(),
});

const ChecklistItemSchema = z.object({
	_id: z.instanceof(ObjectId),
	text: z.string(),
	checked: z.boolean(),
});

const ChecklistSchema = z.object({
	_id: z.instanceof(ObjectId),
	title: z.string(),
	items: z.array(ChecklistItemSchema),
});

export const CardSchema = z.object({
	_id: z.instanceof(ObjectId),
	boardId: z.instanceof(ObjectId),
	columnId: z.instanceof(ObjectId),
	title: z.string(),
	description: z.string().nullable().optional(),
	position: z.string(),
	dueDate: z.date().nullable().optional(),
	labelIds: z.array(z.instanceof(ObjectId)),
	assigneeIds: z.array(z.instanceof(ObjectId)),
	attachmentIds: z.array(z.instanceof(ObjectId)),
	comments: z.array(CommentSchema),
	checklists: z.array(ChecklistSchema),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export type Card = z.infer<typeof CardSchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;
export type Checklist = z.infer<typeof ChecklistSchema>;
