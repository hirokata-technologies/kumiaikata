/**
 * Tests for domain-allowlist.ts
 *
 * The `allowed` Set is built at module load time from process.env.ALLOWED_DOMAINS.
 * The setupFile (test/setup.ts) sets ALLOWED_DOMAINS="hirokata.dev,example.com"
 * before the module is imported, so static imports work correctly here.
 */
import { describe, it, expect } from "vitest";
import { domainOf, isAllowedDomain, assertAllowedDomain } from "./domain-allowlist.js";
import { AppError } from "@kata/http";

// ---------------------------------------------------------------------------
// domainOf
// ---------------------------------------------------------------------------

describe("domainOf", () => {
  it("extracts the domain portion from a standard email", () => {
    expect(domainOf("user@hirokata.dev")).toBe("hirokata.dev");
  });

  it("extracts the domain from an email with subdomain", () => {
    expect(domainOf("admin@mail.example.com")).toBe("mail.example.com");
  });

  it("returns an empty string for an email without @", () => {
    expect(domainOf("notanemail")).toBe("");
  });

  it("returns an empty string for an empty string input", () => {
    expect(domainOf("")).toBe("");
  });

  it("lowercases the domain", () => {
    expect(domainOf("User@HIROKATA.DEV")).toBe("hirokata.dev");
  });

  it("lowercases both local part and domain for consistent extraction", () => {
    expect(domainOf("User@Example.COM")).toBe("example.com");
  });

  it("handles email with multiple @ signs by taking the last segment", () => {
    // split('@')[1] picks the second segment; unusual but deterministic
    expect(domainOf("a@b@c.com")).toBe("b");
  });
});

// ---------------------------------------------------------------------------
// isAllowedDomain
// ---------------------------------------------------------------------------

describe("isAllowedDomain", () => {
  it("returns true for hirokata.dev (first allowed domain)", () => {
    expect(isAllowedDomain("user@hirokata.dev")).toBe(true);
  });

  it("returns true for example.com (second allowed domain)", () => {
    expect(isAllowedDomain("alice@example.com")).toBe(true);
  });

  it("returns false for a domain not in the allowlist", () => {
    expect(isAllowedDomain("user@gmail.com")).toBe(false);
  });

  it("returns false for a completely unknown domain", () => {
    expect(isAllowedDomain("attacker@evil.io")).toBe(false);
  });

  it("is case-insensitive (uppercase domain)", () => {
    expect(isAllowedDomain("user@HIROKATA.DEV")).toBe(true);
  });

  it("is case-insensitive (mixed case domain)", () => {
    expect(isAllowedDomain("user@Example.Com")).toBe(true);
  });

  it("returns false for an email without @", () => {
    expect(isAllowedDomain("notanemail")).toBe(false);
  });

  it("returns false for a partial match (subdomain of allowed domain)", () => {
    expect(isAllowedDomain("user@sub.hirokata.dev")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assertAllowedDomain
// ---------------------------------------------------------------------------

describe("assertAllowedDomain", () => {
  it("does not throw for an email on an allowed domain", () => {
    expect(() => assertAllowedDomain("user@hirokata.dev")).not.toThrow();
  });

  it("does not throw for example.com (second allowed domain)", () => {
    expect(() => assertAllowedDomain("bob@example.com")).not.toThrow();
  });

  it("throws AppError with DOMAIN_NOT_ALLOWED for a disallowed domain", () => {
    expect(() => assertAllowedDomain("user@gmail.com")).toThrow(AppError);
  });

  it("thrown AppError has code DOMAIN_NOT_ALLOWED for disallowed domain", () => {
    let caught: AppError | null = null;
    try {
      assertAllowedDomain("hacker@evil.io");
    } catch (e) {
      caught = e as AppError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.code).toBe("DOMAIN_NOT_ALLOWED");
  });

  it("DOMAIN_NOT_ALLOWED message includes the domain", () => {
    let caught: AppError | null = null;
    try {
      assertAllowedDomain("someone@bad.org");
    } catch (e) {
      caught = e as AppError;
    }
    expect(caught!.message).toContain("bad.org");
  });

  it("throws AppError with VALIDATION_ERROR for email without @", () => {
    expect(() => assertAllowedDomain("notanemail")).toThrow(AppError);
  });

  it("thrown AppError has code VALIDATION_ERROR for email without @", () => {
    let caught: AppError | null = null;
    try {
      assertAllowedDomain("notanemail");
    } catch (e) {
      caught = e as AppError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.code).toBe("VALIDATION_ERROR");
  });

  it("throws AppError with VALIDATION_ERROR for empty string", () => {
    let caught: AppError | null = null;
    try {
      assertAllowedDomain("");
    } catch (e) {
      caught = e as AppError;
    }
    expect(caught!.code).toBe("VALIDATION_ERROR");
  });

  it("thrown errors are instances of AppError (which extends Error)", () => {
    let caught: unknown = null;
    try {
      assertAllowedDomain("bad@blocked.net");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect(caught).toBeInstanceOf(Error);
  });

  it("is case-insensitive (uppercase allowed domain passes)", () => {
    expect(() => assertAllowedDomain("user@HIROKATA.DEV")).not.toThrow();
  });
});
