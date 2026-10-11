import { Hono } from "hono";
import { logger } from "hono/logger";
import { pool } from "@kata/db";
import { errorHandler } from "@kata/http";
import authRouter from "./routes/auth.js";
import sseRouter from "./routes/sse.js";
import boardsRouter from "./routes/boards.js";
import teamsRouter from "./routes/teams.js";
import cardsRouter from "./routes/cards.js";
import columnsRouter from "./routes/columns.js";
import labelsRouter from "./routes/labels.js";
import projectsRouter from "./routes/projects.js";
import cardLabelsRouter from "./routes/card-labels.js";
import cardCommentsRouter from "./routes/card-comments.js";
import cardChecklistsRouter from "./routes/card-checklists.js";
import cardAssigneesRouter from "./routes/card-assignees.js";
import cardAttachmentsRouter from "./routes/card-attachments.js";
import attachmentsRouter from "./routes/attachments.js";
import usersRouter from "./routes/users.js";
import kumiaiRouter from "./routes/kumiai/index.js";
import agentsRouter from "./routes/agents.js";
// Mounted inside SvelteKit by apps/web (src/routes/api/[...path]/+server.ts), which
// forwards every /api/* request to `app.fetch`. Nothing here binds a port.
export const app = new Hono();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use("*", logger());

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/healthz", async (c) => {
	try {
		await pool.query("select 1");
		return c.json({ ok: true, db: true });
	} catch {
		return c.json({ ok: false, db: false }, 503);
	}
});

// ── API routers ───────────────────────────────────────────────────────────────
app.route("/api/auth", authRouter);
// SSE stream first so `/:boardId/events` is never shadowed by a catch-all below.
app.route("/api/boards", sseRouter);
app.route("/api/boards", boardsRouter);
app.route("/api/teams", teamsRouter);
app.route("/api/boards/:boardId/columns", columnsRouter);
app.route("/api/boards/:boardId/labels", labelsRouter);
app.route("/api/boards/:boardId/projects", projectsRouter);
app.route("/api/boards/:boardId/cards/:cardId/labels", cardLabelsRouter);
app.route("/api/boards/:boardId/cards/:cardId/comments", cardCommentsRouter);
app.route("/api/boards/:boardId/cards/:cardId/checklists", cardChecklistsRouter);
app.route("/api/boards/:boardId/cards/:cardId/assignees", cardAssigneesRouter);
app.route(
	"/api/boards/:boardId/cards/:cardId/attachments",
	cardAttachmentsRouter,
);
app.route("/api/attachments", attachmentsRouter);
app.route("/api/users", usersRouter);
app.route("/api/kumiai", kumiaiRouter);
app.route("/api/agents", agentsRouter);
app.route("/api/boards/:boardId", cardsRouter);

// ── Central error handler (registered last so it catches everything) ──────────
app.onError(errorHandler);

export default app;
