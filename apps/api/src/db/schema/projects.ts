import { pgTable, text, index } from "drizzle-orm/pg-core";
import { boards } from "./boards.js";

export const projects = pgTable(
	"projects",
	{
		id: text("id").primaryKey(),
		boardId: text("board_id")
			.notNull()
			.references(() => boards.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		color: text("color").notNull(),
	},
	(t) => [index("projects_board_idx").on(t.boardId)],
);
