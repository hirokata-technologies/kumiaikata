import { Worker } from "bullmq";
import { Resend } from "resend";
import { Redis } from "ioredis";
import type { EmailJobData } from "./email-queue.js";

const url = process.env.REDIS_URL ?? "";

const FROM = "Kata <noreply@hirokata.dev>";

async function sendEmail(data: EmailJobData): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: FROM,
    to: data.to,
    subject: data.subject,
    html: data.html,
  });
}

export const emailWorker = new Worker<EmailJobData>(
  "email",
  (job) => sendEmail(job.data),
  { connection: new Redis(url, { maxRetriesPerRequest: null }) },
);
