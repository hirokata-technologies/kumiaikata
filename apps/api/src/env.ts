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
	MONGODB_URI: z.string().min(1),
	BETTER_AUTH_SECRET: z.string().min(1),
	BETTER_AUTH_URL: z.string().url(),
	GOOGLE_CLIENT_ID: z.string().min(1),
	GOOGLE_CLIENT_SECRET: z.string().min(1),
	ALLOWED_DOMAINS: commaSeparated,
	ALLOWED_ORIGINS: commaSeparated,
	ATTACHMENTS_DIR: z.string().default("/data/attachments"),
	MAX_ATTACHMENT_BYTES: z
		.string()
		.default("26214400")
		.transform((s) => Number(s)),
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
