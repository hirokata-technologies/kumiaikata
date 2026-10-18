import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { db } from "../db/client.js";
import { env } from "../env.js";
import { assertAllowedDomain } from "./domain-allowlist.js";
import {
	clearEmailSendFailure,
	failedVerificationEmailHook,
	markEmailSendFailed,
} from "./email-failure.js";
import { provisionUser } from "./provisioning.js";
import { MCP_RESOURCE } from "../mcp/resource.js";
import { sendEmail } from "../services/email.js";
import { passwordResetEmailHtml, verificationEmailHtml } from "../services/email-templates.js";

/**
 * OAuth 2.1 authorization server for the MCP endpoint. Users sign in on the normal
 * /login page, so tokens are only ever issued to existing (allow-listed) users.
 *
 * Typed as a plain plugin: the provider's endpoint types (OpenAPI literals with
 * `items?: undefined`) do not satisfy this package's `exactOptionalPropertyTypes`.
 * Runtime behaviour is unchanged; its endpoints are reached through `auth.handler`.
 */
const mcpPlugin: BetterAuthPlugin = mcp({
	loginPage: "/login",
	consentPage: "/consent",
	resource: MCP_RESOURCE,
	scopes: ["openid", "profile", "email", "offline_access"],
	// DCR fallback: CIMD (below) is the preferred registration method, but current
	// Claude Code clients may still register dynamically. Registration only
	// creates a client; it never creates or authenticates a user.
	allowDynamicClientRegistration: true,
	allowUnauthenticatedClientRegistration: true,
	// Claude Code registers a loopback `http://localhost:<port>/callback` without an
	// `application_type`; infer `native` for such clients instead of the OIDC `web` default.
	clientRegistrationDefaultApplicationType: "infer",
}) as unknown as BetterAuthPlugin;

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
		// Schema exports use plural names (users, sessions, accounts, verifications)
		// rather than Better Auth's default singular names (user, session, etc.).
		usePlural: true,
	}),
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,
	// The app and the API share one origin (BETTER_AUTH_URL), which Better Auth
	// trusts implicitly; ALLOWED_ORIGINS only adds extras such as a local dev server.
	trustedOrigins: env.ALLOWED_ORIGINS,
	// Session cookies are host-only: no crossSubDomainCookies, so they are never
	// sent to other *.hirokata.dev hosts.
	advanced: {
		ipAddress: {
			ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
		},
	},
	// OAuth and verification failures redirect to the login page (`?error=<code>`)
	// instead of Better Auth's built-in /api/auth/error page.
	onAPIError: {
		errorURL: "/login",
	},
	hooks: {
		after: failedVerificationEmailHook,
	},
	socialProviders: {
		google: {
			clientId: env.GOOGLE_CLIENT_ID,
			clientSecret: env.GOOGLE_CLIENT_SECRET,
		},
	},
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
		autoSignIn: false,
		minPasswordLength: 8,
		maxPasswordLength: 128,
		sendResetPassword: async ({ user, url }) => {
			try {
				await sendEmail({
					to: user.email,
					subject: "Reset your Kata password",
					html: passwordResetEmailHtml(url),
				});
			} catch (err) {
				console.error("[better-auth] sendResetPassword: failed to send email:", err instanceof Error ? err.message : String(err));
				throw new Error("We couldn't send the email, please try again.");
			}
		},
		revokeSessionsOnPasswordReset: true,
	},
	emailVerification: {
		sendVerificationEmail: async ({ user, url }) => {
			try {
				await sendEmail({
					to: user.email,
					subject: "Verify your Kata email address",
					html: verificationEmailHtml(url),
				});
				clearEmailSendFailure(user.email);
			} catch (err) {
				console.error("[better-auth] sendVerificationEmail: failed to send email:", err instanceof Error ? err.message : String(err));
				// Better Auth swallows errors thrown here; flag the address so the response fails.
				markEmailSendFailed(user.email);
			}
		},
		sendOnSignUp: true,
		autoSignInAfterVerification: false,
	},
	plugins: [
		// Signs the OAuth access tokens (JWT, verified against /api/auth/jwks). The model is
		// renamed so the plural table export is `jwks` (packages/db/src/schema/oauth.ts).
		jwt({ schema: { jwks: { modelName: "jwk" } } }),
		mcpPlugin,
		// Client ID Metadata Documents: an MCP client's client_id is an HTTPS URL to its
		// metadata, fetched with DNS pinning (public-routable addresses only).
		cimd({
			fetchClientMetadataResource,
			metadataProfile: "mcp-2026-07-28",
		}),
	],
	user: {
		additionalFields: {
			personalBoardId: { type: 'string', required: false },
			// `input: false` rejects client writes (sign-up and updateUser); the flag is only set by
			// POST /api/users/me/onboarding/complete.
			isOnboardingDone: { type: 'boolean', required: false, defaultValue: false, input: false },
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
