import { env } from "../env.js";
import { AppError } from "../http/error.js";

const allowed = new Set(env.ALLOWED_DOMAINS.map((d) => d.toLowerCase()));

export const domainOf = (email: string): string =>
	email.toLowerCase().split('@')[1] ?? '';

export const isAllowedDomain = (email: string): boolean =>
	allowed.has(domainOf(email));

export function assertAllowedDomain(email: string): void {
	if (!isAllowedDomain(email)) {
		throw new AppError(
			'DOMAIN_NOT_ALLOWED',
			`Sign-in from domain "${domainOf(email)}" is not permitted.`,
		);
	}
}
