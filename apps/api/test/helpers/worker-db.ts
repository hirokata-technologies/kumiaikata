/**
 * Database names for parallel test files. The migrated template (`kata_test`) is cloned once per
 * vitest worker into `kata_test_w1`, `kata_test_w2`, …; a worker connects to the clone that
 * matches its VITEST_POOL_ID, so files running side by side never share rows.
 */

const WORKER_SUFFIX = /_w\d+$/;

/** The database named by a connection URL. */
export function databaseNameOf(url: string): string {
	return decodeURIComponent(new URL(url).pathname.slice(1));
}

/** `url` pointed at another database on the same server. */
export function withDatabase(url: string, database: string): string {
	const next = new URL(url);
	next.pathname = `/${encodeURIComponent(database)}`;
	return next.toString();
}

/** The template database's name: the URL's database without any worker suffix. */
export function templateDatabaseName(url: string): string {
	return databaseNameOf(url).replace(WORKER_SUFFIX, "");
}

export function workerDatabaseName(url: string, poolId: number | string): string {
	return `${templateDatabaseName(url)}_w${poolId}`;
}

/** Idempotent: a URL already pointing at a worker database is rebased onto the template first. */
export function workerDatabaseUrl(url: string, poolId: number | string): string {
	return withDatabase(url, workerDatabaseName(url, poolId));
}

/** Quote an identifier for use in DDL, which cannot take parameters. */
export function quoteIdent(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}
