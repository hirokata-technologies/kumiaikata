import type { Redis } from "ioredis";
import { redis, createSubscriber } from "@kata/redis";
import type { BoardEvent } from "./types.js";

export interface BoardEventBus {
  emit(event: BoardEvent): void;
  /** Returns an unsubscribe function. The listener fires only for matching boardId. */
  subscribe(boardId: string, listener: (event: BoardEvent) => void): () => void;
}

class RedisEventBus implements BoardEventBus {
  constructor(private readonly pub: Redis) {}

  emit(event: BoardEvent): void {
    // fire-and-forget — SSE delivery is best-effort
    void this.pub.publish(event.boardId, JSON.stringify(event));
  }

  subscribe(boardId: string, listener: (event: BoardEvent) => void): () => void {
    const sub = createSubscriber();
    void sub.subscribe(boardId);
    sub.on("message", (_channel: string, message: string) => {
      try {
        listener(JSON.parse(message) as BoardEvent);
      } catch {
        // ignore malformed messages
      }
    });
    return () => {
      void sub.unsubscribe(boardId);
      sub.disconnect();
    };
  }
}

export const eventBus: BoardEventBus = new RedisEventBus(redis);
