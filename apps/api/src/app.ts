import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { env } from "./env.js";
import { getDb } from "./db/connection.js";
import { errorHandler } from "./http/error.js";
import authRouter from "./routes/auth.js";
import boardsRouter from "./routes/boards.js";
import teamsRouter from "./routes/teams.js";
import cardsRouter from "./routes/cards.js";
import columnsRouter from "./routes/columns.js";
import labelsRouter from "./routes/labels.js";
import cardLabelsRouter from "./routes/card-labels.js";
import cardCommentsRouter from "./routes/card-comments.js";
import cardChecklistsRouter from "./routes/card-checklists.js";
import cardAssigneesRouter from "./routes/card-assignees.js";
import cardAttachmentsRouter from "./routes/card-attachments.js";
import attachmentsRouter from "./routes/attachments.js";
import sseRouter from "./routes/sse.js";

export const app = new Hono();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use("*", logger());
app.use(
	"*",
	cors({
		origin: env.ALLOWED_ORIGINS,
		credentials: true,
	}),
);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/healthz", async (c) => {
	try {
		await getDb().command({ ping: 1 });
		return c.json({ ok: true, db: true });
	} catch {
		return c.json({ ok: false, db: false }, 503);
	}
});

// ── API routers ───────────────────────────────────────────────────────────────
app.route("/api/auth", authRouter);
app.route("/api/boards", boardsRouter);
app.route("/api/teams", teamsRouter);
app.route("/api/boards/:boardId/columns", columnsRouter);
app.route("/api/boards/:boardId/labels", labelsRouter);
app.route("/api/boards/:boardId/cards/:cardId/labels", cardLabelsRouter);
app.route("/api/boards/:boardId/cards/:cardId/comments", cardCommentsRouter);
app.route("/api/boards/:boardId/cards/:cardId/checklists", cardChecklistsRouter);
app.route("/api/boards/:boardId/cards/:cardId/assignees", cardAssigneesRouter);
app.route(
	"/api/boards/:boardId/cards/:cardId/attachments",
	cardAttachmentsRouter,
);
app.route("/api/attachments", attachmentsRouter);
app.route("/api/boards/:boardId", cardsRouter);
// SSE router mounted last — /:boardId/events does not conflict with other subpaths
app.route("/api/boards", sseRouter);

// ── Central error handler (registered last so it catches everything) ──────────
app.onError(errorHandler);

export default app;
