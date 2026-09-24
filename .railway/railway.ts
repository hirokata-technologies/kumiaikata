// This file is the "kata" named partial. It declares only the five Railway
// resources this repo owns in the shared "hirokata.web" project — kata-api,
// kata-web, kata-relay-service, kata-db and Redis — plus their volumes and
// the live "Kata - Kanban Board" canvas group. It is a zero-drift
// transcription of what is already live in production, read via
// `railway config pull`.
//
// The other two services in the same Railway project (a portfolio repo's
// web app and its database) belong to a different canvas group and are
// never named here, not even to exclude them — `partial = "kata"` is what
// stops a future `railway config apply` from proposing to delete them.
//
// Every variable below is either a typed reference to another resource
// declared in this file, or `preserve()`. No literal or secret value is
// ever written here — see ADR adr-railway-iac-variables-preserve.
import { database, defineRailway, group, image, postgres, preserve, service, volume } from "railway/iac";

export const partial = "kata";

const REGION = "asia-southeast1-eqsg3a";

export default defineRailway((_ctx, project) => {
	const kataDb = postgres("kata-db", { region: REGION });

	const redisDb = database("Redis", "redis", {
		image: "redis:8.2.1",
		output: "REDIS_URL",
		defaultMountPath: "/data",
		region: REGION,
	});
	// database() only accepts image/output/defaultMountPath/region — the live
	// custom start command has to be added the way `railway config pull`
	// expresses it, after construction.
	redisDb.deploy = {
		...redisDb.deploy,
		startCommand:
			'/bin/sh -c "rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH"',
	};

	const postgresVolume = volume("postgres-volume", {
		region: REGION,
		sizeMB: 50000,
		allowOnlineResize: true,
		alerts: { usage: { "80": {}, "95": {}, "100": {} } },
	});
	kataDb.volumeAttachments = {
		[postgresVolume.name]: { volume: postgresVolume.address, mountPath: "/var/lib/postgresql/data" },
	};

	const redisVolume = volume("redis-volume", {
		region: REGION,
		sizeMB: 50000,
		allowOnlineResize: true,
		alerts: { usage: { "80": {}, "95": {}, "100": {} } },
	});
	redisDb.volumeAttachments = {
		[redisVolume.name]: { volume: redisVolume.address, mountPath: "/data" },
	};

	// Neither kata-api nor kata-relay-service declares startCommand or build
	// settings: the image CMD is the only start command — see ADR
	// adr-railway-iac-dockerfile-cmd-only.
	const kataApi = service("kata-api", {
		source: image("ghcr.io/hirogakatageri/kata-api:latest"),
		regions: { [REGION]: 1 },
		domains: [{ domain: "kata-api.hirokata.dev", port: 8787 }],
		env: {
			ALLOWED_DOMAINS: preserve(),
			ALLOWED_ORIGINS: preserve(),
			ATTACHMENTS_DIR: preserve(),
			BETTER_AUTH_SECRET: preserve(),
			BETTER_AUTH_URL: preserve(),
			DATABASE_URL: kataDb.env.DATABASE_URL,
			GOOGLE_CLIENT_ID: preserve(),
			GOOGLE_CLIENT_SECRET: preserve(),
			MAX_ATTACHMENT_BYTES: preserve(),
			NODE_ENV: preserve(),
			PORT: preserve(),
			REDIS_URL: redisDb.env.REDIS_URL,
			RESEND_API_KEY: preserve(),
			S3_ACCESS_KEY_ID: preserve(),
			S3_BUCKET: preserve(),
			S3_ENDPOINT: preserve(),
			S3_REGION: preserve(),
			S3_SECRET_ACCESS_KEY: preserve(),
			SENTRY_AUTH_TOKEN: preserve(),
			SENTRY_DSN: preserve(),
		},
	});

	const kataWeb = service("kata-web", {
		source: image("ghcr.io/hirogakatageri/kata-web:latest"),
		regions: { [REGION]: 1 },
		domains: [{ domain: "kata.hirokata.dev", port: 8080 }],
		env: {
			API_URL: preserve(),
			MINIMAX_API_KEY: preserve(),
			NODE_ENV: preserve(),
			PORT: preserve(),
			PUBLIC_API_URL: preserve(),
			PUBLIC_REALTIME_URL: preserve(),
			SENTRY_AUTH_TOKEN: preserve(),
			SENTRY_DSN: preserve(),
		},
	});

	const kataRelayService = service("kata-relay-service", {
		source: image("ghcr.io/hirogakatageri/kata-relay-service:latest"),
		regions: { [REGION]: 1 },
		// No custom domain — only the generated Railway domain, the way the
		// pull itself expresses it.
		networking: { serviceDomains: { "kata-relay-service-production.up.railway.app": {} } },
		env: {
			ALLOWED_DOMAINS: preserve(),
			ALLOWED_ORIGINS: preserve(),
			BETTER_AUTH_SECRET: preserve(),
			BETTER_AUTH_URL: preserve(),
			DATABASE_URL: kataDb.env.DATABASE_URL,
			NODE_ENV: preserve(),
			PORT: preserve(),
			REDIS_URL: redisDb.env.REDIS_URL,
			RESEND_API_KEY: preserve(),
			SENTRY_DSN: preserve(),
		},
	});

	return project("hirokata.web", {
		resources: [
			...group("Kata - Kanban Board", [kataApi, kataWeb, kataRelayService, kataDb, redisDb]),
			postgresVolume,
			redisVolume,
		],
	});
});
