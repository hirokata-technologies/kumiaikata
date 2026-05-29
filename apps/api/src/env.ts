import { z } from "zod";

const commaSeparated = z
	.string()
	.transform((s) =>
		s
			.split(",")
			.map((x) => x.trim())
			.filter(Boolean),
	);

const schema = z.object({
	PORT: z
		.string()
		.default("8787")
		.transform((s) => Number(s)),
	DATABASE_URL: z.string().url(),
	BETTER_AUTH_SECRET: z.string().min(1),
	BETTER_AUTH_URL: z.string().url(),
	GOOGLE_CLIENT_ID: z.string().min(1),
	GOOGLE_CLIENT_SECRET: z.string().min(1),
	RESEND_API_KEY: z.string().min(1),
	ALLOWED_DOMAINS: commaSeparated,
	ALLOWED_ORIGINS: commaSeparated,
	ATTACHMENTS_DIR: z.string().default("/data/attachments"),
	MAX_ATTACHMENT_BYTES: z
		.string()
		.default("26214400")
		.transform((s) => Number(s)),
	SENTRY_DSN: z.string().url().optional(),
	S3_ENDPOINT: z.string().url().optional(),
	S3_REGION: z.string().default("auto"),
	S3_BUCKET: z.string().optional(),
	S3_ACCESS_KEY_ID: z.string().optional(),
	S3_SECRET_ACCESS_KEY: z.string().optional(),
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

if (env.ALLOWED_DOMAINS.length === 0) {
	console.warn('[config] WARNING: ALLOWED_DOMAINS is empty — all sign-ins will be rejected.');
}
