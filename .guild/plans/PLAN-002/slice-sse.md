---
plan: PLAN-002
slice: sse
title: "Server-Sent Events endpoint for real-time board updates"
complexity: 2
---

# SSE real-time endpoint

## Goal

Implement `GET /api/boards/:boardId/events` as a Server-Sent Events stream. On connect, the server validates the session and board access, subscribes to the in-process event bus for that board, and streams every matching `BoardEvent` as an SSE message until the client disconnects or the session expires.

## Files to Create / Modify

- `apps/api/src/routes/sse.ts` — create.
- `apps/api/src/app.ts` — modify. Mount under `/api/boards`.

## Implementation Steps

### Route

```ts
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { requireSession, loadBoardAccess } from '../auth/middleware';
import { eventBus } from '../events/bus';
import { auth } from '../auth/better-auth';

const r = new Hono();

r.get('/:boardId/events',
  requireSession,
  loadBoardAccess,
  async (c) => {
    const boardId = String(c.get('board')._id);
    return streamSSE(c, async (stream) => {
      const queue: string[] = [];
      let resolveNext: (() => void) | null = null;

      const unsubscribe = eventBus.subscribe(boardId, (event) => {
        queue.push(JSON.stringify(event.payload));
        // tag the message with the event type
        queue.push(event.type);
        resolveNext?.();
        resolveNext = null;
      });

      // Heartbeat every 15s so proxies don't drop the connection.
      const heartbeat = setInterval(() => {
        stream.writeSSE({ event: 'ping', data: '' }).catch(() => {});
      }, 15_000);

      // Session expiry watchdog: re-check session every 60s.
      const sessionWatch = setInterval(async () => {
        const s = await auth.api.getSession({ headers: c.req.raw.headers });
        if (!s) {
          await stream.writeSSE({ event: 'error', data: JSON.stringify({ code: 'UNAUTHENTICATED' }) });
          stream.close();
        }
      }, 60_000);

      stream.onAbort(() => {
        unsubscribe();
        clearInterval(heartbeat);
        clearInterval(sessionWatch);
      });

      try {
        while (true) {
          while (queue.length >= 2) {
            const data = queue.shift()!;
            const type = queue.shift()!;
            await stream.writeSSE({ event: type, data });
          }
          await new Promise<void>((resolve) => { resolveNext = resolve; });
        }
      } finally {
        unsubscribe();
        clearInterval(heartbeat);
        clearInterval(sessionWatch);
      }
    });
  }
);

export default r;
```

Notes on the implementation:

- The `queue + resolveNext` pattern bridges the EventEmitter (synchronous callback) to the async streaming loop without losing events between iterations.
- Events are forwarded with `event:` set to the `BoardEvent.type` (e.g. `card.moved`) and `data:` set to the JSON-stringified payload — clients can subscribe per event type with `EventSource.addEventListener('card.moved', ...)`.
- Heartbeat keeps connections alive through proxies / Cloudflare / Railway's edge.
- Session watchdog satisfies US-13 #3 — when the session expires, we emit a final `error` event and close the stream. The client treats this as a signal to re-authenticate.
- `stream.onAbort` covers client disconnect (US-13 #4).

### Mounting

`app.ts`:

```ts
app.route('/api/boards', sseRouter);
```

Order matters relative to other `/api/boards`-rooted routers (boards, columns, cards). Mount `sseRouter` LAST so the more specific routes match first. Hono's matcher is first-match-wins for same-prefix routers.

Actually safer: give each router a non-conflicting subpath where possible. SSE uses `/:boardId/events`, columns use `/:boardId/columns`, etc. These do not collide. Order is not critical, but document it.

### CORS

SSE requires `Access-Control-Allow-Origin` to include the frontend origin and `Access-Control-Allow-Credentials: true` so cookies flow. The CORS middleware configured in scaffolding already enforces this via `env.ALLOWED_ORIGINS`; verify it does not strip `text/event-stream`.

## Interface Contract

Exposed:

- Route `GET /api/boards/:boardId/events` (no other slice depends on this in code).

Consumes:

- `requireSession`, `loadBoardAccess`, `auth` from auth slice.
- `eventBus` from primitives.

This slice emits no events; it only forwards them.

## Acceptance Criteria

- [ ] Connecting to `/api/boards/:boardId/events` with `Accept: text/event-stream` returns 200 with `Content-Type: text/event-stream`.
- [ ] Without a valid session, returns 401 before upgrading.
- [ ] Without board access, returns 403 before upgrading.
- [ ] Non-existent board returns 404 before upgrading.
- [ ] When another client performs a mutation on the same board (e.g. creates a card via the cards slice), the SSE client receives a message with `event: card.created` and `data: <JSON>`.
- [ ] Heartbeats are emitted at least once every 30s.
- [ ] When the client disconnects (tab close), the subscription is removed (verify with `eventBus.subscribe` callback count or by sending more events and confirming the closed client no longer affects others).
- [ ] When the session expires, the server emits an `event: error` SSE message and closes the stream.
- [ ] Multiple clients on the same board each receive the same event.
- [ ] An event on board A is not delivered to a client subscribed to board B.
