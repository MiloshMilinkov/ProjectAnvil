import { env } from "cloudflare:workers";
import { database, type ResolvedWorkspace } from "./access-store";
import { WorkspaceError } from "./workspace-model";
import type { Workspace } from "./types";

interface MediaObjectRow {
  media_id: string;
  object_key: string;
  state: "uploading" | "active" | "retained";
  created_at: string;
  unreferenced_at: string | null;
}

export async function recordUpload(
  access: ResolvedWorkspace,
  mediaId: string,
  objectKey: string,
): Promise<void> {
  const membership = access.user
    ? " AND EXISTS (SELECT 1 FROM appmembers WHERE workspace_id = ? AND user_id = ?)"
    : "";
  const values = access.user ? [access.id, access.user.id] : [];
  const result = await database()
    .prepare(
      `INSERT INTO media_objects (workspace_id, media_id, object_key, state, created_at)
    SELECT ?, ?, ?, 'uploading', ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ?)${membership}`,
    )
    .bind(
      access.id,
      mediaId,
      objectKey,
      new Date().toISOString(),
      access.id,
      ...values,
    )
    .run();
  if (!result.meta.changes)
    throw new WorkspaceError(
      "Your workspace access changed before the upload started.",
      409,
    );
}

/** Preserve bytes after any uncertain failure; a later storage check explains them. */
export async function retainFailedUpload(
  workspaceId: string,
  mediaId: string,
): Promise<void> {
  await database()
    .prepare(
      "UPDATE media_objects SET state = 'retained', unreferenced_at = ? WHERE workspace_id = ? AND media_id = ? AND state = 'uploading'",
    )
    .bind(new Date().toISOString(), workspaceId, mediaId)
    .run();
}

export async function storageHealth(
  access: ResolvedWorkspace,
  workspace: Workspace,
) {
  if (!env.BUCKET)
    throw new WorkspaceError("Media storage is unavailable.", 503);
  const rows = await database()
    .prepare(
      "SELECT media_id, object_key, state, created_at, unreferenced_at FROM media_objects WHERE workspace_id = ?",
    )
    .bind(access.id)
    .all<MediaObjectRow>();
  const activeIds = new Set(workspace.media.map((file) => file.id));
  const registered = new Map(rows.results.map((row) => [row.media_id, row]));
  const objects = new Map<string, { key: string; size: number }>();
  let cursor: string | undefined;
  let partial = false;
  const prefix = access.kind === "guest" ? "media/" : `media/${access.id}/`;
  for (let page = 0; page < 10; page++) {
    const result = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
    for (const object of result.objects) {
      const canonical = `media/${access.id}/`;
      if (object.key.startsWith(canonical))
        objects.set(object.key.slice(canonical.length), {
          key: object.key,
          size: object.size,
        });
      else if (
        access.kind === "guest" &&
        /^media\/[a-zA-Z0-9_-]+$/.test(object.key)
      )
        objects.set(object.key.slice(6), {
          key: object.key,
          size: object.size,
        });
    }
    if (!result.truncated) break;
    cursor = result.cursor;
    if (page === 9) partial = true;
  }
  const retained = [...objects].filter(([id]) => !activeIds.has(id));
  const missing = partial
    ? []
    : workspace.media
        .filter((file) => !objects.has(file.id))
        .map((file) => ({ id: file.id, name: file.name }));
  const activeRecords = {
    ...workspace,
    notes: workspace.notes.map((note) => ({ ...note, snapshots: [] })),
  };
  const archive = await database()
    .prepare(
      "SELECT COUNT(*) AS versions, COALESCE(SUM(length(CAST(content AS BLOB))), 0) AS bytes FROM note_history WHERE workspace_id = ?",
    )
    .bind(access.id)
    .first<{ versions: number; bytes: number }>();
  return {
    activeBytes: new TextEncoder().encode(JSON.stringify(activeRecords))
      .byteLength,
    limitBytes: 1_500_000,
    history: { versions: archive?.versions || 0, bytes: archive?.bytes || 0 },
    media: {
      active: workspace.media.length,
      retained: retained.length,
      retainedBytes: retained.reduce(
        (total, [, object]) => total + object.size,
        0,
      ),
      pending: rows.results.filter(
        (row) => row.state === "uploading" && !activeIds.has(row.media_id),
      ).length,
      missing,
      untracked: retained.filter(([id]) => !registered.has(id)).length,
      partial,
    },
    retention:
      "Unreferenced files and archived history are retained. This check never deletes files.",
  };
}
