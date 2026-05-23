import type { Context } from "hono";

export const ok = (c: Context, body: unknown) => c.json(body, 200);

export const created = (c: Context, body: unknown) => c.json(body, 201);

export const noContent = (c: Context) => c.body(null, 204);
