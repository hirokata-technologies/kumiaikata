import { Readable } from "node:stream";
import { vi } from "vitest";
import type { StorageAdapter } from "../../src/storage/index.js";

// In-memory backing store for the mock storage adapter.
const store = new Map<string, Buffer>();

/**
 * Drain a Node.js Readable stream into a Buffer.
 */
async function readToBuffer(stream: Readable): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
	}
	return Buffer.concat(chunks);
}

/**
 * An in-memory StorageAdapter compatible with the real DiskStorage/S3Storage
 * interfaces. All methods are vi.fn() spies so tests can assert call arguments.
 *
 * Usage in a test file:
 *
 *   vi.mock("../storage/index.js", async () => ({
 *     storage: (await import("../../test/helpers/mock-storage.js")).mockStorage,
 *   }));
 *
 *   beforeEach(clearMockStorage);
 */
export const mockStorage: StorageAdapter & {
	put: ReturnType<typeof vi.fn>;
	get: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
	/** Return the stored bytes for a key (for test assertions). */
	getStored: (key: string) => Buffer | undefined;
} = {
	put: vi.fn(async (key: string, stream: Readable) => {
		store.set(key, await readToBuffer(stream));
	}),
	get: vi.fn(async (key: string) => {
		return Readable.from(store.get(key) ?? Buffer.alloc(0));
	}),
	delete: vi.fn(async (key: string) => {
		store.delete(key);
	}),
	getStored(key: string) {
		return store.get(key);
	},
};

/**
 * Clear the in-memory store and reset all spy call histories.
 * Call this in beforeEach to keep tests isolated.
 */
export function clearMockStorage(): void {
	store.clear();
	mockStorage.put.mockClear();
	mockStorage.get.mockClear();
	mockStorage.delete.mockClear();
}
