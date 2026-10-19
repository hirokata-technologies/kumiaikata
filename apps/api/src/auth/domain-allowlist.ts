import { env } from "../env.js";
import { AppError } from "../http/error.js";

/** `ALLOWED_DOMAINS=*` opens sign-up to every email domain. */
export const WILDCARD_DOMAIN = "*";

export const domainOf = (email: string): string =>
	email.toLowerCase().split('@')[1] ?? '';

/** Whether `domain` is permitted by `list`, which may contain the wildcard. */
export const isDomainInList = (list: readonly string[], domain: string): boolean => {
	if (!domain) return false;
	const normalised = list.map((d) => d.toLowerCase());
	return normalised.includes(WILDCARD_DOMAIN) || normalised.includes(domain.toLowerCase());
};

export const isAllowedDomain = (email: string): boolean =>
	isDomainInList(env.ALLOWED_DOMAINS, domainOf(email));

export function assertAllowedDomain(email: string): void {
	const domain = domainOf(email);
	if (!domain) {
		throw new AppError('VALIDATION_ERROR', 'Invalid email format.');
	}
	if (!isAllowedDomain(email)) {
		throw new AppError(
			'DOMAIN_NOT_ALLOWED',
			`Sign-in from domain "${domain}" is not permitted.`,
		);
	}
}
