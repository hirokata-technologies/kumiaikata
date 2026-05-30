import { zValidator as base } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { z, type ZodSchema } from "zod";
import { AppError } from "@kata/http";

export const zValidator = <
	T extends ZodSchema,
	Target extends keyof ValidationTargets,
>(
	target: Target,
	schema: T,
) =>
	base(target, schema, (result, _c) => {
		if (!result.success) {
			throw new AppError(
				"VALIDATION_ERROR",
				"Request did not match schema",
				z.flattenError(result.error),
			);
		}
	});

export function validateId(value: string | undefined, name: string): string {
	if (!value || typeof value !== "string") {
		throw new AppError("VALIDATION_ERROR", `${name} must be a valid id`);
	}
	return value;
}
