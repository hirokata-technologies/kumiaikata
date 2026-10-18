import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * `<column> IN ('a', 'b', …)` for a CHECK constraint. The values are inlined as literals
 * (a CHECK cannot take parameters); they only ever come from the constant vocabularies in
 * `guild-vocab.ts`, never from input.
 */
export function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
	const list = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
	return sql`${column} IN (${sql.raw(list)})`;
}

/** `<column> ~ '^PREFIX-[0-9]{3,9}$'` — the shape guild G3 asserts for a prefixed key. */
export function keyShape(column: AnyPgColumn, prefix: string): SQL {
	return sql`${column} ~ ${sql.raw(`'^${prefix}-[0-9]{3,9}$'`)}`;
}
