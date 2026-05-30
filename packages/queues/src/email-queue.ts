import { Queue } from "bullmq";
import { Redis } from "ioredis";

export type EmailJobData = {
  to: string;
  subject: string;
  html: string;
};

const url = process.env.REDIS_URL ?? "";

export const emailQueue = new Queue<EmailJobData>("email", {
  connection: new Redis(url, { maxRetriesPerRequest: null }),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
  },
});
