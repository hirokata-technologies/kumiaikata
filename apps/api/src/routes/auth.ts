import { Hono } from "hono";
import { auth } from "../auth/better-auth.js";

const r = new Hono();

// Mount all Better Auth endpoints (sign-in, sign-out, OAuth callbacks, etc.)
// under this router. The parent app mounts this router at `/api/auth`.
r.all("/*", (c) => auth.handler(c.req.raw));

export default r;
