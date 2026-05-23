import { env } from "../env.js";
import { DiskStorage } from "./disk.js";

export type { StorageAdapter } from "./adapter.js";
export { DiskStorage } from "./disk.js";

export const storage = new DiskStorage(env.ATTACHMENTS_DIR);
