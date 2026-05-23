export type LabelId = 'home' | 'health' | 'errand' | 'finance' | 'work' | 'learning' | 'social' | 'creative';
export type AvatarId = 'me' | 'm' | 'd' | 'r';

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
	labels: LabelId[];
	assignee: AvatarId;
	due?: string;
}

export interface KataColumn {
	id: string;
	title: string;
	cards: KataCard[];
}

export interface BoardState {
	columns: KataColumn[];
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
