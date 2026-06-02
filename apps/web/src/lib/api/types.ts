// DTOs mirroring the API response shapes.
// Dates are represented as ISO 8601 strings since JSON.parse does not restore Date objects.

export interface CardSummary {
	id: string;
	boardId: string;
	columnId: string;
	title: string;
	position: string;
	dueDate: string | null;
	projectId: string | null;
	labelIds: string[];
	assigneeIds: string[];
	attachmentIds: string[];
	commentsCount: number;
	checklistsCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectDetail {
	id: string;
	boardId: string;
	name: string;
	color: string;
}

export interface ColumnWithCards {
	id: string;
	title: string;
	position: string;
	cards: CardSummary[];
}

export interface BoardWithColumnsAndCards {
	id: string;
	kind: string;
	title: string;
	teamId?: string;
	ownerId?: string;
	createdAt: string;
	columns: ColumnWithCards[];
}

export interface AttachmentResponse {
	id: string;
	filename: string;
	mimeType: string;
	sizeBytes: number;
	url: string;
	uploadedBy: string;
	createdAt: string;
}

export interface CommentDetail {
	id: string;
	authorId: string;
	body: string;
	createdAt: string;
	updatedAt?: string;
}

export interface ChecklistItemDetail {
	id: string;
	text: string;
	checked: boolean;
}

export interface ChecklistDetail {
	id: string;
	title: string;
	items: ChecklistItemDetail[];
}

export interface CardDetail extends CardSummary {
	description: string | null;
	comments: CommentDetail[];
	checklists: ChecklistDetail[];
	attachments: AttachmentResponse[];
}

export interface LabelDetail {
	id: string;
	boardId: string;
	name: string;
	color: string;
}

export interface TeamMemberRow {
	userId: string;
	email: string | null;
	name: string | null;
	imageUrl: string | null;
	role: string;
	joinedAt: string;
}

export interface TeamInfo {
	id: string;
	domain: string;
	name: string;
	role: string;
}

export interface BoardEvent {
	type: string;
	data: unknown;
}
