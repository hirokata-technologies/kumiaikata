export interface UserSession {
  id: string;
  email: string;
  name?: string;
}

export type BoardAccess =
  | { kind: "personal-owner"; boardId: string }
  | { kind: "team-admin"; boardId: string; teamId: string }
  | { kind: "team-member"; boardId: string; teamId: string };

export interface ContextBoard {
  id: string;
  kind: string;
  title: string;
  ownerId?: string;
  teamId?: string;
}

export interface AppVariables {
  user: UserSession;
  session: unknown;
  board: ContextBoard;
  access: BoardAccess;
}
