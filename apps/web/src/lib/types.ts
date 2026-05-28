export type LabelId = string;
export type AvatarId = 'me' | 'm' | 'd' | 'r';

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

export interface AvatarDef {
	name: string;
	init: string;
	tone: string;
}

export interface KataCard {
	id: string;
	title: string;
	desc: string;
	labels: string[];
	assignee: AvatarId;
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

export type ProposalType = 'create' | 'move' | 'description';

export interface Proposal {
	type: ProposalType;
	summary: string;
	card?: KataCard;
	columnId?: string;
	cardId?: string;
	toColumnId?: string;
	text?: string;
}

export type MessagePart =
	| { kind: 'text'; text: string; streamed: boolean }
	| { kind: 'proposal'; proposal: Proposal; accepted?: boolean; rejected?: boolean };

export interface ChatMessage {
	id: string;
	role: 'user' | 'ai';
	text?: string;
	parts?: MessagePart[];
}

export type ChatPlacement = 'side' | 'floating' | 'overlay';
export type Density = 'compact' | 'comfortable' | 'spacious';
export type ColumnStyle = 'tray' | 'flat';

export interface AppSettings {
	dark: boolean;
	accent: string;
	density: Density;
	chat_placement: ChatPlacement;
	column_style: ColumnStyle;
	mist: boolean;
}
