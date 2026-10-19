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
	DATABASE_URL: z.string().url(),
	BETTER_AUTH_SECRET: z.string().min(1),
	BETTER_AUTH_URL: z.string().url(),
	GOOGLE_CLIENT_ID: z.string().min(1),
	GOOGLE_CLIENT_SECRET: z.string().min(1),
	RESEND_API_KEY: z.string().min(1),
	// Email domains allowed to sign in; "*" allows every domain.
	ALLOWED_DOMAINS: commaSeparated,
	// Extra origins Better Auth should trust besides BETTER_AUTH_URL (e.g. a local
	// dev server on another port). Optional: the app is served same-origin.
	ALLOWED_ORIGINS: commaSeparated.default([]),
	ATTACHMENTS_DIR: z.string().default("/data/attachments"),
	MAX_ATTACHMENT_BYTES: z
		.string()
		.default("26214400")
		.transform((s) => Number(s)),
	// Google Cloud Storage bucket for attachments (Application Default
	// Credentials). When unset, attachments are written to ATTACHMENTS_DIR.
	GCS_BUCKET: z
		.string()
		.optional()
		.transform((s) => (s ? s : undefined)),
	// Vertex AI Agent Runtime instance hosting the AI agents:
	// projects/{project}/locations/{location}/reasoningEngines/{id}. When unset the
	// /api/agents routes answer 503 "agents not configured".
	AGENT_RUNTIME_NAME: z
		.string()
		.regex(
			/^projects\/[^/]+\/locations\/[a-z0-9-]+\/reasoningEngines\/\d+$/,
			"must look like projects/{project}/locations/{location}/reasoningEngines/{id}",
		)
		.optional()
		.or(z.literal("").transform(() => undefined)),
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
