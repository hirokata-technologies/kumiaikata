import { Redis } from "ioredis";

const url = process.env.REDIS_URL;
if (!url) throw new Error("[kata/redis] REDIS_URL is not set");

// General-purpose connection — used for publishing events and as BullMQ Queue connection.
export const redis = new Redis(url);

// BullMQ workers require maxRetriesPerRequest: null.
export const bullMQConnection = new Redis(url, { maxRetriesPerRequest: null });

// Each SSE subscriber needs a dedicated connection (a subscribed ioredis connection
// can only subscribe — it cannot publish or run regular commands).
export function createSubscriber(): Redis {
  return new Redis(url as string);
}
