CREATE TABLE "kumiai_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"priority" integer NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "kumiai_goals_priority_check" CHECK ("kumiai_goals"."priority" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "kumiai_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"goal_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"ordinal" integer,
	"status" text NOT NULL,
	"priority" text NOT NULL,
	"impact" integer NOT NULL,
	"effort" integer NOT NULL,
	"target_window_kind" text,
	"target_window_label" text,
	"target_window_year" integer,
	"target_window_number" integer,
	"blocked_reason" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "kumiai_projects_impact_check" CHECK ("kumiai_projects"."impact" BETWEEN 1 AND 100),
	CONSTRAINT "kumiai_projects_effort_check" CHECK ("kumiai_projects"."effort" BETWEEN 1 AND 10),
	CONSTRAINT "kumiai_projects_blocked_reason_check" CHECK ("kumiai_projects"."status" <> 'blocked' OR ("kumiai_projects"."blocked_reason" IS NOT NULL AND length(trim("kumiai_projects"."blocked_reason")) > 0)),
	CONSTRAINT "kumiai_projects_target_window_check" CHECK (("kumiai_projects"."target_window_kind" IS NULL AND "kumiai_projects"."target_window_label" IS NULL AND "kumiai_projects"."target_window_year" IS NULL AND "kumiai_projects"."target_window_number" IS NULL)
				OR ("kumiai_projects"."target_window_kind" IS NOT NULL AND "kumiai_projects"."target_window_label" IS NOT NULL AND "kumiai_projects"."target_window_year" IS NOT NULL AND "kumiai_projects"."target_window_number" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "kumiai_requirements" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"priority" integer NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "kumiai_requirements_priority_check" CHECK ("kumiai_requirements"."priority" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "kumiai_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"requirement_id" text NOT NULL,
	"task_id" text,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"approval" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kumiai_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"requirement_id" text NOT NULL,
	"plan_id" text,
	"title" text NOT NULL,
	"objective" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"priority" integer NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "kumiai_tasks_priority_check" CHECK ("kumiai_tasks"."priority" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "kumiai_recent_projects" (
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"opened_at" timestamp NOT NULL,
	CONSTRAINT "kumiai_recent_projects_user_id_project_id_pk" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "kumiai_goals" ADD CONSTRAINT "kumiai_goals_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kumiai_projects" ADD CONSTRAINT "kumiai_projects_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kumiai_projects" ADD CONSTRAINT "kumiai_projects_goal_id_kumiai_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."kumiai_goals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kumiai_requirements" ADD CONSTRAINT "kumiai_requirements_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kumiai_requirements" ADD CONSTRAINT "kumiai_requirements_project_id_kumiai_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."kumiai_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kumiai_plans" ADD CONSTRAINT "kumiai_plans_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kumiai_plans" ADD CONSTRAINT "kumiai_plans_requirement_id_kumiai_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."kumiai_requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kumiai_tasks" ADD CONSTRAINT "kumiai_tasks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kumiai_tasks" ADD CONSTRAINT "kumiai_tasks_requirement_id_kumiai_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."kumiai_requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kumiai_tasks" ADD CONSTRAINT "kumiai_tasks_plan_id_kumiai_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."kumiai_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kumiai_recent_projects" ADD CONSTRAINT "kumiai_recent_projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kumiai_recent_projects" ADD CONSTRAINT "kumiai_recent_projects_project_id_kumiai_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."kumiai_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kumiai_goals_team_idx" ON "kumiai_goals" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "kumiai_projects_team_idx" ON "kumiai_projects" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "kumiai_projects_goal_idx" ON "kumiai_projects" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "kumiai_projects_status_idx" ON "kumiai_projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "kumiai_requirements_team_idx" ON "kumiai_requirements" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "kumiai_requirements_project_idx" ON "kumiai_requirements" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "kumiai_plans_team_idx" ON "kumiai_plans" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "kumiai_plans_requirement_idx" ON "kumiai_plans" USING btree ("requirement_id");--> statement-breakpoint
CREATE INDEX "kumiai_tasks_team_idx" ON "kumiai_tasks" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "kumiai_tasks_requirement_idx" ON "kumiai_tasks" USING btree ("requirement_id");--> statement-breakpoint
CREATE INDEX "kumiai_tasks_status_idx" ON "kumiai_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "kumiai_recent_projects_user_opened_idx" ON "kumiai_recent_projects" USING btree ("user_id","opened_at");