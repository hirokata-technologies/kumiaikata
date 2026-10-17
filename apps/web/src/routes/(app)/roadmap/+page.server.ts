import type { PageServerLoad } from "./$types";
import { workspaceLoad } from "$lib/kumiai/page-load.js";

export const load: PageServerLoad = workspaceLoad;
