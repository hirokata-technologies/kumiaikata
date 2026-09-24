import { Hono } from "hono";
import type { KumiaiVariables } from "../../auth/team-access.js";
import goalsRouter from "./goals.js";
import projectsRouter from "./projects.js";
import requirementsRouter from "./requirements.js";
import plansRouter from "./plans.js";
import tasksRouter from "./tasks.js";
import shellRouter from "./shell.js";

const r = new Hono<{ Variables: KumiaiVariables }>();

r.route("/goals", goalsRouter);
r.route("/projects", projectsRouter);
r.route("/requirements", requirementsRouter);
r.route("/plans", plansRouter);
r.route("/tasks", tasksRouter);
r.route("/", shellRouter);

export default r;
