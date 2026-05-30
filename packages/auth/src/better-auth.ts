import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@kata/db";
import { emailQueue } from "@kata/queues";
import { assertAllowedDomain } from "./domain-allowlist.js";
import { provisionUser } from "./provisioning.js";

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
		// Schema exports use plural names (users, sessions, accounts, verifications)
		// rather than Better Auth's default singular names (user, session, etc.).
		usePlural: true,
	}),
	secret: process.env.BETTER_AUTH_SECRET,
	baseURL: process.env.BETTER_AUTH_URL,
	trustedOrigins: process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [],
	advanced: {
		crossSubDomainCookies: {
			enabled: true,
			domain: "hirokata.dev",
		},
		ipAddress: {
			ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
		},
	},
	socialProviders: {
		google: {
			clientId: process.env.GOOGLE_CLIENT_ID ?? "",
			clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
		},
	},
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
		autoSignIn: false,
		minPasswordLength: 8,
		maxPasswordLength: 128,
		sendResetPassword: async ({ user, url }) => {
			await emailQueue.add("send", {
				to: user.email,
				subject: "Reset your Kata password",
				html: `<p>Click <a href="${url}">here</a> to reset your password.</p><p>This link expires in 1 hour.</p><p>If you did not request this, you can safely ignore this email.</p>`,
			});
		},
		revokeSessionsOnPasswordReset: true,
	},
	emailVerification: {
		sendVerificationEmail: async ({ user, url }) => {
			await emailQueue.add("send", {
				to: user.email,
				subject: "Verify your Kata email address",
				html: `<p>Click <a href="${url}">here</a> to verify your email address.</p><p>If you did not create an account, you can safely ignore this email.</p>`,
			});
		},
		sendOnSignUp: true,
		autoSignInAfterVerification: false,
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
