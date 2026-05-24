import { env } from "../env.js";
import { DiskStorage } from "./disk.js";
import { S3Storage } from "./s3.js";

export type { StorageAdapter } from "./adapter.js";
export { DiskStorage } from "./disk.js";
export { S3Storage } from "./s3.js";

export const storage =
	env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
		? new S3Storage(
				env.S3_BUCKET,
				env.S3_ENDPOINT,
				env.S3_REGION,
				env.S3_ACCESS_KEY_ID,
				env.S3_SECRET_ACCESS_KEY,
			)
		: new DiskStorage(env.ATTACHMENTS_DIR);
