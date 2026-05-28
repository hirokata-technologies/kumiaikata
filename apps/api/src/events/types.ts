export type BoardEvent =
	| {
			type:
				| "column.created"
				| "column.updated"
				| "column.deleted"
				| "columns.reordered";
			boardId: string;
			payload: unknown;
	  }
	| {
			type:
				| "card.created"
				| "card.updated"
				| "card.deleted"
				| "card.moved"
				| "cards.reordered";
			boardId: string;
			payload: unknown;
	  }
	| {
			type:
				| "card.comment.created"
				| "card.comment.updated"
				| "card.comment.deleted";
			boardId: string;
			payload: unknown;
	  }
	| {
			type:
				| "card.checklist.created"
				| "card.checklist.updated"
				| "card.checklist.deleted";
			boardId: string;
			payload: unknown;
	  }
	| {
			type: "card.label.added" | "card.label.removed";
			boardId: string;
			payload: unknown;
	  }
	| {
			type: "card.assignee.added" | "card.assignee.removed";
			boardId: string;
			payload: unknown;
	  }
	| {
			type: "card.attachment.added" | "card.attachment.removed";
			boardId: string;
			payload: unknown;
	  }
	| {
			type: "label.created" | "label.updated" | "label.deleted";
			boardId: string;
			payload: unknown;
	  }
	| {
			type: "project.created" | "project.updated" | "project.deleted";
			boardId: string;
			payload: unknown;
	  };
