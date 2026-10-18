import { AppError } from "@kata/http";

/**
 * Guild rows live in exactly one workspace, and so does everything they point at (the
 * kumiai_a_scope trigger enforces it). Moving a row under a parent in another workspace is
 * refused here first, so the caller gets a clean validation error instead of a raw
 * constraint violation.
 */
export function assertSameWorkspace(rowWorkspaceId: string, parentWorkspaceId: string, what: string): void {
	if (rowWorkspaceId !== parentWorkspaceId) {
		throw new AppError("VALIDATION_ERROR", `${what} must be in the same workspace.`);
	}
}
