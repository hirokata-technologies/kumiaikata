import { Storage } from "@google-cloud/storage";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { AppError } from "../http/error.js";
import type { StorageAdapter } from "./adapter.js";

/**
 * Google Cloud Storage backed attachments. Authenticates with Application
 * Default Credentials (the Cloud Run service account) — no keys to manage.
 */
export class GcsStorage implements StorageAdapter {
	private readonly storage: Storage;

	constructor(
		private readonly bucket: string,
		storage?: Storage,
	) {
		this.storage = storage ?? new Storage();
	}

	private file(key: string) {
		return this.storage.bucket(this.bucket).file(key);
	}

	async put(
		key: string,
		stream: Readable,
		_size: number,
		mimeType: string,
	): Promise<void> {
		try {
			// Single-request upload: attachments are capped well below the size
			// where resumable uploads pay for their extra round trips.
			const writable = this.file(key).createWriteStream({
				resumable: false,
				contentType: mimeType,
			});
			await pipeline(stream, writable);
		} catch (err) {
			console.error(`GcsStorage.put failed for key "${key}":`, err);
			throw new AppError("INTERNAL_ERROR", "Failed to store file");
		}
	}

	async get(key: string): Promise<Readable> {
		try {
			const file = this.file(key);
			const [exists] = await file.exists();
			if (!exists) {
				throw new AppError("NOT_FOUND", "File not found");
			}
			return file.createReadStream();
		} catch (err) {
			if (err instanceof AppError) throw err;
			console.error(`GcsStorage.get failed for key "${key}":`, err);
			throw new AppError("INTERNAL_ERROR", "Failed to read file");
		}
	}

	async delete(key: string): Promise<void> {
		try {
			await this.file(key).delete({ ignoreNotFound: true });
		} catch (err) {
			console.error(`GcsStorage.delete failed for key "${key}":`, err);
			throw new AppError("INTERNAL_ERROR", "Failed to delete file");
		}
	}
}
