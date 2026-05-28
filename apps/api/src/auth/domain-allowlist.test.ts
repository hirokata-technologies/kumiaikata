// ALLOWED_DOMAINS is set to "test.com,example.com" via apps/api/.env.test
// which is loaded by test/setup-env.ts before this module is imported.

import { describe, it, expect } from "vitest";
import {
	domainOf,
	isAllowedDomain,
	assertAllowedDomain,
} from "./domain-allowlist.js";
import { AppError } from "../http/error.js";

describe("domainOf", () => {
	it("returns the domain part of an email", () => {
		expect(domainOf("user@example.com")).toBe("example.com");
	});

	it("lowercases the domain before returning", () => {
		expect(domainOf("USER@EXAMPLE.COM")).toBe("example.com");
	});

	it("returns empty string when there is no @ in the input", () => {
		expect(domainOf("notanemail")).toBe("");
	});
});

describe("isAllowedDomain", () => {
	it("returns true when the email domain matches an allowed domain", () => {
		expect(isAllowedDomain("alice@example.com")).toBe(true);
		expect(isAllowedDomain("bob@test.com")).toBe(true);
	});

	it("returns false when the email domain is not in ALLOWED_DOMAINS", () => {
		expect(isAllowedDomain("mallory@notallowed.com")).toBe(false);
	});

	it("is case-insensitive for the domain part", () => {
		expect(isAllowedDomain("user@EXAMPLE.COM")).toBe(true);
	});

	it("returns false when email has no @", () => {
		expect(isAllowedDomain("notanemail")).toBe(false);
	});
});

describe("assertAllowedDomain", () => {
	it("does not throw for an allowed domain", () => {
		expect(() => assertAllowedDomain("alice@example.com")).not.toThrow();
	});

	it("throws AppError DOMAIN_NOT_ALLOWED for a disallowed domain", () => {
		expect(() => assertAllowedDomain("mallory@evil.com")).toThrow(AppError);

		try {
			assertAllowedDomain("mallory@evil.com");
		} catch (err) {
			expect((err as AppError).code).toBe("DOMAIN_NOT_ALLOWED");
		}
	});

	it("throws AppError VALIDATION_ERROR for an email without a domain (no @)", () => {
		expect(() => assertAllowedDomain("notanemail")).toThrow(AppError);

		try {
			assertAllowedDomain("notanemail");
		} catch (err) {
			expect((err as AppError).code).toBe("VALIDATION_ERROR");
		}
	});
});
