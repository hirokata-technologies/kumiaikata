import { eq, and, asc } from "drizzle-orm";
import { db, newId } from "@kata/db";
import { projects } from "@kata/db";
import { AppError } from "@kata/http";
import { eventBus } from "@kata/events";

// ── Serialisation shape ───────────────────────────────────────────────────────

export interface ProjectDetail {
	id: string;
	boardId: string;
	name: string;
	color: string;
}

// ── listProjects ──────────────────────────────────────────────────────────────

export async function listProjects(boardId: string): Promise<ProjectDetail[]> {
	const rows = await db
		.select()
		.from(projects)
		.where(eq(projects.boardId, boardId))
		.orderBy(asc(projects.name));
	return rows.map((p) => ({
		id: p.id,
		boardId: p.boardId,
		name: p.name,
		color: p.color,
	}));
}

// ── createProject ─────────────────────────────────────────────────────────────

export async function createProject(
	boardId: string,
	input: { name: string; color: string },
): Promise<ProjectDetail> {
	const [project] = await db
		.insert(projects)
		.values({ id: newId(), boardId, name: input.name, color: input.color })
		.returning();

	if (!project) {
		throw new AppError("INTERNAL_ERROR", "Project was created but could not be fetched.");
	}

	const detail: ProjectDetail = {
		id: project.id,
		boardId: project.boardId,
		name: project.name,
		color: project.color,
	};

	eventBus.emit({
		type: "project.created",
		boardId,
		payload: detail,
	});

	return detail;
}

// ── updateProject ─────────────────────────────────────────────────────────────

export async function updateProject(
	boardId: string,
	projectId: string,
	input: { name?: string; color?: string },
): Promise<ProjectDetail> {
	const patch: Partial<{ name: string; color: string }> = {};
	if (input.name !== undefined) patch.name = input.name;
	if (input.color !== undefined) patch.color = input.color;

	const [project] = await db
		.update(projects)
		.set(patch)
		.where(and(eq(projects.id, projectId), eq(projects.boardId, boardId)))
		.returning();

	if (!project) {
		throw new AppError("NOT_FOUND", "Project not found.");
	}

	const detail: ProjectDetail = {
		id: project.id,
		boardId: project.boardId,
		name: project.name,
		color: project.color,
	};

	eventBus.emit({
		type: "project.updated",
		boardId,
		payload: detail,
	});

	return detail;
}

// ── deleteProject ─────────────────────────────────────────────────────────────

export async function deleteProject(
	boardId: string,
	projectId: string,
): Promise<void> {
	const deleted = await db
		.delete(projects)
		.where(and(eq(projects.id, projectId), eq(projects.boardId, boardId)))
		.returning({ id: projects.id });

	if (deleted.length === 0) {
		throw new AppError("NOT_FOUND", "Project not found.");
	}

	eventBus.emit({
		type: "project.deleted",
		boardId,
		payload: { id: projectId, boardId },
	});
}
