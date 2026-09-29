import { describe, expect, it } from "vitest";
import type { DatabaseNode, ResourceNode, ServiceNode, VariableValue, VolumeNode } from "railway/iac";
import {
	assertConsistentGroupMembership,
	assertDomainsWithinPolicy,
	assertExactResourceNames,
	assertHealthcheckAndRestartPolicy,
	assertImageTags,
	assertNoCredentialShapedStrings,
	assertNoLiteralOrRawVariables,
	assertNoPortfolioReferences,
	assertPartialIsKata,
	assertVolumeAttachments,
	flattenResources,
} from "./guards.js";

const ref = (resource: string, output: string): VariableValue => ({
	type: "reference",
	resource: resource as `${string}.${string}`,
	output,
});
const preserved: VariableValue = { type: "preserve" };

function service(overrides: Partial<ServiceNode> & { name: string }): ServiceNode {
	return {
		address: `service.${overrides.name}`,
		type: "service",
		kind: "docker-image",
		groupId: "kata",
		source: { type: "image", image: `ghcr.io/hirogakatageri/${overrides.name}:latest` },
		variables: {},
		...overrides,
	} as ServiceNode;
}

function database(overrides: Partial<DatabaseNode> & { name: string; engine: DatabaseNode["engine"]; image: string }): DatabaseNode {
	return {
		address: `database.${overrides.name}`,
		type: "database",
		kind: "database",
		groupId: "kata",
		output: "DATABASE_URL",
		variables: {},
		...overrides,
	} as DatabaseNode;
}

function volume(name: string): VolumeNode {
	return { address: `volume.${name}`, type: "volume", name };
}

function cleanFixture(): ResourceNode[] {
	return [
		service({
			name: "kata-api",
			source: { type: "image", image: "ghcr.io/hirogakatageri/kata-api:latest" },
			networking: { customDomains: { "kata-api.hirokata.dev": { port: 8787 } } },
			variables: { DATABASE_URL: ref("database.kata-db", "DATABASE_URL"), REDIS_URL: ref("database.Redis", "REDIS_URL"), NODE_ENV: preserved },
		}),
		service({
			name: "kata-web",
			source: { type: "image", image: "ghcr.io/hirogakatageri/kata-web:latest" },
			networking: { customDomains: { "kata.hirokata.dev": { port: 8080 } } },
			variables: { NODE_ENV: preserved },
		}),
		service({
			name: "kata-relay-service",
			source: { type: "image", image: "ghcr.io/hirogakatageri/kata-relay-service:latest" },
			networking: { serviceDomains: { "kata-relay-service-production.up.railway.app": {} } },
			variables: { DATABASE_URL: ref("database.kata-db", "DATABASE_URL") },
		}),
		database({
			name: "kata-db",
			engine: "postgres",
			image: "ghcr.io/railwayapp-templates/postgres-ssl:18",
			volumeAttachments: {
				"postgres-volume": { volume: "volume.postgres-volume", mountPath: "/var/lib/postgresql/data" },
			},
		}),
		database({
			name: "Redis",
			engine: "redis",
			image: "redis:8.2.1",
			volumeAttachments: { "redis-volume": { volume: "volume.redis-volume", mountPath: "/data" } },
		}),
		{ address: "group.kata", type: "group", name: "kata" },
		volume("postgres-volume"),
		volume("redis-volume"),
	];
}

describe("flattenResources", () => {
	it("returns a flat array unchanged", () => {
		const flat = [service({ name: "kata-api" }), volume("v")];
		expect(flattenResources(flat)).toEqual(flat);
	});

	it("flattens one nested array (as group() produces), preserving every resource", () => {
		const a = service({ name: "kata-api" });
		const b = service({ name: "kata-web" });
		const c = volume("postgres-volume");
		const nested = [[a, b], c];
		expect(flattenResources(nested)).toEqual([a, b, c]);
	});

	it("returns an empty list for an empty resources array", () => {
		expect(flattenResources([])).toEqual([]);
	});

	it("returns a single service unchanged", () => {
		const svc = service({ name: "kata-api" });
		expect(flattenResources([svc])).toEqual([svc]);
	});

	it("returns a single volume unchanged", () => {
		const vol = volume("postgres-volume");
		expect(flattenResources([vol])).toEqual([vol]);
	});
});

describe("assertPartialIsKata", () => {
	it('passes for "kata"', () => {
		expect(() => assertPartialIsKata("kata")).not.toThrow();
	});

	it.each([undefined, "", "Kata", "kata-partial"])("throws for %j", (bad) => {
		expect(() => assertPartialIsKata(bad)).toThrow();
	});
});

describe("assertExactResourceNames", () => {
	it("passes for exactly the five kata resources (volumes/group present but not counted)", () => {
		expect(() => assertExactResourceNames(cleanFixture())).not.toThrow();
	});

	it("throws when one of the five is missing", () => {
		const resources = cleanFixture().filter((r) => r.name !== "kata-web");
		expect(() => assertExactResourceNames(resources)).toThrow();
	});

	it("throws when a sixth name is present", () => {
		const resources = [...cleanFixture(), service({ name: "hirokata-web" })];
		expect(() => assertExactResourceNames(resources)).toThrow();
	});

	it("throws when a bucket resource is present anywhere", () => {
		const resources: ResourceNode[] = [...cleanFixture(), { address: "bucket.attachments", type: "bucket", name: "attachments" }];
		expect(() => assertExactResourceNames(resources)).toThrow();
	});

	it("throws when two group nodes are present", () => {
		const resources: ResourceNode[] = [...cleanFixture(), { address: "group.kata2", type: "group", name: "kata2" }];
		expect(() => assertExactResourceNames(resources)).toThrow();
	});
});

describe("assertNoPortfolioReferences", () => {
	it("passes for a clean fixture and clean source text", () => {
		expect(() => assertNoPortfolioReferences(cleanFixture(), "// no portfolio mentions here")).not.toThrow();
	});

	it("throws when the source text contains the literal string hirokata-web", () => {
		const source = "// TODO: revisit hirokata-web later";
		expect(() => assertNoPortfolioReferences(cleanFixture(), source)).toThrow();
	});

	it("throws when a resource's serialized JSON contains hirokata-web-db in an unexpected field", () => {
		const resources = cleanFixture();
		(resources[0] as ServiceNode).variables = { STRAY: { type: "sharedReference", name: "hirokata-web-db" } };
		expect(() => assertNoPortfolioReferences(resources, "// clean")).toThrow();
	});
});

describe("assertConsistentGroupMembership", () => {
	it.each(["kata", "Kata - Kanban Board"])('passes when all five share one non-empty groupId ("%s")', (groupName) => {
		const resources = cleanFixture().map((r) => (r.type === "service" || r.type === "database" ? { ...r, groupId: groupName } : r));
		expect(() => assertConsistentGroupMembership(resources)).not.toThrow();
	});

	it("throws when one of the five is missing groupId or differs from the other four", () => {
		const resources = cleanFixture().map((r) => (r.name === "kata-web" ? { ...r, groupId: "different-group" } : r));
		expect(() => assertConsistentGroupMembership(resources)).toThrow();
	});

	it("does not throw when a resource outside the five (a volume) has no groupId", () => {
		const resources = cleanFixture();
		expect(resources.some((r) => r.type === "volume" && "groupId" in r === false)).toBe(true);
		expect(() => assertConsistentGroupMembership(resources)).not.toThrow();
	});
});

describe("assertNoLiteralOrRawVariables", () => {
	it("passes when every variable is reference/sharedReference/preserve", () => {
		expect(() => assertNoLiteralOrRawVariables(cleanFixture())).not.toThrow();
	});

	it('throws when a variable has type "literal" anywhere', () => {
		const resources = cleanFixture();
		(resources[1] as ServiceNode).variables = { SECRET: { type: "literal", value: "hardcoded" } };
		expect(() => assertNoLiteralOrRawVariables(resources)).toThrow();
	});

	it('throws when a variable has type "raw" anywhere', () => {
		const resources = cleanFixture();
		(resources[1] as ServiceNode).variables = { SECRET: { type: "raw", value: { value: "hardcoded" } } };
		expect(() => assertNoLiteralOrRawVariables(resources)).toThrow();
	});
});

describe("assertDomainsWithinPolicy", () => {
	it("passes for the clean fixture (kata-relay-service has no custom domain)", () => {
		expect(() => assertDomainsWithinPolicy(cleanFixture())).not.toThrow();
	});

	it("throws when a custom domain does not end in .hirokata.dev", () => {
		const resources = cleanFixture();
		(resources[0] as ServiceNode).networking = { customDomains: { "kata-api.example.com": { port: 8787 } } };
		expect(() => assertDomainsWithinPolicy(resources)).toThrow();
	});

	it("throws when kata-api's custom domain is on a port other than 8787", () => {
		const resources = cleanFixture();
		(resources[0] as ServiceNode).networking = { customDomains: { "kata-api.hirokata.dev": { port: 9999 } } };
		expect(() => assertDomainsWithinPolicy(resources)).toThrow();
	});

	it("throws when kata-web's custom domain is on a port other than 8080", () => {
		const resources = cleanFixture();
		(resources[1] as ServiceNode).networking = { customDomains: { "kata.hirokata.dev": { port: 1234 } } };
		expect(() => assertDomainsWithinPolicy(resources)).toThrow();
	});

	it("throws when kata-relay-service carries any customDomains entry", () => {
		const resources = cleanFixture();
		(resources[2] as ServiceNode).networking = { customDomains: { "relay.hirokata.dev": { port: 443 } } };
		expect(() => assertDomainsWithinPolicy(resources)).toThrow();
	});
});

describe("assertImageTags", () => {
	it("passes for the five live tags exactly", () => {
		expect(() => assertImageTags(cleanFixture())).not.toThrow();
	});

	it("throws when any one tag differs", () => {
		const resources = cleanFixture();
		(resources[0] as ServiceNode).source = { type: "image", image: "ghcr.io/hirogakatageri/kata-api:v2" };
		expect(() => assertImageTags(resources)).toThrow();
	});

	it("throws when the Postgres image is normalized to :latest instead of the pinned :18", () => {
		const resources = cleanFixture();
		(resources[3] as DatabaseNode).image = "ghcr.io/railwayapp-templates/postgres-ssl:latest";
		expect(() => assertImageTags(resources)).toThrow();
	});

	it("throws when the Redis image is normalized to :latest instead of the pinned :8.2.1", () => {
		const resources = cleanFixture();
		(resources[4] as DatabaseNode).image = "redis:latest";
		expect(() => assertImageTags(resources)).toThrow();
	});
});

describe("assertNoCredentialShapedStrings", () => {
	const CLEAN_SOURCE = `
		import { preserve } from "railway/iac";
		export const partial = "kata";
		const url = kataDb.env.DATABASE_URL;
		const redisUrl = redisDb.env.REDIS_URL;
		const allowed = preserve();
	`;

	it("passes for clean source text", () => {
		expect(() => assertNoCredentialShapedStrings(CLEAN_SOURCE)).not.toThrow();
	});

	it("throws for a postgres:// URL with embedded credentials", () => {
		expect(() => assertNoCredentialShapedStrings('const x = "postgres://user:pass@host:5432/db";')).toThrow();
	});

	it("throws for a redis:// URL", () => {
		expect(() => assertNoCredentialShapedStrings('const x = "redis://default:pw@host:6379";')).toThrow();
	});

	it("throws for a password=/secret= literal", () => {
		expect(() => assertNoCredentialShapedStrings("password=hunter2")).toThrow();
		expect(() => assertNoCredentialShapedStrings("secret=abc123")).toThrow();
	});

	it("throws for a 32+ char hex token or a 40+ char base64-looking token", () => {
		expect(() => assertNoCredentialShapedStrings("const t = \"a1b2c3d4e5f60718293a4b5c6d7e8f90\";")).toThrow();
		expect(() =>
			assertNoCredentialShapedStrings('const t = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVoxMjM0NTY3ODk=";'),
		).toThrow();
	});
});

describe("assertVolumeAttachments", () => {
	it("passes when postgres-volume -> kata-db and redis-volume -> Redis at the expected mount paths", () => {
		expect(() => assertVolumeAttachments(cleanFixture())).not.toThrow();
	});

	it("throws when a declared volume is attached to nothing (orphaned)", () => {
		const resources = cleanFixture().map((r) =>
			r.type === "database" && r.name === "kata-db" ? { ...r, volumeAttachments: {} } : r,
		);
		expect(() => assertVolumeAttachments(resources)).toThrow(/orphaned/);
	});

	it("throws when a volume is attached to the wrong service", () => {
		const resources = cleanFixture().map((r) => {
			if (r.type === "database" && r.name === "kata-db") return { ...r, volumeAttachments: {} };
			if (r.type === "database" && r.name === "Redis") {
				return {
					...r,
					volumeAttachments: {
						"postgres-volume": { volume: "volume.postgres-volume", mountPath: "/var/lib/postgresql/data" },
						"redis-volume": { volume: "volume.redis-volume", mountPath: "/data" },
					},
				};
			}
			return r;
		});
		expect(() => assertVolumeAttachments(resources)).toThrow(/expected to attach to "kata-db"/);
	});

	it("throws when a volume is attached at the wrong mount path", () => {
		const resources = cleanFixture().map((r) =>
			r.type === "database" && r.name === "Redis"
				? { ...r, volumeAttachments: { "redis-volume": { volume: "volume.redis-volume", mountPath: "/wrong/path" } } }
				: r,
		);
		expect(() => assertVolumeAttachments(resources)).toThrow(/mountPath/);
	});

	it("throws when a volume is attached to more than one service", () => {
		const resources = cleanFixture().map((r) =>
			r.type === "database" && r.name === "Redis"
				? {
						...r,
						volumeAttachments: {
							"redis-volume": { volume: "volume.redis-volume", mountPath: "/data" },
							"postgres-volume": { volume: "volume.postgres-volume", mountPath: "/var/lib/postgresql/data" },
						},
					}
				: r,
		);
		expect(() => assertVolumeAttachments(resources)).toThrow(/more than one service/);
	});
});

describe("assertHealthcheckAndRestartPolicy", () => {
	/**
	 * cleanFixture() does not itself declare the four migrated fields — this
	 * layers them onto kata-api and kata-relay-service the way TASK-051 did,
	 * matching cleanFixture()'s existing pattern for building a positive
	 * control.
	 */
	function withHealthcheckAndRestartPolicy(): ResourceNode[] {
		return cleanFixture().map((r) => {
			if (r.type === "service" && (r.name === "kata-api" || r.name === "kata-relay-service")) {
				return {
					...r,
					deploy: {
						healthcheckPath: "/healthz",
						healthcheckTimeout: 30,
						restartPolicyType: "ON_FAILURE",
						restartPolicyMaxRetries: 5,
					},
				};
			}
			return r;
		});
	}

	it("passes when kata-api and kata-relay-service each declare the four migrated fields and nobody else does", () => {
		expect(() => assertHealthcheckAndRestartPolicy(withHealthcheckAndRestartPolicy())).not.toThrow();
	});

	it("throws when kata-api is missing deploy.healthcheckPath, naming the resource and field", () => {
		const resources = withHealthcheckAndRestartPolicy().map((r) => {
			if (r.type === "service" && r.name === "kata-api") {
				const { healthcheckPath: _healthcheckPath, ...rest } = r.deploy as Record<string, unknown>;
				return { ...r, deploy: rest };
			}
			return r;
		});
		expect(() => assertHealthcheckAndRestartPolicy(resources)).toThrow(/kata-api.*healthcheckPath/);
	});

	it("throws when kata-api's deploy.healthcheckTimeout is a wrong number", () => {
		const resources = withHealthcheckAndRestartPolicy().map((r) =>
			r.type === "service" && r.name === "kata-api" ? { ...r, deploy: { ...(r.deploy as object), healthcheckTimeout: 60 } } : r,
		);
		expect(() => assertHealthcheckAndRestartPolicy(resources)).toThrow(/kata-api.*healthcheckTimeout/);
	});

	it('throws when kata-relay-service\'s deploy.restartPolicyType is "ALWAYS" instead of "ON_FAILURE"', () => {
		const resources = withHealthcheckAndRestartPolicy().map((r) =>
			r.type === "service" && r.name === "kata-relay-service"
				? { ...r, deploy: { ...(r.deploy as object), restartPolicyType: "ALWAYS" } }
				: r,
		);
		expect(() => assertHealthcheckAndRestartPolicy(resources)).toThrow(/kata-relay-service.*restartPolicyType/);
	});

	it.each(["kata-web", "kata-db", "Redis"])(
		'throws when "%s" carries a healthcheck/restart-policy field it must not have',
		(name) => {
			const resources = withHealthcheckAndRestartPolicy().map((r) =>
				r.name === name ? { ...r, deploy: { healthcheckPath: "/healthz" } } : r,
			);
			expect(() => assertHealthcheckAndRestartPolicy(resources)).toThrow(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		},
	);

	it.each(["kata-api", "kata-relay-service"])('throws when "%s" carries a startCommand', (name) => {
		const resources = withHealthcheckAndRestartPolicy().map((r) =>
			r.name === name ? { ...r, deploy: { ...(r as ServiceNode).deploy, startCommand: "node server.js" } } : r,
		);
		expect(() => assertHealthcheckAndRestartPolicy(resources)).toThrow(/startCommand/);
	});

	it.each(["kata-api", "kata-relay-service"])('throws when "%s" carries a build block', (name) => {
		const resources = withHealthcheckAndRestartPolicy().map((r) =>
			r.name === name ? { ...r, build: { builder: "DOCKERFILE" } } : r,
		);
		expect(() => assertHealthcheckAndRestartPolicy(resources)).toThrow(/build/);
	});

	it("throws when any resource carries a configFile field", () => {
		const resources = withHealthcheckAndRestartPolicy().map((r) => (r.name === "kata-web" ? { ...r, configFile: "legacy-config.json" } : r));
		expect(() => assertHealthcheckAndRestartPolicy(resources)).toThrow(/configFile/);
	});
});

// --- Self-check: the guards must actually discriminate a broken fixture ---
// ("a safety test that cannot fail is not a safety test"). This is a
// deliberately synthetic, six-resource, portfolio-tainted fixture — no real
// file is involved.
describe("guards vs. a deliberately-broken fixture", () => {
	function brokenFixture(): ResourceNode[] {
		return [
			...cleanFixture(),
			service({
				name: "hirokata-web",
				source: { type: "image", image: "ghcr.io/hirogakatageri/hirokata-web:latest" },
			}),
		];
	}
	const BROKEN_SOURCE = "// leftover reference: hirokata-web";

	it("assertNoPortfolioReferences throws on the broken fixture and its source text", () => {
		expect(() => assertNoPortfolioReferences(brokenFixture(), BROKEN_SOURCE)).toThrow();
	});

	it("assertNoLiteralOrRawVariables throws when one variable is set to a literal", () => {
		const resources = brokenFixture();
		(resources[0] as ServiceNode).variables = { LEAKED: { type: "literal", value: "super-secret" } };
		expect(() => assertNoLiteralOrRawVariables(resources)).toThrow();
	});

	it("assertExactResourceNames throws on the broken fixture's six-name resource set", () => {
		expect(() => assertExactResourceNames(brokenFixture())).toThrow();
	});

	it("assertDomainsWithinPolicy throws when a resource has a domain outside the policy", () => {
		const resources = brokenFixture();
		const rogue = resources.find((r) => r.name === "hirokata-web") as ServiceNode;
		rogue.networking = { customDomains: { "foo.example.com": { port: 3000 } } };
		expect(() => assertDomainsWithinPolicy(resources)).toThrow();
	});

	it("assertVolumeAttachments throws when the fixture's postgres-volume is left unattached (missing attachment)", () => {
		const resources = brokenFixture().map((r) =>
			r.type === "database" && r.name === "kata-db" ? { ...r, volumeAttachments: {} } : r,
		);
		expect(() => assertVolumeAttachments(resources)).toThrow(/orphaned/);
	});

	it("assertVolumeAttachments throws when the fixture's redis-volume is attached at the wrong mount path (wrong attachment)", () => {
		const resources = brokenFixture().map((r) =>
			r.type === "database" && r.name === "Redis"
				? { ...r, volumeAttachments: { "redis-volume": { volume: "volume.redis-volume", mountPath: "/tmp/wrong" } } }
				: r,
		);
		expect(() => assertVolumeAttachments(resources)).toThrow(/mountPath/);
	});
});
