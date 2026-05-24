import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { Readable } from "node:stream";
import { AppError } from "../http/error.js";
import type { StorageAdapter } from "./adapter.js";

export class S3Storage implements StorageAdapter {
	private readonly client: S3Client;

	constructor(
		private readonly bucket: string,
		endpoint: string,
		region: string,
		accessKeyId: string,
		secretAccessKey: string,
	) {
		this.client = new S3Client({
			endpoint,
			region,
			credentials: { accessKeyId, secretAccessKey },
			forcePathStyle: false,
		});
	}

	async put(
		key: string,
		stream: Readable,
		size: number,
		mimeType: string,
	): Promise<void> {
		try {
			const upload = new Upload({
				client: this.client,
				params: {
					Bucket: this.bucket,
					Key: key,
					Body: stream,
					ContentType: mimeType,
					ContentLength: size,
				},
			});
			await upload.done();
		} catch (err) {
			console.error(`S3Storage.put failed for key "${key}":`, err);
			throw new AppError("INTERNAL_ERROR", "Failed to store file");
		}
	}

	async get(key: string): Promise<Readable> {
		try {
			const response = await this.client.send(
				new GetObjectCommand({ Bucket: this.bucket, Key: key }),
			);
			if (!response.Body) {
				throw new AppError("NOT_FOUND", "File not found");
			}
			return response.Body as unknown as Readable;
		} catch (err) {
			if (err instanceof AppError) throw err;
			console.error(`S3Storage.get failed for key "${key}":`, err);
			throw new AppError("INTERNAL_ERROR", "Failed to read file");
		}
	}

	async delete(key: string): Promise<void> {
		try {
			await this.client.send(
				new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
			);
		} catch (err) {
			console.error(`S3Storage.delete failed for key "${key}":`, err);
			throw new AppError("INTERNAL_ERROR", "Failed to delete file");
		}
	}
}
