import { AppError } from "@kata/http";

const rawDomains = process.env.ALLOWED_DOMAINS ?? "";
const allowed = new Set(
  rawDomains
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
);

export const domainOf = (email: string): string =>
  email.toLowerCase().split("@")[1] ?? "";

export const isAllowedDomain = (email: string): boolean =>
  allowed.has(domainOf(email));

export function assertAllowedDomain(email: string): void {
  const domain = domainOf(email);
  if (!domain) {
    throw new AppError("VALIDATION_ERROR", "Invalid email format.");
  }
  if (!isAllowedDomain(email)) {
    throw new AppError(
      "DOMAIN_NOT_ALLOWED",
      `Sign-in from domain "${domain}" is not permitted.`,
    );
  }
}
