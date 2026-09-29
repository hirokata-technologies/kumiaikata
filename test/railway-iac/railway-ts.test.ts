// Integration seam: `.railway/railway.ts` evaluated through `railway/iac`,
// against the REAL file — no fixtures, no mocks, no network, no Railway CLI,
// no credentials. This is the offline-evaluation precondition every other
// acceptance criterion depends on, and the safety-property proof the
// partial-scoping ADR calls for.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createRailwayContext, project } from "railway/iac";
import railwayProgram, { partial } from "../../.railway/railway.ts";
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RAILWAY_TS_PATH = path.join(ROOT, ".railway", "railway.ts");
const sourceText = readFileSync(RAILWAY_TS_PATH, "utf8");

const ctx = createRailwayContext({ environment: "production" });
const definition = railwayProgram(ctx, project);
const resources = flattenResources(definition.resources ?? []);

describe("real .railway/railway.ts — offline evaluation", () => {
	it("evaluates to a ProjectDefinition with a non-empty resources array", () => {
		expect(definition.resources).toBeDefined();
		expect(resources.length).toBeGreaterThan(0);
	});

	it('exports partial = "kata"', () => {
		assertPartialIsKata(partial);
	});

	it("declares exactly the five kata resources, with no portfolio reference anywhere", () => {
		expect(() => assertExactResourceNames(resources)).not.toThrow();
		expect(() => assertNoPortfolioReferences(resources, sourceText)).not.toThrow();
	});

	it("keeps all five resources in one consistent canvas group (literal name not asserted — BUG-027)", () => {
		expect(() => assertConsistentGroupMembership(resources)).not.toThrow();
	});

	it("pins every image tag to its live value, including the two non-latest template tags", () => {
		expect(() => assertImageTags(resources)).not.toThrow();
	});

	it("keeps every custom domain within the *.hirokata.dev / port policy", () => {
		expect(() => assertDomainsWithinPolicy(resources)).not.toThrow();
	});

	it("never declares a literal or raw variable", () => {
		expect(() => assertNoLiteralOrRawVariables(resources)).not.toThrow();
	});

	it("never contains a credential-shaped string in its source text", () => {
		expect(() => assertNoCredentialShapedStrings(sourceText)).not.toThrow();
	});

	it("attaches postgres-volume to kata-db and redis-volume to Redis at their expected mount paths, with no orphaned volume", () => {
		expect(() => assertVolumeAttachments(resources)).not.toThrow();
	});

	it("declares the migrated healthcheck/restart-policy intent on kata-api and kata-relay-service only (REQ-006, US-4 AC1/AC2/AC3)", () => {
		expect(() => assertHealthcheckAndRestartPolicy(resources)).not.toThrow();
	});

	// REQ-006 turned this guard ON: healthcheckPath, healthcheckTimeout,
	// restartPolicyType and restartPolicyMaxRetries on kata-api /
	// kata-relay-service are now asserted above by
	// assertHealthcheckAndRestartPolicy, evaluated against the real
	// `.railway/railway.ts` file (not a fixture). The REQ-004-era deferral
	// that used to live in this comment (these fields were BUG-026's
	// territory, expected to be removed at the repairs gate) no longer
	// applies — TASK-051 landed the fields and BUG-026 is resolved. Do not
	// reintroduce a deferral comment here without a corresponding removal of
	// the assertion above.
});
