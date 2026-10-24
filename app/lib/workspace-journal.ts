import { database, type ResolvedWorkspace } from "./access-store";
import { WorkspaceError } from "./workspace-model";
import type { Entity, Note, Workspace } from "./types";
import type { TrashCommit } from "./trash-types";

const entities: Entity[] = [
  "people",
  "projects",
  "tasks",
  "notes",
  "media",
  "canvases",
  "savedViews",
  "relationships",
  "noteTypes",
  "relationshipPresets",
  "brainstorms",
];
type Snapshot = Note["snapshots"][number];
type ArchivedSnapshot = Snapshot & { noteId: string };

export async function payloadHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function actorKey(access: ResolvedWorkspace): string {
  return access.user ? `user:${access.user.id}` : "guest";
}

export async function hasReceipt(
  access: ResolvedWorkspace,
  operationId: string | undefined,
  hash: string,
): Promise<boolean> {
  if (!operationId) return false;
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(operationId))
    throw new WorkspaceError("Choose a valid operation ID.");
  const row = await database()
    .prepare(
      "SELECT payload_hash FROM workspace_receipts WHERE workspace_id = ? AND actor_key = ? AND operation_id = ?",
    )
    .bind(access.id, actorKey(access), operationId)
    .first<{ payload_hash: string }>();
  if (row && row.payload_hash !== hash)
    throw new WorkspaceError(
      "This save identifier was already used for a different change. Refresh before saving again.",
      409,
    );
  return !!row;
}

export async function assertNotDeleted(
  workspaceId: string,
  entity: Entity,
  itemId: string,
): Promise<void> {
  const deleted = await database()
    .prepare(
      "SELECT entity_id FROM entity_tombstones WHERE workspace_id = ? AND entity = ? AND entity_id = ?",
    )
    .bind(workspaceId, entity, itemId)
    .first();
  if (deleted)
    throw new WorkspaceError(
      "This item was deleted earlier. Create a new item with a new identifier, or restore an explicit backup.",
      409,
    );
}

export async function latestSnapshot(
  workspaceId: string,
  noteId: string,
): Promise<Snapshot | null> {
  return database()
    .prepare(
      "SELECT snapshot_id AS id, content, saved_at AS savedAt FROM note_history WHERE workspace_id = ? AND note_id = ? ORDER BY saved_at DESC, snapshot_id DESC LIMIT 1",
    )
    .bind(workspaceId, noteId)
    .first<Snapshot>();
}

export async function savedSnapshot(
  workspaceId: string,
  noteId: string,
  snapshotId: string,
): Promise<Snapshot | null> {
  return database()
    .prepare(
      "SELECT snapshot_id AS id, content, saved_at AS savedAt FROM note_history WHERE workspace_id = ? AND note_id = ? AND snapshot_id = ?",
    )
    .bind(workspaceId, noteId, snapshotId)
    .first<Snapshot>();
}

export function activeWorkspace(workspace: Workspace): Workspace {
  return {
    ...workspace,
    notes: workspace.notes.map((note) => ({ ...note, snapshots: [] })),
  };
}

/** A single database transaction owns both the CAS write and its recovery data. */
export async function commitWorkspace(
  access: ResolvedWorkspace,
  current: Workspace,
  updated: Workspace,
  operationId: string | undefined,
  hash: string,
  preserveReplacedContent = false,
  trash: TrashCommit = {},
): Promise<boolean> {
  const db = database();
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const active = activeWorkspace(updated);
  const archives = new Map<string, ArchivedSnapshot>();
  for (const workspace of [current, updated])
    for (const note of workspace.notes) {
      for (const snapshot of note.snapshots)
        archives.set(`${note.id}:${snapshot.id}`, {
          ...snapshot,
          noteId: note.id,
        });
    }
  const archivedContent = new Map<string, Set<string>>();
  for (const snapshot of archives.values()) {
    const contents = archivedContent.get(snapshot.noteId) || new Set<string>();
    contents.add(snapshot.content);
    archivedContent.set(snapshot.noteId, contents);
  }
  const updatedNotes = new Map(updated.notes.map((note) => [note.id, note]));
  // A deletion/import must preserve the last live content as well as its history.
  for (const note of current.notes) {
    const replacement = updatedNotes.get(note.id);
    if (!replacement || replacement.content !== note.content) {
      const alreadyCaptured = archivedContent.get(note.id)?.has(note.content);
      if (!alreadyCaptured && (!replacement || preserveReplacedContent)) {
        const snapshot = {
          id: crypto.randomUUID(),
          noteId: note.id,
          content: note.content,
          savedAt: now,
        };
        archives.set(`${note.id}:${snapshot.id}`, snapshot);
      }
    }
  }
  const removed: { entity: Entity; id: string }[] = [];
  for (const entity of entities) {
    const remaining = new Set((updated[entity] || []).map((item) => item.id));
    for (const item of current[entity] || [])
      if (!remaining.has(item.id)) removed.push({ entity, id: item.id });
  }
  const authorization = access.user
    ? " AND EXISTS (SELECT 1 FROM appmembers WHERE workspace_id = ? AND user_id = ?)"
    : "";
  const authorizationValues = access.user ? [access.id, access.user.id] : [];
  const restoreCondition = trash.restore
    ? " AND EXISTS (SELECT 1 FROM workspace_trash WHERE workspace_id = ? AND trash_id = ? AND deleted_at = ? AND restored_at IS NULL AND invalidated_at IS NULL)"
    : "";
  const restoreValues = trash.restore
    ? [access.id, trash.restore.id, trash.restore.deletedAt]
    : [];
  const committed =
    "EXISTS (SELECT 1 FROM workspace_write_guards g JOIN workspaces w ON w.id = g.workspace_id WHERE g.workspace_id = ? AND g.token = ? AND w.revision = ?)";
  const guardValues = [access.id, token, updated.revision];
  const statements = [
    db
      .prepare(
        `INSERT OR IGNORE INTO workspace_write_guards (workspace_id, token) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND revision = ?${authorization})${restoreCondition}`,
      )
      .bind(
        access.id,
        token,
        access.id,
        current.revision,
        ...authorizationValues,
        ...restoreValues,
      ),
    db
      .prepare(
        `UPDATE workspaces SET data = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM workspace_write_guards WHERE workspace_id = ? AND token = ?)${authorization}`,
      )
      .bind(
        JSON.stringify(active),
        active.revision,
        now,
        access.id,
        current.revision,
        access.id,
        token,
        ...authorizationValues,
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO note_history (workspace_id, note_id, snapshot_id, content, saved_at)
      SELECT ?, json_extract(value, '$.noteId'), json_extract(value, '$.id'), json_extract(value, '$.content'), json_extract(value, '$.savedAt') FROM json_each(?) WHERE ${committed}`,
      )
      .bind(
        access.id,
        JSON.stringify(
          [...archives.values()].map((snapshot) => ({
            ...snapshot,
            savedAt: new Date(snapshot.savedAt).toISOString(),
          })),
        ),
        ...guardValues,
      ),
    db
      .prepare(
        `INSERT OR REPLACE INTO entity_tombstones (workspace_id, entity, entity_id, deleted_at)
      SELECT ?, json_extract(value, '$.entity'), json_extract(value, '$.id'), ? FROM json_each(?) WHERE ${committed}`,
      )
      .bind(access.id, now, JSON.stringify(removed), ...guardValues),
    db
      .prepare(
        `UPDATE media_objects SET state = 'retained', unreferenced_at = ? WHERE workspace_id = ?
      AND media_id IN (SELECT json_extract(value, '$.id') FROM json_each(?) WHERE json_extract(value, '$.entity') = 'media') AND ${committed}`,
      )
      .bind(now, access.id, JSON.stringify(removed), ...guardValues),
    db
      .prepare(
        `INSERT INTO media_objects (workspace_id, media_id, object_key, state, created_at, unreferenced_at)
      SELECT ?, json_extract(value, '$.id'), 'media/' || ? || '/' || json_extract(value, '$.id'), 'active', ?, NULL FROM json_each(?) WHERE ${committed}
      ON CONFLICT(workspace_id, media_id) DO UPDATE SET state = 'active', unreferenced_at = NULL`,
      )
      .bind(
        access.id,
        access.id,
        now,
        JSON.stringify(updated.media),
        ...guardValues,
      ),
  ];
  if (preserveReplacedContent)
    statements.push(
      db
        .prepare(
          `UPDATE workspace_trash SET invalidated_at = ?
        WHERE workspace_id = ? AND restored_at IS NULL AND invalidated_at IS NULL AND ${committed}`,
        )
        .bind(now, access.id, ...guardValues),
    );
  if (trash.deleted) {
    // Each lifecycle has its own archive. Old Undo actions cannot resurrect a
    // later deletion, even after their short-lived mutation receipt expires.
    statements.push(
      db
        .prepare(
          `UPDATE workspace_trash SET invalidated_at = ?
        WHERE workspace_id = ? AND entity = ? AND entity_id = ?
        AND restored_at IS NULL AND invalidated_at IS NULL AND ${committed}`,
        )
        .bind(
          now,
          access.id,
          trash.deleted.entity,
          trash.deleted.entityId,
          ...guardValues,
        ),
      db
        .prepare(
          `INSERT INTO workspace_trash
        (workspace_id, trash_id, entity, entity_id, title, payload, deleted_at)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${committed}`,
        )
        .bind(
          access.id,
          trash.deleted.id,
          trash.deleted.entity,
          trash.deleted.entityId,
          trash.deleted.title,
          JSON.stringify(trash.deleted.snapshot),
          now,
          ...guardValues,
        ),
    );
  }
  if (trash.restore) {
    statements.push(
      db
        .prepare(
          `DELETE FROM entity_tombstones WHERE workspace_id = ? AND deleted_at = ?
        AND EXISTS (SELECT 1 FROM json_each(?)
          WHERE json_extract(value, '$.entity') = entity_tombstones.entity
          AND json_extract(value, '$.id') = entity_tombstones.entity_id) AND ${committed}`,
        )
        .bind(
          access.id,
          trash.restore.deletedAt,
          JSON.stringify(trash.restore.restored),
          ...guardValues,
        ),
      db
        .prepare(
          `UPDATE workspace_trash SET restored_at = ?, restore_warnings = ?
        WHERE workspace_id = ? AND trash_id = ? AND restored_at IS NULL
        AND invalidated_at IS NULL AND ${committed}`,
        )
        .bind(
          now,
          JSON.stringify(trash.restore.warnings),
          access.id,
          trash.restore.id,
          ...guardValues,
        ),
    );
  }
  if (operationId)
    statements.push(
      db
        .prepare(
          `INSERT INTO workspace_receipts (workspace_id, actor_key, operation_id, payload_hash, created_at)
    SELECT ?, ?, ?, ?, ? WHERE ${committed}`,
        )
        .bind(
          access.id,
          actorKey(access),
          operationId,
          hash,
          now,
          ...guardValues,
        ),
    );
  // Receipts provide bounded retry recovery; expired operations fail safely through
  // normal create/update/delete guards instead of being silently replayed.
  statements.push(
    db
      .prepare(
        `DELETE FROM workspace_receipts WHERE workspace_id = ? AND actor_key = ? AND
    (created_at < ? OR operation_id NOT IN (SELECT operation_id FROM workspace_receipts WHERE workspace_id = ? AND actor_key = ? ORDER BY created_at DESC, operation_id DESC LIMIT 1000)) AND ${committed}`,
      )
      .bind(
        access.id,
        actorKey(access),
        new Date(Date.now() - 7 * 86_400_000).toISOString(),
        access.id,
        actorKey(access),
        ...guardValues,
      ),
  );
  statements.push(
    db
      .prepare(
        "DELETE FROM workspace_write_guards WHERE workspace_id = ? AND token = ?",
      )
      .bind(access.id, token),
  );
  const results = await db.batch(statements);
  return results[1].meta.changes === 1;
}

export async function historyPage(
  workspaceId: string,
  workspace: Workspace,
  noteId: string,
  cursor: string | null,
) {
  if (
    !/^[a-zA-Z0-9_-]{1,120}$/.test(noteId) ||
    (cursor && !/^[a-zA-Z0-9_-]{1,120}$/.test(cursor))
  )
    throw new WorkspaceError("Choose a valid note and history cursor.");
  const legacy =
    workspace.notes.find((note) => note.id === noteId)?.snapshots || [];
  const anchor = cursor
    ? legacy.find((snapshot) => snapshot.id === cursor) ||
      (await savedSnapshot(workspaceId, noteId, cursor))
    : null;
  if (cursor && !anchor)
    throw new WorkspaceError(
      "This history page is no longer available. Reopen version history.",
      409,
    );
  const before = anchor
    ? " AND (saved_at < ? OR (saved_at = ? AND snapshot_id < ?))"
    : "";
  const values = anchor
    ? [
        new Date(anchor.savedAt).toISOString(),
        new Date(anchor.savedAt).toISOString(),
        anchor.id,
      ]
    : [];
  const rows = await database()
    .prepare(
      `SELECT snapshot_id AS id, content, saved_at AS savedAt FROM note_history WHERE workspace_id = ? AND note_id = ?${before} ORDER BY saved_at DESC, snapshot_id DESC LIMIT 21`,
    )
    .bind(workspaceId, noteId, ...values)
    .all<Snapshot>();
  const snapshots = new Map(
    rows.results.map((snapshot) => [snapshot.id, snapshot]),
  );
  for (const snapshot of legacy) {
    const savedAt = new Date(snapshot.savedAt).toISOString();
    if (
      !anchor ||
      savedAt < new Date(anchor.savedAt).toISOString() ||
      (savedAt === new Date(anchor.savedAt).toISOString() &&
        snapshot.id < anchor.id)
    )
      snapshots.set(snapshot.id, { ...snapshot, savedAt });
  }
  const descending = (left: string, right: string) =>
    left < right ? 1 : left > right ? -1 : 0;
  const sorted = [...snapshots.values()].sort(
    (left, right) =>
      descending(left.savedAt, right.savedAt) || descending(left.id, right.id),
  );
  return {
    snapshots: sorted.slice(0, 20),
    nextCursor: sorted.length > 20 ? sorted[19].id : null,
  };
}
