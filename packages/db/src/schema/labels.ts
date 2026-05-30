import { pgTable, text, index } from "drizzle-orm/pg-core";
import { boards } from "./boards.js";

export const labels = pgTable(
	"labels",
	{
		id: text("id").primaryKey(),
		boardId: text("board_id")
			.notNull()
			.references(() => boards.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		color: text("color").notNull(),
	},
	(t) => [index("labels_board_idx").on(t.boardId)],
);
