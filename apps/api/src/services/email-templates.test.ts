import { describe, it, expect } from "vitest";
import { passwordResetEmailHtml, verificationEmailHtml } from "./email-templates.js";

describe("verificationEmailHtml", () => {
	it("puts the verification url in the button and the fallback link", () => {
		const url = "https://app.hirokata.dev/api/auth/verify-email?token=abc123";

		const html = verificationEmailHtml(url);

		// Outlook (VML) button, regular button, and the plain-text fallback link.
		expect(html.split(`href="${url}"`)).toHaveLength(4);
		expect(html).not.toContain("{{verify_url}}");
	});

	it("escapes the url so it cannot break out of the attribute", () => {
		const html = verificationEmailHtml('https://x.test/?a=1&b="><script>alert(1)</script>');

		expect(html).toContain("a=1&amp;b=&quot;&gt;&lt;script&gt;");
		expect(html).not.toContain("<script>");
	});

	it("keeps the title used as the email subject", () => {
		expect(verificationEmailHtml("https://x.test")).toContain(
			"<title>Verify your Kata email address</title>",
		);
	});
});

describe("passwordResetEmailHtml", () => {
	it("puts the reset url in the button and the fallback link", () => {
		const url = "https://app.hirokata.dev/reset-password/tok123?callbackURL=%2Flogin";

		const html = passwordResetEmailHtml(url);

		expect(html.split(`href="${url}"`)).toHaveLength(4);
	});

	it("escapes the url so it cannot break out of the attribute", () => {
		const html = passwordResetEmailHtml('https://x.test/?a=1&b="><script>alert(1)</script>');

		expect(html).toContain("a=1&amp;b=&quot;&gt;&lt;script&gt;");
		expect(html).not.toContain("<script>");
	});

	it("keeps the title used as the email subject and states the expiry", () => {
		const html = passwordResetEmailHtml("https://x.test");

		expect(html).toContain("<title>Reset your Kata password</title>");
		expect(html).toContain("expires in 1 hour");
	});
});
