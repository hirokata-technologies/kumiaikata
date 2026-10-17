function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

interface ActionEmail {
	/** Document title; also the email subject. */
	title: string;
	/** Inbox preview text shown next to the subject. */
	preheader: string;
	heading: string;
	body: string;
	buttonLabel: string;
	url: string;
	/** Closing line under the fallback link. */
	footnote: string;
}

/**
 * Shared layout for single-action transactional emails (verify, reset, ...).
 *
 * Table-based layout with inline styles for broad email-client support, plus a dark-mode
 * override and an Outlook (VML) button fallback. Mirrors the "Email Verification" design.
 * All copy is static; only `url` is caller-supplied and is HTML-escaped.
 */
function renderActionEmail(email: ActionEmail): string {
	const url = escapeHtml(email.url);

	return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${email.title}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
  @media (max-width: 620px) {
    .card-pad { padding: 32px 24px !important; }
    .h1 { font-size: 26px !important; line-height: 34px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .bg { background-color: #1C1B17 !important; }
    .card { background-color: #24221D !important; border-color: #3A3731 !important; }
    .ink { color: #EDEAE2 !important; }
    .muted { color: #A9A49A !important; }
    .rule { border-color: #3A3731 !important; }
    .btn-td { background-color: #4A5A9A !important; }
    .link { color: #9FAEE6 !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#F2F0E9; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
<span style="display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; max-height:0; max-width:0; overflow:hidden; mso-hide:all;">${email.preheader}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</span>

<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F2F0E9" style="background-color:#F2F0E9;">
  <tr>
    <td align="center" style="padding:48px 16px;">
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%;">

        <tr>
          <td style="padding:0 8px 24px 8px; font-family:Helvetica, Arial, sans-serif; font-size:13px; line-height:16px; mso-line-height-rule:exactly; letter-spacing:0.18em; font-weight:bold; color:#14130F;" class="ink">
            KATA
          </td>
        </tr>

        <tr>
          <td class="card card-pad" bgcolor="#FBFAF6" style="background-color:#FBFAF6; border:1px solid #E4E0D5; border-radius:14px; padding:48px 48px 40px 48px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="ink h1" style="font-family:Georgia, 'Times New Roman', serif; font-size:30px; line-height:38px; mso-line-height-rule:exactly; font-weight:normal; color:#14130F; padding-bottom:16px;">
                  ${email.heading}
                </td>
              </tr>
              <tr>
                <td class="muted" style="font-family:Helvetica, Arial, sans-serif; font-size:16px; line-height:26px; mso-line-height-rule:exactly; color:#4A4740; padding-bottom:32px;">
                  ${email.body}
                </td>
              </tr>
              <tr>
                <td style="padding-bottom:32px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td class="btn-td" align="center" bgcolor="#2E3A6B" style="background-color:#2E3A6B; border-radius:8px;">
                        <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${url}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="17%" stroke="f" fillcolor="#2E3A6B"><center style="color:#FBFAF6;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${email.buttonLabel}</center></v:roundrect><![endif]-->
                        <!--[if !mso]><!-->
                        <a href="${url}" style="display:block; padding:14px 28px; font-family:Helvetica, Arial, sans-serif; font-size:15px; line-height:20px; font-weight:bold; color:#FBFAF6; text-decoration:none; border-radius:8px;">${email.buttonLabel}</a>
                        <!--<![endif]-->
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td class="rule" style="border-top:1px solid #E4E0D5; font-size:0; line-height:0; height:1px;">&nbsp;</td>
              </tr>
              <tr>
                <td class="muted" style="padding-top:24px; font-family:Helvetica, Arial, sans-serif; font-size:13px; line-height:20px; mso-line-height-rule:exactly; color:#6B675E;">
                  Button not working? Paste this link into your browser:<br>
                  <a class="link" href="${url}" style="color:#2E3A6B; text-decoration:underline; word-break:break-all;">${url}</a>
                </td>
              </tr>
              <tr>
                <td class="muted" style="padding-top:16px; font-family:Helvetica, Arial, sans-serif; font-size:13px; line-height:20px; mso-line-height-rule:exactly; color:#6B675E;">
                  ${email.footnote}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td class="muted" style="padding:24px 8px 0 8px; font-family:Helvetica, Arial, sans-serif; font-size:12px; line-height:18px; mso-line-height-rule:exactly; color:#8A857B;">
            Kata by HiroKata &middot; <a class="link" href="https://hirokata.dev" style="color:#8A857B; text-decoration:underline;">hirokata.dev</a>
          </td>
        </tr>

      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>
`;
}

/**
 * Render the "Verify your Kata email address" email.
 *
 * @param verifyUrl - Verification link generated by Better Auth
 */
export function verificationEmailHtml(verifyUrl: string): string {
	return renderActionEmail({
		title: "Verify your Kata email address",
		preheader: "Confirm your email address to finish setting up your Kata account.",
		heading: "Verify your email address",
		body: "Confirm this is your address to finish setting up your Kata account.",
		buttonLabel: "Verify email address",
		url: verifyUrl,
		footnote: "If you did not create an account, you can safely ignore this email.",
	});
}

/**
 * Render the "Reset your Kata password" email.
 *
 * @param resetUrl - Password reset link generated by Better Auth (valid for 1 hour)
 */
export function passwordResetEmailHtml(resetUrl: string): string {
	return renderActionEmail({
		title: "Reset your Kata password",
		preheader: "Use this link to choose a new password for your Kata account.",
		heading: "Reset your password",
		body: "We received a request to reset the password for your Kata account. This link expires in 1 hour.",
		buttonLabel: "Reset password",
		url: resetUrl,
		footnote: "If you did not request this, you can safely ignore this email. Your password will not change.",
	});
}
