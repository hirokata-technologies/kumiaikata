import type { GuildToolDef } from "../registry.js";
import { contextTools } from "./context.js";
import { directionTools } from "./direction.js";
import { workTools } from "./work.js";
import { graphTools } from "./graph.js";
import { readsTools } from "./reads.js";
import { qualityTools } from "./quality.js";
import { libraryTools } from "./library.js";
import { invariantsTools } from "./invariants.js";

/** Every guild tool of docs/guild-contract.md §4.1–4.8, in contract order. */
export const guildTools: GuildToolDef[] = [
	...contextTools, // §4.1 whoami, workspaces, state
	...readsTools, // §4.2 read_view, get, list, search_docs, fingerprint
	...invariantsTools, // §4.2 check_invariants
	...directionTools, // §4.3 goals, projects
	...workTools, // §4.4 requirements, plans, tasks
	...graphTools, // §4.5 graph, gates
	...qualityTools, // §4.6 findings, bugs, coverage, inspections
	...libraryTools, // §4.7 docs, edges; §4.8 record_event
];
