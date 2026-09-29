// Offline safety guards for the "kata" named partial (.railway/railway.ts).
//
// Every function here throws on violation and returns void on success — they
// are assertions, not predicates, so a passing test is "did not throw" and a
// failing one is "threw with a useful message". None of these read the
// network, the Railway CLI, or any credential; they only walk the
// already-compiled `ProjectDefinition.resources` (or the file's raw source
// text) that `railway/iac` produces from evaluating the program.
import type {
	DatabaseNode,
	ProjectResourceInput,
	ResourceNode,
	ServiceNode,
	VariableValue,
	VolumeNode,
} from "railway/iac";

const KATA_RESOURCE_NAMES = ["kata-api", "kata-web", "kata-relay-service", "kata-db", "Redis"] as const;

/** REQ-006 (US-2 AC1): only these two services carry the migrated healthcheck/restart-policy config. */
const HEALTHCHECK_RESTART_RESOURCES = ["kata-api", "kata-relay-service"] as const;

const EXPECTED_HEALTHCHECK_PATH = "/healthz";
const EXPECTED_HEALTHCHECK_TIMEOUT = 30;
const EXPECTED_RESTART_POLICY_TYPE = "ON_FAILURE";
const EXPECTED_RESTART_POLICY_MAX_RETRIES = 5;

const PORTFOLIO_STRINGS = ["hirokata-web-db", "hirokata-web"] as const;

const DOMAIN_PORT_POLICY: Record<string, number> = {
	"kata-api": 8787,
	"kata-web": 8080,
};

/**
 * Findings 25/28: each declared volume must attach to exactly this service,
 * at exactly this mount path — the live configuration, not a guess. A volume
 * absent from this map (or a service's `volumeAttachments` disagreeing with
 * it) is a finding, not a config choice for the guard to infer.
 */
const EXPECTED_VOLUME_ATTACHMENTS: Record<string, { service: string; mountPath: string }> = {
	"postgres-volume": { service: "kata-db", mountPath: "/var/lib/postgresql/data" },
	"redis-volume": { service: "Redis", mountPath: "/data" },
};

const EXPECTED_IMAGE_TAGS: Record<string, string> = {
	"kata-api": "ghcr.io/hirogakatageri/kata-api:latest",
	"kata-web": "ghcr.io/hirogakatageri/kata-web:latest",
	"kata-relay-service": "ghcr.io/hirogakatageri/kata-relay-service:latest",
	"kata-db": "ghcr.io/railwayapp-templates/postgres-ssl:18",
	Redis: "redis:8.2.1",
};

const CREDENTIAL_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
	{ name: "postgres:// URL with embedded credentials", pattern: /postgres:\/\/[^\s'"]+:[^\s'"]+@/i },
	{ name: "redis:// URL", pattern: /redis:\/\//i },
	{ name: "password=/secret= literal", pattern: /\b(?:password|secret)\s*=\s*\S/i },
	{ name: "32+ char hex token", pattern: /\b[0-9a-fA-F]{32,}\b/ },
	{ name: "40+ char base64-looking token", pattern: /\b[A-Za-z0-9+/]{40,}={0,2}\b/ },
];

/**
 * `ProjectDefinition.resources` may contain one level of nesting — a bare
 * `group(...)` call returns an array — so callers must flatten before
 * iterating by resource.
 */
export function flattenResources(resources: ProjectResourceInput[]): ResourceNode[] {
	const flat: ResourceNode[] = [];
	for (const entry of resources) {
		if (Array.isArray(entry)) {
			flat.push(...entry);
		} else {
			flat.push(entry);
		}
	}
	return flat;
}

/** US-1 AC1: the file must declare itself the "kata" named partial. */
export function assertPartialIsKata(partial: unknown): void {
	if (partial !== "kata") {
		throw new Error(`expected exported partial to be exactly "kata", got ${JSON.stringify(partial)}`);
	}
}

function namedResources(resources: ResourceNode[]): Array<ServiceNode | DatabaseNode> {
	return resources.filter((r): r is ServiceNode | DatabaseNode => r.type === "service" || r.type === "database");
}

/**
 * US-1 AC1: exactly the five kata resources, no more, no fewer, and no
 * resource type besides service/database/volume/group (a bucket is never
 * part of this partial). Volumes are not counted toward the five names.
 * Group node count is checked (must be at most one), never its literal name
 * (BUG-027 — the live group may be renamed at repairs).
 */
export function assertExactResourceNames(resources: ResourceNode[]): void {
	for (const r of resources) {
		if (r.type === "bucket") {
			throw new Error(`unexpected bucket resource "${r.name}" — the kata partial declares no buckets`);
		}
	}

	const groupCount = resources.filter((r) => r.type === "group").length;
	if (groupCount > 1) {
		throw new Error(`expected at most one "group" resource, found ${groupCount}`);
	}

	const actualNames = new Set(namedResources(resources).map((r) => r.name));
	const expectedNames = new Set<string>(KATA_RESOURCE_NAMES);

	const missing = [...expectedNames].filter((n) => !actualNames.has(n));
	const unexpected = [...actualNames].filter((n) => !expectedNames.has(n));

	if (missing.length > 0 || unexpected.length > 0) {
		throw new Error(
			`resource name set mismatch — missing: [${missing.join(", ")}], unexpected: [${unexpected.join(", ")}]`,
		);
	}
}

/**
 * US-1 AC1: no reference to the portfolio repo's resources anywhere — not as
 * a declared resource name, not hidden in a nested field, and not as a stray
 * comment or dead code in the source text itself.
 */
export function assertNoPortfolioReferences(resources: ResourceNode[], sourceText: string): void {
	for (const needle of PORTFOLIO_STRINGS) {
		if (sourceText.includes(needle)) {
			throw new Error(`source text contains a portfolio reference: "${needle}"`);
		}
	}

	const serialized = JSON.stringify(resources);
	for (const needle of PORTFOLIO_STRINGS) {
		if (serialized.includes(needle)) {
			throw new Error(`compiled resources contain a portfolio reference: "${needle}"`);
		}
	}
}

/**
 * US-1 AC2: the five kata resources must share one identical, non-empty
 * `groupId` (canvas group placement) — the literal name is deliberately
 * never asserted (BUG-027). Resources outside the five (volumes) are not
 * required to carry a `groupId` at all.
 */
export function assertConsistentGroupMembership(resources: ResourceNode[]): void {
	const named = namedResources(resources);
	const groupIds = named.map((r) => ({ name: r.name, groupId: r.groupId }));

	const missing = groupIds.filter((g) => !g.groupId);
	if (missing.length > 0) {
		throw new Error(`resource(s) missing a groupId: ${missing.map((g) => g.name).join(", ")}`);
	}

	const distinct = new Set(groupIds.map((g) => g.groupId));
	if (distinct.size > 1) {
		throw new Error(`resources do not share one groupId: ${[...distinct].join(", ")}`);
	}
}

/**
 * US-1 AC3 / edge case: no variable anywhere may be a `literal` (a raw
 * value baked into the file) or `raw` (an unvalidated escape hatch) — only
 * `reference`, `sharedReference` and `preserve` are accepted.
 */
export function assertNoLiteralOrRawVariables(resources: ResourceNode[]): void {
	for (const r of namedResources(resources)) {
		const variables = r.variables ?? {};
		for (const [key, value] of Object.entries(variables)) {
			const v = value as VariableValue | null | undefined;
			if (!v) continue;
			if (v.type === "literal" || v.type === "raw") {
				throw new Error(`resource "${r.name}" variable "${key}" has forbidden type "${v.type}"`);
			}
		}
	}
}

/**
 * US-1 AC4: only `*.hirokata.dev` custom domains appear anywhere, kata-api
 * and kata-web are pinned to their live ports, and kata-relay-service must
 * carry no custom domain at all (only its generated Railway domain).
 */
export function assertDomainsWithinPolicy(resources: ResourceNode[]): void {
	for (const r of resources) {
		if (r.type !== "service") continue;
		const customDomains = r.networking?.customDomains ?? {};
		const domainKeys = Object.keys(customDomains);

		if (r.name === "kata-relay-service" && domainKeys.length > 0) {
			throw new Error(`"kata-relay-service" must carry no custom domain, found: ${domainKeys.join(", ")}`);
		}

		for (const domain of domainKeys) {
			if (!domain.endsWith(".hirokata.dev")) {
				throw new Error(`custom domain "${domain}" on "${r.name}" is outside the *.hirokata.dev policy`);
			}

			const expectedPort = DOMAIN_PORT_POLICY[r.name];
			if (expectedPort !== undefined) {
				const port = customDomains[domain]?.port;
				if (port !== expectedPort) {
					throw new Error(
						`custom domain "${domain}" on "${r.name}" expected port ${expectedPort}, got ${String(port)}`,
					);
				}
			}
		}
	}
}

/**
 * US-1 AC2 (image source) / edge case: the exact live image tag for each of
 * the five resources, including the two pinned non-`latest` template tags
 * (Postgres, Redis) which must never be normalized to `latest`.
 */
export function assertImageTags(resources: ResourceNode[]): void {
	for (const r of namedResources(resources)) {
		const expected = EXPECTED_IMAGE_TAGS[r.name];
		if (expected === undefined) continue;

		const actual = r.type === "database" ? (r as DatabaseNode).image : (r as ServiceNode).source?.image;

		if (actual !== expected) {
			throw new Error(`resource "${r.name}" expected image "${expected}", got ${JSON.stringify(actual)}`);
		}
	}
}

/**
 * US-1 AC3 / AC4: the raw source text must never contain anything shaped
 * like a live credential — a connection string with embedded auth, a
 * password/secret literal assignment, or a long hex/base64-looking token.
 */
export function assertNoCredentialShapedStrings(sourceText: string): void {
	for (const { name, pattern } of CREDENTIAL_PATTERNS) {
		if (pattern.test(sourceText)) {
			throw new Error(`source text matches a credential-shaped pattern: ${name}`);
		}
	}
}

/**
 * Findings 25/28: every declared volume must be attached to exactly one
 * expected service, at the expected mount path — not merely present in
 * `resources` (volumes are excluded from the five-name set checked by
 * `assertExactResourceNames`). A volume declared but never referenced by any
 * service's `volumeAttachments` is orphaned: it still gets provisioned, but
 * mounts nothing, which is wasteful and masks a first-`apply` misconfiguration
 * that would otherwise fail silently or mount at the wrong path.
 */
export function assertVolumeAttachments(resources: ResourceNode[]): void {
	const volumes = resources.filter((r): r is VolumeNode => r.type === "volume");
	const named = namedResources(resources);

	for (const vol of volumes) {
		const expected = EXPECTED_VOLUME_ATTACHMENTS[vol.name];
		if (expected === undefined) {
			throw new Error(`declared volume "${vol.name}" has no expected attachment policy — update the guard`);
		}

		const attachers = named.filter((r) => {
			const attachments = r.volumeAttachments ?? {};
			return Object.values(attachments).some((a) => a?.volume === vol.address);
		});

		if (attachers.length === 0) {
			throw new Error(`volume "${vol.name}" is orphaned — declared in resources but attached to no service`);
		}
		if (attachers.length > 1) {
			throw new Error(
				`volume "${vol.name}" is attached to more than one service: ${attachers.map((a) => a.name).join(", ")}`,
			);
		}

		const attacher = attachers[0];
		if (attacher.name !== expected.service) {
			throw new Error(
				`volume "${vol.name}" expected to attach to "${expected.service}", found attached to "${attacher.name}"`,
			);
		}

		const attachments = attacher.volumeAttachments ?? {};
		const entry = Object.values(attachments).find((a) => a?.volume === vol.address);
		if (entry?.mountPath !== expected.mountPath) {
			throw new Error(
				`volume "${vol.name}" on "${attacher.name}" expected mountPath "${expected.mountPath}", got ${JSON.stringify(entry?.mountPath)}`,
			);
		}
	}
}

/**
 * REQ-006 (US-2 AC1, AC3, AC4, AC5; US-4 AC1, AC2): the migrated healthcheck
 * and restart-policy intent. `kata-api` and `kata-relay-service` must each
 * declare exactly `deploy.healthcheckPath === "/healthz"`,
 * `deploy.healthcheckTimeout === 30`, `deploy.restartPolicyType ===
 * "ON_FAILURE"` and `deploy.restartPolicyMaxRetries === 5` — no more, no
 * less. No other named resource (`kata-web`, `kata-db`, `Redis`) may carry
 * any of these four fields. Neither `kata-api` nor `kata-relay-service` may
 * carry `startCommand` or a `build` block — those fields must never
 * reappear on the two services this requirement migrated. `Redis` legitimately
 * carries its own pre-existing `deploy.startCommand` (the live
 * `redis-server` invocation) and is out of scope for that check. No resource
 * anywhere may carry `configFile` — it would name a deleted legacy
 * Config-as-Code file.
 */
export function assertHealthcheckAndRestartPolicy(resources: ResourceNode[]): void {
	for (const r of namedResources(resources)) {
		const isTarget = (HEALTHCHECK_RESTART_RESOURCES as readonly string[]).includes(r.name);
		const service = r as ServiceNode;
		const deploy = service.deploy ?? {};

		if (isTarget) {
			if (deploy.healthcheckPath !== EXPECTED_HEALTHCHECK_PATH) {
				throw new Error(
					`resource "${r.name}" expected deploy.healthcheckPath "${EXPECTED_HEALTHCHECK_PATH}", got ${JSON.stringify(deploy.healthcheckPath)}`,
				);
			}
			if (deploy.healthcheckTimeout !== EXPECTED_HEALTHCHECK_TIMEOUT) {
				throw new Error(
					`resource "${r.name}" expected deploy.healthcheckTimeout ${EXPECTED_HEALTHCHECK_TIMEOUT}, got ${JSON.stringify(deploy.healthcheckTimeout)}`,
				);
			}
			if (deploy.restartPolicyType !== EXPECTED_RESTART_POLICY_TYPE) {
				throw new Error(
					`resource "${r.name}" expected deploy.restartPolicyType "${EXPECTED_RESTART_POLICY_TYPE}", got ${JSON.stringify(deploy.restartPolicyType)}`,
				);
			}
			if (deploy.restartPolicyMaxRetries !== EXPECTED_RESTART_POLICY_MAX_RETRIES) {
				throw new Error(
					`resource "${r.name}" expected deploy.restartPolicyMaxRetries ${EXPECTED_RESTART_POLICY_MAX_RETRIES}, got ${JSON.stringify(deploy.restartPolicyMaxRetries)}`,
				);
			}
		} else {
			if (deploy.healthcheckPath !== undefined) {
				throw new Error(`resource "${r.name}" must not carry deploy.healthcheckPath — only kata-api and kata-relay-service may`);
			}
			if (deploy.healthcheckTimeout !== undefined) {
				throw new Error(`resource "${r.name}" must not carry deploy.healthcheckTimeout — only kata-api and kata-relay-service may`);
			}
			if (deploy.restartPolicyType !== undefined) {
				throw new Error(`resource "${r.name}" must not carry deploy.restartPolicyType — only kata-api and kata-relay-service may`);
			}
			if (deploy.restartPolicyMaxRetries !== undefined) {
				throw new Error(`resource "${r.name}" must not carry deploy.restartPolicyMaxRetries — only kata-api and kata-relay-service may`);
			}
		}

		if (isTarget && deploy.startCommand !== undefined) {
			throw new Error(`resource "${r.name}" must not carry deploy.startCommand — the legacy Config-as-Code path must not reappear`);
		}
		if (isTarget && service.build !== undefined) {
			throw new Error(`resource "${r.name}" must not carry a build block — the legacy Config-as-Code path must not reappear`);
		}
		if (service.configFile !== undefined) {
			throw new Error(`resource "${r.name}" must not carry configFile — it would name a deleted legacy Config-as-Code file`);
		}
	}
}
