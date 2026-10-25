import { z } from "zod";
import {
  assertSameOrigin,
  database,
  resolveWorkspace,
  type ResolvedWorkspace,
} from "./access-store";
import { readWorkspace } from "./workspace-store";
import { WorkspaceError } from "./workspace-model";
import type { Workspace } from "./types";
import type { WorkRoom } from "./workrooms";

const identifier = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+$/);
const reference = z.union([identifier, z.literal("")]);
const timestamp = z.string().datetime({ offset: true });
const roomLocationSchema = z
  .object({
    page: z.enum([
      "overview",
      "my-work",
      "tasks",
      "projects",
      "notes",
      "brainstorm",
      "activity",
      "graph",
      "canvas",
      "collections",
      "daily",
    ]),
    projectFilter: reference,
    noteId: reference,
    canvasId: reference,
    canvasViewport: z
      .object({
        x: z.number().finite().min(-100_000).max(100_000),
        y: z.number().finite().min(-100_000).max(100_000),
        zoom: z.number().finite().min(0.05).max(5),
      })
      .strict()
      .optional(),
  })
  .strict();
const checkpointSchema = z
  .object({
    summary: z.string().max(2000),
    nextStep: z.string().max(2000),
    question: z.string().max(2000),
    savedAt: z.union([timestamp, z.literal("")]).optional(),
  })
  .strict();
const roomSchema = z
  .object({
    id: identifier,
    name: z.string().trim().min(1).max(100),
    projectId: reference,
    taskId: reference,
    noteIds: z
      .array(identifier)
      .max(20)
      .refine(
        (values) => new Set(values).size === values.length,
        "Remove duplicate pinned notes.",
      ),
    canvasId: reference,
    location: roomLocationSchema,
    checkpoint: checkpointSchema.nullable(),
    updatedAt: timestamp,
    revision: z.number().int().nonnegative(),
  })
  .strict();
const roomMutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("upsert"),
      room: roomSchema.partial().required({ id: true }),
    })
    .strict(),
  z.object({ action: z.literal("delete"), id: identifier }).strict(),
]);

interface RoomRow {
  data: string;
  revision: number;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new WorkspaceError(`${issue.path.join(".")}: ${issue.message}`);
  }
  return result.data;
}

function ownerKey(access: ResolvedWorkspace): string {
  return access.user ? `user:${access.user.id}` : "guest";
}

function membershipPredicate(access: ResolvedWorkspace): {
  sql: string;
  values: string[];
} {
  return access.user
    ? {
        sql: " AND EXISTS (SELECT 1 FROM appmembers WHERE workspace_id = ? AND user_id = ?)",
        values: [access.id, access.user.id],
      }
    : { sql: "", values: [] };
}

function roomFromRow(row: RoomRow): WorkRoom {
  return {
    ...parse(roomSchema, JSON.parse(row.data)),
    revision: row.revision,
  } as WorkRoom;
}

function referenceIndex(workspace: Workspace) {
  return {
    projects: new Set(workspace.projects.map((project) => project.id)),
    tasks: new Set(workspace.tasks.map((task) => task.id)),
    notes: new Set(workspace.notes.map((note) => note.id)),
    canvases: new Set(workspace.canvases.map((canvas) => canvas.id)),
  };
}

/** Deleted pins disappear from a resume location without editing other rooms. */
function pruneMissingReferences(
  room: WorkRoom,
  known: ReturnType<typeof referenceIndex>,
): WorkRoom {
  const canvasId = known.canvases.has(room.location.canvasId)
    ? room.location.canvasId
    : "";
  const location = {
    ...room.location,
    projectFilter: known.projects.has(room.location.projectFilter)
      ? room.location.projectFilter
      : "",
    noteId: known.notes.has(room.location.noteId) ? room.location.noteId : "",
    canvasId,
  };
  if (!canvasId) delete location.canvasViewport;
  return {
    ...room,
    projectId: known.projects.has(room.projectId) ? room.projectId : "",
    taskId: known.tasks.has(room.taskId) ? room.taskId : "",
    noteIds: room.noteIds.filter((id) => known.notes.has(id)),
    canvasId: known.canvases.has(room.canvasId) ? room.canvasId : "",
    location,
  };
}

function validateReferences(room: WorkRoom, workspace: Workspace): void {
  const pruned = pruneMissingReferences(room, referenceIndex(workspace));
  for (const key of ["projectId", "taskId", "canvasId"] as const) {
    if (pruned[key] !== room[key])
      throw new WorkspaceError(
        "Choose items from this workspace before saving the work room.",
      );
  }
  if (
    pruned.noteIds.length !== room.noteIds.length ||
    pruned.location.projectFilter !== room.location.projectFilter ||
    pruned.location.noteId !== room.location.noteId ||
    pruned.location.canvasId !== room.location.canvasId
  ) {
    throw new WorkspaceError(
      "A pinned item is unavailable in this workspace. Refresh the work room and choose another item.",
    );
  }
  if (room.location.canvasViewport && !room.location.canvasId)
    throw new WorkspaceError("Choose a canvas before saving its position.");
}

async function listForAccess(
  request: Request,
  access: ResolvedWorkspace,
): Promise<WorkRoom[]> {
  const membership = membershipPredicate(access);
  const rows = await database()
    .prepare(
      `SELECT data, revision FROM workrooms WHERE workspace_id = ? AND user_key = ?${membership.sql} ORDER BY updated_at DESC, id`,
    )
    .bind(access.id, ownerKey(access), ...membership.values)
    .all<RoomRow>();
  const workspace = await readWorkspace(request);
  const known = referenceIndex(workspace);
  return rows.results.map((row) =>
    pruneMissingReferences(roomFromRow(row), known),
  );
}

export async function readWorkRooms(request: Request): Promise<WorkRoom[]> {
  return listForAccess(request, await resolveWorkspace(request));
}

export async function mutateWorkRoom(
  request: Request,
  input: unknown,
): Promise<WorkRoom[]> {
  assertSameOrigin(request);
  const access = await resolveWorkspace(request);
  const mutation = parse(roomMutationSchema, input);
  const db = database();
  const membership = membershipPredicate(access);
  const key = ownerKey(access);

  if (mutation.action === "delete") {
    const result = await db
      .prepare(
        `DELETE FROM workrooms WHERE workspace_id = ? AND user_key = ? AND id = ?${membership.sql}`,
      )
      .bind(access.id, key, mutation.id, ...membership.values)
      .run();
    if (!result.meta.changes)
      throw new WorkspaceError("This work room is no longer available.", 404);
    return listForAccess(request, access);
  }

  const row = await db
    .prepare(
      "SELECT data, revision FROM workrooms WHERE workspace_id = ? AND user_key = ? AND id = ?",
    )
    .bind(access.id, key, mutation.room.id)
    .first<RoomRow>();
  const current = row ? roomFromRow(row) : undefined;
  if (current && mutation.room.revision !== current.revision) {
    throw new WorkspaceError(
      "This work room changed in another tab. Refresh it before saving your checkpoint.",
      409,
    );
  }
  if (!current && mutation.room.revision && mutation.room.revision !== 0) {
    throw new WorkspaceError(
      "This work room is no longer available. Refresh before saving.",
      409,
    );
  }
  const now = new Date().toISOString();
  const defaults = {
    name: "",
    projectId: "",
    taskId: "",
    noteIds: [],
    canvasId: "",
    checkpoint: null,
    location: { page: "overview", projectFilter: "", noteId: "", canvasId: "" },
  };
  const merged = {
    ...defaults,
    ...current,
    ...mutation.room,
    updatedAt: now,
    revision: (current?.revision || 0) + 1,
  };
  if (mutation.room.checkpoint)
    merged.checkpoint = { ...mutation.room.checkpoint, savedAt: now };
  const room = parse(roomSchema, merged) as WorkRoom;
  validateReferences(room, await readWorkspace(request));
  const data = JSON.stringify(room);
  if (new TextEncoder().encode(data).length > 30_000)
    throw new WorkspaceError("Keep a work room below 30 KB of text.");

  if (current) {
    const result = await db
      .prepare(
        `UPDATE workrooms SET data = ?, revision = ?, updated_at = ? WHERE workspace_id = ? AND user_key = ? AND id = ? AND revision = ?${membership.sql}`,
      )
      .bind(
        data,
        room.revision,
        now,
        access.id,
        key,
        room.id,
        current.revision,
        ...membership.values,
      )
      .run();
    if (!result.meta.changes)
      throw new WorkspaceError(
        "This work room changed while saving or your access changed. Refresh and try again.",
        409,
      );
  } else {
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO workrooms (workspace_id, user_key, id, data, revision, updated_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM workrooms WHERE workspace_id = ? AND user_key = ?) < 30${membership.sql}`,
      )
      .bind(
        access.id,
        key,
        room.id,
        data,
        room.revision,
        now,
        access.id,
        key,
        ...membership.values,
      )
      .run();
    if (!result.meta.changes)
      throw new WorkspaceError(
        "You can keep up to 30 work rooms per workspace. Refresh if another tab just saved this room.",
        409,
      );
  }
  return listForAccess(request, access);
}
