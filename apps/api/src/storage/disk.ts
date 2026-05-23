import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { AppError } from "../http/error.js";
import type { StorageAdapter } from "./adapter.js";

/**
 * Recursively collect all files matching a suffix under `dir`.
 */
async function findFiles(dir: string, suffix: string): Promise<string[]> {
	const results: string[] = [];
	let entries: import("node:fs").Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
	} catch {
		// Directory may not exist yet; treat as empty.
		return results;
	}
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			const nested = await findFiles(fullPath, suffix);
			results.push(...nested);
		} else if (entry.isFile() && entry.name.endsWith(suffix)) {
			results.push(fullPath);
		}
	}
	return results;
}

/**
 * Delete `.tmp` files in `dir` (recursively) whose `mtime` is older than
 * `maxAgeMs` milliseconds. Logs a summary and per-file errors without
 * throwing, so callers can use this as a fire-and-forget startup sweep.
 */
export async function cleanStaleTempFiles(
	dir: string,
	maxAgeMs: number,
): Promise<void> {
	const files = await findFiles(dir, ".tmp");
	const now = Date.now();
	let removed = 0;

	for (const file of files) {
		try {
			const info = await stat(file);
			if (now - info.mtimeMs > maxAgeMs) {
				await unlink(file);
				removed++;
			}
		} catch (err) {
			console.error(`[startup] failed to remove stale temp file "${file}":`, err);
		}
	}

	console.log(
		`[startup] stale .tmp cleanup: removed ${removed.toString()} of ${files.length.toString()} temp file(s) in "${dir}"`,
	);
}

export class DiskStorage implements StorageAdapter {
	constructor(private readonly root: string) {}

	private resolvePath(key: string): string {
		return join(this.root, key);
	}

	async put(
		key: string,
		stream: Readable,
		_size: number,
		_mimeType: string,
	): Promise<void> {
		const finalPath = this.resolvePath(key);
		const tempPath = `${finalPath}.tmp`;

		try {
			await mkdir(dirname(finalPath), { recursive: true });
			const writer = createWriteStream(tempPath);
			await pipeline(stream, writer);
			// Atomic rename: the final path is only visible once the write is complete.
			await rename(tempPath, finalPath);
		} catch (err) {
			// Clean up incomplete temp file; ignore errors from the cleanup itself.
			unlink(tempPath).catch(() => undefined);
			console.error(`DiskStorage.put failed for key "${key}":`, err);
			throw new AppError("INTERNAL_ERROR", "Failed to store file");
		}
	}

	async get(key: string): Promise<Readable> {
		const filePath = this.resolvePath(key);
		try {
			return createReadStream(filePath);
		} catch (err) {
			console.error(`DiskStorage.get failed for key "${key}":`, err);
			throw new AppError("INTERNAL_ERROR", "Failed to read file");
		}
	}

	async delete(key: string): Promise<void> {
		const filePath = this.resolvePath(key);
		try {
			await unlink(filePath);
		} catch (err) {
			// If the file is already gone, treat as success.
			if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
			console.error(`DiskStorage.delete failed for key "${key}":`, err);
			throw new AppError("INTERNAL_ERROR", "Failed to delete file");
		}
	}
}
