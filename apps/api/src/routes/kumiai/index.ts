import { Hono } from "hono";
import type { KumiaiVariables } from "../../auth/team-access.js";
import workspacesRouter from "./workspaces.js";
import goalsRouter from "./goals.js";
import projectsRouter from "./projects.js";
import requirementsRouter from "./requirements.js";
import plansRouter from "./plans.js";
import tasksRouter from "./tasks.js";
import shellRouter from "./shell.js";
import guildRouter from "./guild.js";

const r = new Hono<{ Variables: KumiaiVariables }>();

r.route("/workspaces", workspacesRouter);
r.route("/goals", goalsRouter);
r.route("/projects", projectsRouter);
r.route("/requirements", requirementsRouter);
r.route("/plans", plansRouter);
r.route("/tasks", tasksRouter);
// Before the shell router: its catch-all session middleware would refuse Bearer callers.
r.route("/guild", guildRouter);
r.route("/", shellRouter);

export default r;
