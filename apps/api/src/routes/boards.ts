import { Hono } from "hono";
import { ok } from "../http/responders.js";
import { requireSession } from "../auth/middleware.js";
import { findBoardIdByType, getBoardWithColumnsAndCards } from "../services/boards.js";
import type { AppVariables } from "@kata/http";

const r = new Hono<{ Variables: AppVariables }>();
r.use("*", requireSession);

function parseColumnIds(raw: string | undefined): string[] | undefined {
	if (!raw) return undefined;
	const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
	return ids.length > 0 ? ids : undefined;
}

r.get("/personal", async (c) => {
	const boardId = await findBoardIdByType(c.get("user").id, "personal");
	const columnIds = parseColumnIds(c.req.query("column_ids"));
	return ok(c, await getBoardWithColumnsAndCards(boardId, { columnIds }));
});

r.get("/team", async (c) => {
	const boardId = await findBoardIdByType(c.get("user").id, "team");
	const columnIds = parseColumnIds(c.req.query("column_ids"));
	return ok(c, await getBoardWithColumnsAndCards(boardId, { columnIds }));
});

export default r;
