import { zValidator as base } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodSchema } from "zod";
import { ObjectId } from "mongodb";
import { AppError } from "./error.js";

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
				result.error.flatten(),
			);
		}
	});

/**
 * Validate that `value` is a syntactically valid MongoDB ObjectId.
 * Throws a 422 VALIDATION_ERROR if not. Returns the validated value.
 *
 * @param value - The raw string from a route param (or undefined).
 * @param name  - Human-readable param name used in the error message.
 */
export function validateObjectId(value: string | undefined, name: string): string {
	if (!value || !ObjectId.isValid(value)) {
		throw new AppError("VALIDATION_ERROR", `${name} must be a valid id`);
	}
	return value;
}
