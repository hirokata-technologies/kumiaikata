import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { boards } from "./boards.js";

export const columns = pgTable(
	"columns",
	{
		id: text("id").primaryKey(),
		boardId: text("board_id")
			.notNull()
			.references(() => boards.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		position: text("position").notNull(),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		index("columns_board_idx").on(t.boardId),
		index("columns_board_pos_idx").on(t.boardId, t.position),
	],
);
