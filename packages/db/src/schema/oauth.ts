import {
	pgTable,
	text,
	boolean,
	timestamp,
	integer,
	jsonb,
	index,
	uniqueIndex,
	foreignKey,
} from "drizzle-orm/pg-core";
import { users, sessions } from "./auth.js";

// Tables for the OAuth 2.1 authorization server behind the MCP endpoint:
// better-auth `jwt()` (signing keys) and `@better-auth/mcp` (= `@better-auth/oauth-provider`,
// plus `@better-auth/cimd`). Field sets mirror the plugins' schema definitions in
// better-auth 1.7.5. Export names are plural because the Drizzle adapter runs with
// `usePlural: true` (see apps/api/src/auth/better-auth.ts); the JWT plugin's `jwks`
// model is renamed to `jwk` there so its plural is `jwks`, not `jwkss`.

/** JWKS signing keys (better-auth `jwt()` plugin). Private keys are encrypted at rest by Better Auth. */
export const jwks = pgTable("jwks", {
	id: text("id").primaryKey(),
	publicKey: text("public_key").notNull(),
	privateKey: text("private_key").notNull(),
	createdAt: timestamp("created_at").notNull(),
	expiresAt: timestamp("expires_at"),
	alg: text("alg"),
	crv: text("crv"),
});

/** Registered OAuth clients (CIMD documents, dynamic registration, or admin-created). */
export const oauthClients = pgTable(
	"oauth_clients",
	{
		id: text("id").primaryKey(),
		clientId: text("client_id").notNull().unique(),
		clientSecret: text("client_secret"),
		clientDiscoveryId: text("client_discovery_id"),
		disabled: boolean("disabled").default(false),
		skipConsent: boolean("skip_consent"),
		enableEndSession: boolean("enable_end_session"),
		subjectType: text("subject_type"),
		scopes: text("scopes").array(),
		clientCredentialsScopes: text("client_credentials_scopes").array().default([]),
		userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at"),
		updatedAt: timestamp("updated_at"),
		name: text("name"),
		uri: text("uri"),
		icon: text("icon"),
		contacts: text("contacts").array(),
		tos: text("tos"),
		policy: text("policy"),
		softwareId: text("software_id"),
		softwareVersion: text("software_version"),
		softwareStatement: text("software_statement"),
		redirectUris: text("redirect_uris").array().notNull(),
		postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
		backchannelLogoutUri: text("backchannel_logout_uri"),
		backchannelLogoutSessionRequired: boolean("backchannel_logout_session_required"),
		tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
		applicationType: text("application_type"),
		jwks: text("jwks"),
		jwksUri: text("jwks_uri"),
		grantTypes: text("grant_types").array(),
		responseTypes: text("response_types").array(),
		requirePKCE: boolean("require_pkce"),
		dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
		referenceId: text("reference_id"),
		metadata: jsonb("metadata"),
	},
	(t) => [index("oauth_clients_user_idx").on(t.userId)],
);

/** Protected resources (the MCP endpoint is seeded here by the plugin). */
export const oauthResources = pgTable("oauth_resources", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull().unique(),
	name: text("name").notNull(),
	accessTokenTtl: integer("access_token_ttl"),
	refreshTokenTtl: integer("refresh_token_ttl"),
	signingAlgorithm: text("signing_algorithm"),
	signingKeyId: text("signing_key_id"),
	allowedScopes: text("allowed_scopes").array(),
	customClaims: jsonb("custom_claims"),
	dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required").default(false),
	disabled: boolean("disabled").default(false),
	createdAt: timestamp("created_at"),
	updatedAt: timestamp("updated_at"),
	policyVersion: integer("policy_version").default(1),
	metadata: jsonb("metadata"),
});

/** Which resources a client may request tokens for. */
export const oauthClientResources = pgTable(
	"oauth_client_resources",
	{
		id: text("id").primaryKey(),
		clientId: text("client_id")
			.notNull()
			.references(() => oauthClients.clientId, { onDelete: "cascade" }),
		resourceId: text("resource_id").notNull(),
		metadata: jsonb("metadata"),
		createdAt: timestamp("created_at"),
	},
	(t) => [
		// Named explicitly: the default name is 64 characters, over Postgres' 63 limit.
		foreignKey({
			name: "oauth_client_resources_resource_id_fk",
			columns: [t.resourceId],
			foreignColumns: [oauthResources.identifier],
		}).onDelete("cascade"),
		uniqueIndex("oauth_client_resources_client_resource_uniq").on(t.clientId, t.resourceId),
		index("oauth_client_resources_client_idx").on(t.clientId),
		index("oauth_client_resources_resource_idx").on(t.resourceId),
	],
);

export const oauthRefreshTokens = pgTable(
	"oauth_refresh_tokens",
	{
		id: text("id").primaryKey(),
		token: text("token").notNull().unique(),
		clientId: text("client_id")
			.notNull()
			.references(() => oauthClients.clientId, { onDelete: "cascade" }),
		sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		referenceId: text("reference_id"),
		authorizationCodeId: text("authorization_code_id"),
		resources: text("resources").array(),
		requestedUserInfoClaims: text("requested_user_info_claims").array(),
		expiresAt: timestamp("expires_at").notNull(),
		createdAt: timestamp("created_at").notNull(),
		revoked: timestamp("revoked"),
		rotatedAt: timestamp("rotated_at"),
		rotationReplayResponse: text("rotation_replay_response"),
		rotationReplayExpiresAt: timestamp("rotation_replay_expires_at"),
		authTime: timestamp("auth_time"),
		confirmation: jsonb("confirmation"),
		scopes: text("scopes").array().notNull(),
	},
	(t) => [
		index("oauth_refresh_tokens_client_idx").on(t.clientId),
		index("oauth_refresh_tokens_session_idx").on(t.sessionId),
		index("oauth_refresh_tokens_user_idx").on(t.userId),
		index("oauth_refresh_tokens_authorization_code_idx").on(t.authorizationCodeId),
	],
);

/**
 * Opaque access tokens. JWT access tokens (audience = the MCP resource) are
 * verified against the JWKS and are not stored here.
 */
export const oauthAccessTokens = pgTable(
	"oauth_access_tokens",
	{
		id: text("id").primaryKey(),
		token: text("token").notNull().unique(),
		clientId: text("client_id")
			.notNull()
			.references(() => oauthClients.clientId, { onDelete: "cascade" }),
		sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
		userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
		referenceId: text("reference_id"),
		authorizationCodeId: text("authorization_code_id"),
		resources: text("resources").array(),
		requestedUserInfoClaims: text("requested_user_info_claims").array(),
		refreshId: text("refresh_id").references(() => oauthRefreshTokens.id, { onDelete: "cascade" }),
		expiresAt: timestamp("expires_at").notNull(),
		createdAt: timestamp("created_at").notNull(),
		revoked: timestamp("revoked"),
		confirmation: jsonb("confirmation"),
		scopes: text("scopes").array().notNull(),
	},
	(t) => [
		index("oauth_access_tokens_client_idx").on(t.clientId),
		index("oauth_access_tokens_session_idx").on(t.sessionId),
		index("oauth_access_tokens_user_idx").on(t.userId),
		index("oauth_access_tokens_authorization_code_idx").on(t.authorizationCodeId),
		index("oauth_access_tokens_refresh_idx").on(t.refreshId),
	],
);

/** A user's remembered consent for a client and set of scopes. */
export const oauthConsents = pgTable(
	"oauth_consents",
	{
		id: text("id").primaryKey(),
		clientId: text("client_id")
			.notNull()
			.references(() => oauthClients.clientId, { onDelete: "cascade" }),
		userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
		referenceId: text("reference_id"),
		resources: text("resources").array(),
		requestedUserInfoClaims: text("requested_user_info_claims").array(),
		scopes: text("scopes").array().notNull(),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		index("oauth_consents_client_idx").on(t.clientId),
		index("oauth_consents_user_idx").on(t.userId),
	],
);

/** Replay protection for `private_key_jwt` client assertions (jti until expiry). */
export const oauthClientAssertions = pgTable("oauth_client_assertions", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expires_at").notNull(),
});
