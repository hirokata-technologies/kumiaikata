import { z } from "zod";
import { toIsoUtc } from "@kata/db";

/** Shared input and result helpers for the guild write tools. */

/** An ISO-8601 instant on the wire (a value without an offset is read as UTC), as a Date. */
export const instantInput = z
	.string()
	.trim()
	.min(1)
	.transform((value, ctx) => {
		const iso = toIsoUtc(value);
		if (!iso) {
			ctx.addIssue({ code: "custom", message: `"${value}" is not an ISO-8601 timestamp` });
			return z.NEVER;
		}
		return new Date(iso);
	})
	.describe("ISO-8601 UTC timestamp, e.g. 2026-10-18T09:00:00Z");

/** `expect_status`: one status or a list of them (contract §2 rule 9). */
export function expectInput<const T extends readonly [string, ...string[]]>(values: T) {
	const one = z.enum(values);
	return z.union([one, z.array(one).min(1)]).describe("Guard: CONFLICT unless the current status is one of these");
}

/** A row a write just produced. Its absence is a bug, not a caller error. */
export function mustRow<T>(row: T | null | undefined, what: string): T {
	if (row === null || row === undefined) throw new Error(`[guild] ${what} vanished inside its own transaction`);
	return row;
}
