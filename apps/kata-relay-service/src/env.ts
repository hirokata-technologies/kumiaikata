import { z } from "zod";

const commaSeparated = z
	.string()
	.transform((s) =>
		s.split(",").map((x) => x.trim()).filter(Boolean),
	);

const schema = z.object({
	PORT: z.string().default("8787").transform((s) => Number(s)),
	DATABASE_URL: z.string().url(),
	BETTER_AUTH_SECRET: z.string().min(1),
	BETTER_AUTH_URL: z.string().url(),
	ALLOWED_ORIGINS: commaSeparated,
	ALLOWED_DOMAINS: z.string().default(""),
	REDIS_URL: z.string().url(),
	RESEND_API_KEY: z.string().min(1),
	SENTRY_DSN: z.string().url().optional(),
});

function parseEnv(): z.infer<typeof schema> {
	const result = schema.safeParse(process.env);
	if (!result.success) {
		console.error("Invalid environment variables:");
		console.error(result.error.flatten().fieldErrors);
		process.exit(1);
	}
	return result.data;
}

export const env = parseEnv();
