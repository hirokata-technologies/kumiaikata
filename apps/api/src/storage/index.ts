import { env } from "../env.js";
import { DiskStorage } from "./disk.js";
import { GcsStorage } from "./gcs.js";

export type { StorageAdapter } from "./adapter.js";
export { DiskStorage } from "./disk.js";
export { GcsStorage } from "./gcs.js";

export const storage = env.GCS_BUCKET
	? new GcsStorage(env.GCS_BUCKET)
	: new DiskStorage(env.ATTACHMENTS_DIR);
