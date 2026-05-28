export { apiFetch, ApiError } from './client.js';
export { markClientOp, wasClientOp, applyLabelCreated, applyLabelUpdated, applyLabelDeleted, applyProjectCreated, applyProjectUpdated, applyProjectDeleted } from './adapters.js';
export type { BoardWithColumnsAndCards, ColumnWithCards, CardSummary, CardDetail } from './types.js';
export type {
	LabelDetail,
	ProjectDetail,
	AttachmentResponse,
	CommentDetail,
	ChecklistDetail,
	ChecklistItemDetail,
	TeamMemberRow,
	TeamInfo,
	BoardEvent,
} from './types.js';

export { getPersonalBoard, getTeamBoard } from './boards.js';
export { createColumn, renameColumn, deleteColumn, reorderColumns } from './columns.js';
export type { ColumnResponse } from './columns.js';
export { createCard, getCard, updateCard, moveCard, reorderCards, deleteCard } from './cards.js';
export type { UpdateCardPatch } from './cards.js';
export { listLabels, createLabel, updateLabel, deleteLabel } from './labels.js';
export type { UpdateLabelPatch } from './labels.js';
export { listProjects, createProject, updateProject, deleteProject } from './projects.js';
export type { UpdateProjectPatch } from './projects.js';
export { addLabelToCard, removeLabelFromCard } from './card-labels.js';
export { assignUser, unassignUser } from './assignees.js';
export { addComment, updateComment, deleteComment } from './comments.js';
export {
	addChecklist,
	deleteChecklist,
	addChecklistItem,
	updateChecklistItem,
	deleteChecklistItem,
} from './checklists.js';
export type { UpdateChecklistItemPatch } from './checklists.js';
export { uploadAttachment, deleteAttachment, attachmentDownloadUrl } from './attachments.js';
export { getMyTeam, listTeamMembers, setTeamMemberRole } from './teams.js';
export { subscribeBoard } from './events.js';
export type { BoardEventHandler } from './events.js';
export { uploadAvatar } from './users.js';
