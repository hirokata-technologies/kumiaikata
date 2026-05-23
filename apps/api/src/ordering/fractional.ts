import {
	generateKeyBetween,
	generateNKeysBetween,
} from "fractional-indexing";
import { AppError } from "../http/error.js";

export { generateKeyBetween, generateNKeysBetween };

/** Returns a position key that sorts after `lastPos` and before the logical end. */
export const appendAfter = (lastPos: string | null): string =>
	generateKeyBetween(lastPos, null);

/** Returns a position key that sorts between `a` and `b`. */
export const insertBetween = (
	a: string | null,
	b: string | null,
): string => generateKeyBetween(a, b);

/**
 * Given the current sorted items and the desired final order of their ids,
 * computes the minimum set of (id, newPos) updates needed.
 *
 * The caller is responsible for verifying that `desiredIds` contains exactly
 * the same ids as `current` (same length, same set) — this function only
 * throws if a desiredId is not found in the current map.
 */
export function reorderToMatch<T extends { _id: string; position: string }>(
	current: T[],
	desiredIds: string[],
): { id: string; position: string }[] {
	const positions = generateNKeysBetween(null, null, desiredIds.length);
	const updates: { id: string; position: string }[] = [];
	const currentById = new Map(current.map((item) => [item._id, item]));

	desiredIds.forEach((id, i) => {
		const item = currentById.get(id);
		if (item === undefined) {
			throw new AppError("VALIDATION_ERROR", `Unknown id in reorder: ${id}`);
		}
		const newPosition = positions[i];
		if (newPosition === undefined) {
			throw new AppError("INTERNAL_ERROR", "Position generation failed");
		}
		if (item.position !== newPosition) {
			updates.push({ id, position: newPosition });
		}
	});

	return updates;
}
