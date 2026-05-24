import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import "../db/connection.js";
import { db } from "../db/connection.js";
import { env } from "../env.js";
import { assertAllowedDomain } from "./domain-allowlist.js";
import { provisionUser } from "./provisioning.js";

export const auth = betterAuth({
	database: mongodbAdapter(db),
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,
	trustedOrigins: env.ALLOWED_ORIGINS,
	advanced: {
		crossSubdomainCookies: {
			enabled: true,
			domain: ".hirokata.dev",
		},
		ipAddress: {
			ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
		},
	},
	socialProviders: {
		google: {
			clientId: env.GOOGLE_CLIENT_ID,
			clientSecret: env.GOOGLE_CLIENT_SECRET,
		},
	},
	user: {
		additionalFields: {
			personalBoardId: { type: 'string', required: false },
		},
	},
	databaseHooks: {
		user: {
			create: {
				/**
				 * Domain allow-list check: if the user's email domain is not permitted,
				 * returning `false` aborts account creation and no user is persisted.
				 */
				before: async (user) => {
					assertAllowedDomain(user.email as string);
				},
				/**
				 * Auto-provisioning: create the personal board, find-or-create the
				 * domain team and its board, and join the user as admin/member.
				 */
				after: async (user) => {
					await provisionUser({
						id: user.id as string,
						email: user.email as string,
						name: user.name as string | undefined,
					});
				},
			},
		},
	},
});
