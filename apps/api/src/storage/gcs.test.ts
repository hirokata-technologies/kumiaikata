import { describe, it, expect, vi, beforeEach } from "vitest";
import { PassThrough, Readable } from "node:stream";
import type { Storage } from "@google-cloud/storage";
import { GcsStorage } from "./gcs.js";
import { AppError } from "../http/error.js";

// The SDK is replaced by a hand-rolled fake: no network, no credentials.
const file = {
	createWriteStream: vi.fn(),
	createReadStream: vi.fn(),
	exists: vi.fn(),
	delete: vi.fn(),
};
const bucket = { file: vi.fn(() => file) };
const sdk = { bucket: vi.fn(() => bucket) } as unknown as Storage;

function makeStorage(): GcsStorage {
	return new GcsStorage("kata-attachments", sdk);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GcsStorage.put", () => {
	it("pipes the stream into a non-resumable write stream with the content type", async () => {
		const chunks: Buffer[] = [];
		const sink = new PassThrough();
		sink.on("data", (c: Buffer) => chunks.push(c));
		file.createWriteStream.mockReturnValue(sink);

		await makeStorage().put("b1/a1.txt", Readable.from([Buffer.from("hello")]), 5, "text/plain");

		expect(sdk.bucket).toHaveBeenCalledWith("kata-attachments");
		expect(bucket.file).toHaveBeenCalledWith("b1/a1.txt");
		expect(file.createWriteStream).toHaveBeenCalledWith({
			resumable: false,
			contentType: "text/plain",
		});
		expect(Buffer.concat(chunks).toString()).toBe("hello");
	});

	it("maps an upload failure to INTERNAL_ERROR", async () => {
		const sink = new PassThrough();
		file.createWriteStream.mockReturnValue(sink);
		const source = new Readable({ read() {} });
		const pending = makeStorage().put("k", source, 1, "text/plain");
		sink.destroy(new Error("boom"));

		await expect(pending).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
		await expect(pending).rejects.toBeInstanceOf(AppError);
	});
});

describe("GcsStorage.get", () => {
	it("returns the read stream when the object exists", async () => {
		const stream = Readable.from([Buffer.from("data")]);
		file.exists.mockResolvedValue([true]);
		file.createReadStream.mockReturnValue(stream);

		await expect(makeStorage().get("k")).resolves.toBe(stream);
	});

	it("throws NOT_FOUND when the object does not exist", async () => {
		file.exists.mockResolvedValue([false]);

		await expect(makeStorage().get("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(file.createReadStream).not.toHaveBeenCalled();
	});

	it("maps SDK errors to INTERNAL_ERROR", async () => {
		file.exists.mockRejectedValue(new Error("403"));

		await expect(makeStorage().get("k")).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
	});
});

describe("GcsStorage.delete", () => {
	it("deletes the object and ignores a missing one", async () => {
		file.delete.mockResolvedValue([{}]);

		await makeStorage().delete("k");

		expect(file.delete).toHaveBeenCalledWith({ ignoreNotFound: true });
	});

	it("maps SDK errors to INTERNAL_ERROR", async () => {
		file.delete.mockRejectedValue(new Error("500"));

		await expect(makeStorage().delete("k")).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
	});
});
