CREATE TABLE "kumiai_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kumiai_goals" ADD COLUMN "workspace_id" text;--> statement-breakpoint
-- Every existing team gets its "default" workspace, and its goals move into it.
INSERT INTO "kumiai_workspaces" ("id", "team_id", "name", "is_default", "created_at", "updated_at")
SELECT substr(md5(random()::text || "id"), 1, 21), "id", 'default', true, now(), now() FROM "teams";--> statement-breakpoint
UPDATE "kumiai_goals" g SET "workspace_id" = w."id" FROM "kumiai_workspaces" w WHERE w."team_id" = g."team_id" AND w."is_default";--> statement-breakpoint
ALTER TABLE "kumiai_goals" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "kumiai_workspaces" ADD CONSTRAINT "kumiai_workspaces_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kumiai_workspaces_team_idx" ON "kumiai_workspaces" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kumiai_workspaces_team_name_idx" ON "kumiai_workspaces" USING btree ("team_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "kumiai_workspaces_one_default_idx" ON "kumiai_workspaces" USING btree ("team_id") WHERE "kumiai_workspaces"."is_default";--> statement-breakpoint
ALTER TABLE "kumiai_goals" ADD CONSTRAINT "kumiai_goals_workspace_id_kumiai_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."kumiai_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kumiai_goals_workspace_idx" ON "kumiai_goals" USING btree ("workspace_id");