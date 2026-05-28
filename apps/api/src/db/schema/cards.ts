import { pgTable, text, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { boards } from "./boards.js";
import { columns } from "./columns.js";
import { projects } from "./projects.js";

export interface Comment {
	id: string;
	authorId: string;
	body: string;
	createdAt: string; // ISO 8601 string
	updatedAt?: string;
}

export interface ChecklistItem {
	id: string;
	text: string;
	checked: boolean;
}

export interface Checklist {
	id: string;
	title: string;
	items: ChecklistItem[];
}

export const cards = pgTable(
	"cards",
	{
		id: text("id").primaryKey(),
		boardId: text("board_id")
			.notNull()
			.references(() => boards.id, { onDelete: "cascade" }),
		columnId: text("column_id")
			.notNull()
			.references(() => columns.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		description: text("description"),
		position: text("position").notNull(),
		dueDate: timestamp("due_date"),
		labelIds: text("label_ids")
			.array()
			.notNull()
			.default(sql`'{}'`),
		assigneeIds: text("assignee_ids")
			.array()
			.notNull()
			.default(sql`'{}'`),
		attachmentIds: text("attachment_ids")
			.array()
			.notNull()
			.default(sql`'{}'`),
		projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
		comments: jsonb("comments").$type<Comment[]>().notNull().default([]),
		checklists: jsonb("checklists").$type<Checklist[]>().notNull().default([]),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		index("cards_board_idx").on(t.boardId),
		index("cards_column_idx").on(t.columnId),
		index("cards_column_pos_idx").on(t.columnId, t.position),
	],
);
