import * as Y from "yjs";
import { z } from "zod";
import {
  assertSameOrigin,
  database,
  resolveWorkspace,
  type ResolvedWorkspace,
} from "./access-store";
import {
  canEditProject,
  canReadProject,
  permissionsSnapshotSQL,
} from "./permissions";
import { readRawWorkspace } from "./workspace-store";
import { applyMutation, WorkspaceError } from "./workspace-model";
import {
  commitWorkspace,
  hasReceipt,
  latestSnapshot,
  payloadHash,
} from "./workspace-journal";
import type { Mutation, Workspace } from "./types";
import {
  createTextDocument,
  decodeDocumentUpdate,
  encodeDocumentUpdate,
  documentText,
  serializedDocument,
  type NoteCollaborationState,
} from "./note-collaboration";

interface DocumentRow {
  generation: string;
  document_update: string;
  content_hash: string;
}
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/);
const updateInput = z.union([
  z
    .object({
      noteId: identifier,
      generation: identifier,
      update: z.string().min(1).max(1_333_336),
      operationId: identifier,
      tabId: identifier,
    })
    .strict(),
  z
    .object({
      action: z.literal("restart"),
      noteId: identifier,
      generation: identifier,
      operationId: identifier,
      tabId: identifier,
    })
    .strict(),
]);

function checkedNote(
  access: ResolvedWorkspace,
  workspace: Workspace,
  noteId: string,
  editing = false,
) {
  const note = workspace.notes.find((item) => item.id === noteId);
  if (!note || !canReadProject(access, note.projectId))
    throw new WorkspaceError(
      "This note is no longer available to your account.",
      404,
    );
  if (editing && !canEditProject(access, note.projectId))
    throw new WorkspaceError(
      "You can read this note, but your current role cannot edit it.",
      403,
    );
  return note;
}

async function documentFor(
  access: ResolvedWorkspace,
  workspace: Workspace,
  noteId: string,
): Promise<DocumentRow | null> {
  const note = checkedNote(access, workspace, noteId);
  const db = database(),
    hash = await payloadHash(note.content);
  let row = await db
    .prepare(
      "SELECT generation, document_update, content_hash FROM note_collaboration WHERE workspace_id = ? AND note_id = ?",
    )
    .bind(access.id, noteId)
    .first<DocumentRow>();
  if (row?.content_hash === hash) return row;
  const authorization = permissionsSnapshotSQL(access);
  if (row) {
    await db
      .prepare(
        `DELETE FROM note_collaboration WHERE workspace_id = ? AND note_id = ? AND generation = ? AND EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND revision = ?) AND (${authorization.sql})`,
      )
      .bind(
        access.id,
        noteId,
        row.generation,
        access.id,
        workspace.revision,
        ...authorization.bindings,
      )
      .run();
  }
  const doc = createTextDocument(note.content);
  try {
    await db
      .prepare(
        `INSERT OR IGNORE INTO note_collaboration (workspace_id,note_id,generation,document_update,content_hash,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND revision = ?) AND (${authorization.sql})`,
      )
      .bind(
        access.id,
        noteId,
        crypto.randomUUID(),
        serializedDocument(doc),
        hash,
        new Date().toISOString(),
        access.id,
        workspace.revision,
        ...authorization.bindings,
      )
      .run();
  } finally {
    doc.destroy();
  }
  row = await db
    .prepare(
      "SELECT generation, document_update, content_hash FROM note_collaboration WHERE workspace_id = ? AND note_id = ?",
    )
    .bind(access.id, noteId)
    .first<DocumentRow>();
  return row?.content_hash === hash ? row : null;
}

async function presence(
  access: ResolvedWorkspace,
  noteId: string,
  tabId: string,
): Promise<NoteCollaborationState["peers"]> {
  const db = database(),
    authorization = permissionsSnapshotSQL(access);
  const actor = access.user?.id || "guest",
    now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "DELETE FROM note_presence WHERE workspace_id = ? AND seen_at < ?",
      )
      .bind(access.id, new Date(Date.now() - 90_000).toISOString()),
    db
      .prepare(
        `INSERT INTO note_presence (workspace_id,note_id,actor_id,tab_id,display_name,seen_at) SELECT ?,?,?,?,?,? WHERE (${authorization.sql}) AND
        (EXISTS(SELECT 1 FROM note_presence WHERE workspace_id=? AND note_id=? AND actor_id=? AND tab_id=?) OR
        (SELECT COUNT(*) FROM note_presence WHERE workspace_id=? AND actor_id=?) < 30)
        ON CONFLICT(workspace_id,note_id,actor_id,tab_id) DO UPDATE SET display_name=excluded.display_name,seen_at=excluded.seen_at WHERE note_presence.seen_at < ?`,
      )
      .bind(
        access.id,
        noteId,
        actor,
        tabId,
        access.user?.username || "Guest",
        now,
        ...authorization.bindings,
        access.id,
        noteId,
        actor,
        tabId,
        access.id,
        actor,
        new Date(Date.now() - 5_000).toISOString(),
      ),
  ]);
  const rows = await db
    .prepare(
      "SELECT actor_id AS id, display_name AS name FROM note_presence WHERE workspace_id = ? AND note_id = ? AND seen_at >= ? AND (actor_id = 'guest' OR EXISTS (SELECT 1 FROM appmembers m WHERE m.workspace_id = note_presence.workspace_id AND m.user_id = note_presence.actor_id)) GROUP BY actor_id, display_name LIMIT 200",
    )
    .bind(access.id, noteId, new Date(Date.now() - 20_000).toISOString())
    .all<{ id: string; name: string }>();
  return rows.results;
}

async function responseState(
  request: Request,
  noteId: string,
  tabId: string,
  vector?: string,
  generation?: string,
): Promise<NoteCollaborationState> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const access = await resolveWorkspace(request);
    const workspace = await readRawWorkspace(access);
    const note = checkedNote(access, workspace, noteId);
    const row = await documentFor(access, workspace, noteId);
    if (!row) continue;
    const binary = decodeDocumentUpdate(row.document_update);
    let update = binary;
    if (vector && generation === row.generation) {
      try {
        update = Y.diffUpdate(binary, decodeDocumentUpdate(vector));
      } catch {
        throw new WorkspaceError(
          "The shared note synchronization vector is invalid.",
        );
      }
    }
    const peers = await presence(access, noteId, tabId);
    const latestAccess = await resolveWorkspace(request);
    checkedNote(latestAccess, workspace, noteId);
    const revision = await database()
      .prepare("SELECT revision FROM workspaces WHERE id = ?")
      .bind(access.id)
      .first<{ revision: number }>();
    if (
      revision?.revision !== workspace.revision ||
      latestAccess.securityRevision !== access.securityRevision ||
      latestAccess.role !== access.role
    )
      continue;
    return {
      noteId,
      generation: row.generation,
      update: encodeDocumentUpdate(update),
      stateVector: encodeDocumentUpdate(Y.encodeStateVectorFromUpdate(binary)),
      content: note.content,
      revision: workspace.revision,
      canEdit: canEditProject(latestAccess, note.projectId),
      peers,
    };
  }
  throw new WorkspaceError(
    "The note or its permissions changed while synchronization completed. Retry in a moment.",
    503,
  );
}

export async function readNoteCollaboration(
  request: Request,
): Promise<NoteCollaborationState> {
  const url = new URL(request.url);
  const noteId = identifier.safeParse(url.searchParams.get("note")),
    tab = identifier.safeParse(url.searchParams.get("tab"));
  if (!noteId.success || !tab.success)
    throw new WorkspaceError("Choose a valid shared note and browser tab.");
  return responseState(
    request,
    noteId.data,
    tab.data,
    url.searchParams.get("vector") || undefined,
    url.searchParams.get("generation") || undefined,
  );
}

export async function updateNoteCollaboration(
  request: Request,
  input: unknown,
): Promise<NoteCollaborationState> {
  assertSameOrigin(request);
  const parsed = updateInput.safeParse(input);
  if (!parsed.success)
    throw new WorkspaceError("The shared note update is invalid or too large.");
  const update = parsed.data,
    hash = await payloadHash(update);
  const restarting = "action" in update && update.action === "restart";
  let incoming: Uint8Array | null = null;
  try {
    if ("update" in update) incoming = decodeDocumentUpdate(update.update);
  } catch (cause) {
    throw new WorkspaceError(
      cause instanceof Error ? cause.message : "This note update is invalid.",
    );
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    const access = await resolveWorkspace(request),
      current = await readRawWorkspace(access);
    const note = checkedNote(access, current, update.noteId, true);
    const row = await documentFor(access, current, note.id);
    if (!row) continue;
    if (await hasReceipt(access, update.operationId, hash))
      return responseState(request, note.id, update.tabId);
    if (row.generation !== update.generation)
      throw new WorkspaceError(
        "This note was replaced or restored after your editing session began. Your unfinished text is kept; review the latest version before starting a new session.",
        409,
      );
    const doc = restarting ? createTextDocument(note.content) : new Y.Doc();
    let content: string, state: string;
    try {
      if (!restarting)
        Y.applyUpdate(doc, decodeDocumentUpdate(row.document_update));
      if (incoming) Y.applyUpdate(doc, incoming);
      content = documentText(doc);
      state = serializedDocument(doc);
    } catch (cause) {
      throw new WorkspaceError(
        cause instanceof Error
          ? cause.message
          : "The shared note update could not be read.",
      );
    } finally {
      doc.destroy();
    }
    if (!restarting && state === row.document_update)
      return responseState(request, note.id, update.tabId);
    const mutation: Mutation = {
      action: "upsert",
      entity: "notes",
      item: { id: note.id, content },
      base: { id: note.id, content: note.content },
      operationId: update.operationId,
    };
    if (!note.snapshots.length) {
      const latest = await latestSnapshot(access.id, note.id);
      if (latest) note.snapshots = [latest];
    }
    const updated = applyMutation(
      current,
      mutation,
      new Date().toISOString(),
      access.user ? `account_${access.user.id}` : "guest",
    );
    const contentHash = await payloadHash(content),
      now = new Date().toISOString(),
      nextGeneration = restarting ? crypto.randomUUID() : row.generation;
    if (
      await commitWorkspace(
        access,
        current,
        updated,
        update.operationId,
        hash,
        false,
        {},
        {
          mutation,
          skipNoteDocumentReset: true,
          additionalStatements: (committed, values) => [
            database()
              .prepare(
                `INSERT INTO note_collaboration (workspace_id,note_id,generation,document_update,content_hash,updated_at) SELECT ?,?,?,?,?,? WHERE ${committed} ON CONFLICT(workspace_id,note_id) DO UPDATE SET generation=excluded.generation,document_update=excluded.document_update,content_hash=excluded.content_hash,updated_at=excluded.updated_at`,
              )
              .bind(
                access.id,
                note.id,
                nextGeneration,
                state,
                contentHash,
                now,
                ...values,
              ),
          ],
        },
      )
    )
      return responseState(request, note.id, update.tabId);
  }
  throw new WorkspaceError(
    "Other edits arrived while your note was saving. Your text is kept; retry synchronization.",
    503,
  );
}
