export type LabelId = string;

export interface KataLabel {
	id: string;
	name: string;
	color: string;
}

export interface KataProject {
	id: string;
	name: string;
	color: string;
}

export interface LabelDef {
	name: string;
	fg: string;
	bg: string;
}

export interface MemberInfo {
	id: string;
	name: string;       // resolved display name (never empty — caller falls back to email)
	email: string;
	imageUrl: string | null;
}

export interface KataCard {
	id: string;
	title: string;
	desc: string;
	labels: string[];
	assignees: string[]; // real user IDs
	due?: string;
	projectId?: string | null;
}

export interface KataColumn {
	id: string;
	title: string;
	cards: KataCard[];
}

export interface BoardState {
	columns: KataColumn[];
	labels: KataLabel[];
	projects: KataProject[];
}

export type GroupBy = 'status' | 'project';

/** A column as displayed on the board — extends KataColumn with project-view extras. */
export interface DisplayColumn extends KataColumn {
	/** Set in project-group mode; '__none' = unassigned cards */
	projectId?: string | null;
	isOrphan?: boolean;
	project?: KataProject | null;
	/** Cards currently not in the "done" column */
	activeCount?: number;
	doneCount?: number;
}

export type Density = 'compact' | 'comfortable' | 'spacious';
export type ColumnStyle = 'tray' | 'flat';

export interface AppSettings {
	dark: boolean;
	accent: string;
	density: Density;
	column_style: ColumnStyle;
	mist: boolean;
}
