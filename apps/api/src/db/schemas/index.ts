import { db } from "../connection.js";
import { type Board, BOARDS_COLLECTION } from "./board.js";
import { type Card, CARDS_COLLECTION } from "./card.js";
import { type Column, COLUMNS_COLLECTION } from "./column.js";
import { type Label, LABELS_COLLECTION } from "./label.js";
import { type Attachment, ATTACHMENTS_COLLECTION } from "./attachment.js";
import { type Team, TEAMS_COLLECTION } from "./team.js";
import { type TeamMember, TEAM_MEMBERS_COLLECTION } from "./team-member.js";
import { type User, USER_COLLECTION } from "./user.js";

export const COLLECTIONS = {
	boards: BOARDS_COLLECTION,
	cards: CARDS_COLLECTION,
	columns: COLUMNS_COLLECTION,
	labels: LABELS_COLLECTION,
	attachments: ATTACHMENTS_COLLECTION,
	teams: TEAMS_COLLECTION,
	teamMembers: TEAM_MEMBERS_COLLECTION,
	user: USER_COLLECTION,
} as const;

export const boards = () => db.collection<Board>(COLLECTIONS.boards);
export const cards = () => db.collection<Card>(COLLECTIONS.cards);
export const columns = () => db.collection<Column>(COLLECTIONS.columns);
export const labels = () => db.collection<Label>(COLLECTIONS.labels);
export const attachments = () =>
	db.collection<Attachment>(COLLECTIONS.attachments);
export const teams = () => db.collection<Team>(COLLECTIONS.teams);
export const teamMembers = () =>
	db.collection<TeamMember>(COLLECTIONS.teamMembers);
export const users = () => db.collection<User>(COLLECTIONS.user);

export type { Board, Card, Column, Label, Attachment, Team, TeamMember, User };
export { BoardSchema } from "./board.js";
export { CardSchema } from "./card.js";
export { ColumnSchema } from "./column.js";
export { LabelSchema } from "./label.js";
export { AttachmentSchema } from "./attachment.js";
export { TeamSchema } from "./team.js";
export { TeamMemberSchema } from "./team-member.js";
export { UserSchema } from "./user.js";
