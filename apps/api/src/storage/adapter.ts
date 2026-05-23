import type { Readable } from "node:stream";

export interface StorageAdapter {
	/**
	 * Store a stream under the given key.
	 * @param key     Opaque relative path, e.g. `<boardId>/<attachmentId>.jpg`
	 * @param stream  Readable stream of the file content
	 * @param size    Total byte length (used for validation / metadata)
	 * @param mimeType MIME type of the content
	 */
	put(
		key: string,
		stream: Readable,
		size: number,
		mimeType: string,
	): Promise<void>;

	/** Return a Readable stream for the file at `key`. */
	get(key: string): Promise<Readable>;

	/** Delete the file at `key`. */
	delete(key: string): Promise<void>;
}
