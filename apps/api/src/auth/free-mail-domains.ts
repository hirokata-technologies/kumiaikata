/**
 * Public mailbox providers. Anyone can register an address on these domains, so a
 * shared domain team would put strangers on one board. Users on these domains get a
 * private team of their own instead (see provisioning.ts).
 */
const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
	"gmail.com",
	"googlemail.com",
	"outlook.com",
	"hotmail.com",
	"live.com",
	"msn.com",
	"yahoo.com",
	"yahoo.com.ph",
	"ymail.com",
	"icloud.com",
	"me.com",
	"mac.com",
	"aol.com",
	"proton.me",
	"protonmail.com",
	"gmx.com",
	"gmx.net",
	"zoho.com",
	"mail.com",
	"yandex.com",
	"fastmail.com",
	"hey.com",
	"tutanota.com",
	"tuta.com",
]);

export const isFreeMailDomain = (domain: string): boolean =>
	FREE_MAIL_DOMAINS.has(domain.toLowerCase());
