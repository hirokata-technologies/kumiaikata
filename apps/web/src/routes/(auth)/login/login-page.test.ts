// Markup audit tests for REQ-001: Remove Apple Sign In
//
// The web vitest config uses environment: "node" with no browser renderer,
// so these tests read the .svelte source as a string and assert structural
// properties of the markup.  This is the appropriate verification strategy
// for a deletion-only change on a project without a component test setup.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(resolve(__dirname, "+page.svelte"), "utf-8");

// ---------------------------------------------------------------------------
// US-1 AC-1: No "Continue with Apple" button or Apple logo rendered
// ---------------------------------------------------------------------------

describe("Apple Sign In removal — no Apple markup present", () => {
	it("does not contain the text 'Continue with Apple'", () => {
		expect(pageSource).not.toContain("Continue with Apple");
	});

	it("does not contain the Apple SVG path data (the distinctive cubic-bezier arc)", () => {
		// The Apple logo SVG contained a distinctive M11.78 path — verify it is gone.
		expect(pageSource).not.toContain("M11.78");
	});

	it("does not contain any element with class sso-btn-ink (Apple-only dark-invert style)", () => {
		expect(pageSource).not.toContain("sso-btn-ink");
	});

	it("does not reference Apple in any comment or markup", () => {
		// Case-insensitive check for any residual Apple mention.
		expect(pageSource.toLowerCase()).not.toContain("apple");
	});
});

// ---------------------------------------------------------------------------
// US-1 AC-2: No residual Apple SVG path data or comments
// ---------------------------------------------------------------------------

describe("Apple Sign In removal — no residual Apple markup", () => {
	it("does not contain an SVG <path> with fill #555555 (Apple logo dark grey)", () => {
		// The Apple logo used a specific dark-grey fill that the Google logo does not.
		expect(pageSource).not.toContain("#555555");
	});

	it("does not contain the Apple logo viewBox='0 0 814 1000'", () => {
		// Apple's official SVG used a tall viewBox — confirm it is absent.
		expect(pageSource).not.toContain("0 0 814 1000");
	});
});

// ---------------------------------------------------------------------------
// US-1 AC-3: sso-btn-ink CSS class block is removed
// ---------------------------------------------------------------------------

describe("Apple Sign In removal — no sso-btn-ink CSS block", () => {
	it("does not define a .sso-btn-ink CSS rule", () => {
		expect(pageSource).not.toContain(".sso-btn-ink");
	});
});

// ---------------------------------------------------------------------------
// US-1 AC-4: Google button still present and layout class intact
// ---------------------------------------------------------------------------

describe("Google button still present after Apple removal", () => {
	it("contains the text 'Continue with Google'", () => {
		expect(pageSource).toContain("Continue with Google");
	});

	it("contains an aria-label for the Google button", () => {
		expect(pageSource).toContain('aria-label="Continue with Google"');
	});

	it("contains a .sso class for the Google button", () => {
		expect(pageSource).toContain('class="sso"');
	});

	it("contains the Google SVG viewBox '0 0 18 18'", () => {
		// Google logo uses an 18x18 viewport — verify it is still present.
		expect(pageSource).toContain('viewBox="0 0 18 18"');
	});

	it("contains the Google logo blue fill #4285F4", () => {
		expect(pageSource).toContain("#4285F4");
	});

	it("calls signInWithGoogle on click", () => {
		expect(pageSource).toContain("signInWithGoogle");
	});
});

// ---------------------------------------------------------------------------
// US-2 AC-2: API env schema contains no APPLE_ fields
// ---------------------------------------------------------------------------

describe("API env schema audit — no Apple OAuth config", () => {
	let envSource: string;

	beforeAll(() => {
		envSource = readFileSync(
			resolve(__dirname, "../../../../../api/src/env.ts"),
			"utf-8",
		);
	});

	it("does not define any APPLE_ environment variable", () => {
		expect(envSource).not.toContain("APPLE_");
	});

	it("does not reference apple as a social provider key", () => {
		expect(envSource.toLowerCase()).not.toContain("apple");
	});
});
