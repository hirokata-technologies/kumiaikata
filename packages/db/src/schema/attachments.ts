import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { cards } from "./cards.js";
import { boards } from "./boards.js";
import { users } from "./auth.js";

export const attachments = pgTable(
	"attachments",
	{
		id: text("id").primaryKey(),
		cardId: text("card_id")
			.notNull()
			.references(() => cards.id, { onDelete: "cascade" }),
		boardId: text("board_id")
			.notNull()
			.references(() => boards.id, { onDelete: "cascade" }),
		filename: text("filename").notNull(),
		mimeType: text("mime_type").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		storageKey: text("storage_key").notNull(),
		uploadedBy: text("uploaded_by")
			.notNull()
			.references(() => users.id),
		createdAt: timestamp("created_at").notNull(),
	},
	(t) => [
		index("attachments_card_idx").on(t.cardId),
		index("attachments_board_idx").on(t.boardId),
	],
);
