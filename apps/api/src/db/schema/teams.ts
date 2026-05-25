import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const teams = pgTable("teams", {
	id: text("id").primaryKey(),
	domain: text("domain").notNull().unique(),
	name: text("name").notNull(),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
});
