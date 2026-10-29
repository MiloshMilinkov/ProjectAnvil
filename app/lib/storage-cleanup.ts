import { env } from "cloudflare:workers";
import { z } from "zod";
import { database, type ResolvedWorkspace } from "./access-store";
import { referencedMediaIds } from "./media-store";
import { canManageWorkspace, permissionsSnapshotSQL } from "./permissions";
import { payloadHash } from "./workspace-journal";
import { WorkspaceError } from "./workspace-model";
import type { Workspace } from "./types";
export type { StorageReport } from "./media-store";

const reviewLifetime = 10 * 60_000;
const maximumItems = 1000;
const optionsSchema = z.object({
  retentionDays: z.union([z.literal(30), z.literal(90), z.literal(365)]),
  remove: z
    .object({ uploads: z.boolean(), trash: z.boolean(), history: z.boolean() })
    .strict(),
});
const previewSchema = optionsSchema.extend({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.string().datetime(),
});
export const cleanupRequestSchema = z.discriminatedUnion("action", [
  optionsSchema.extend({ action: z.literal("preview") }).strict(),
  z
    .object({
      action: z.literal("apply"),
      preview: previewSchema,
      confirmed: z.literal(true),
    })
    .strict(),
]);
type CleanupOptions = z.infer<typeof optionsSchema>;
interface TrashCandidate {
  id: string;
  title: string;
  deletedAt: string;
}
interface HistoryCandidate {
  noteId: string;
  id: string;
  savedAt: string;
  bytes: number;
}
interface UploadCandidate {
  id: string;
  name: string;
  key: string;
  bytes: number;
  createdAt: string;
  unreferencedAt: string | null;
  claimed: boolean;
}
export interface StorageCleanupPreview extends CleanupOptions {
  token: string;
  expiresAt: string;
  counts: {
    uploads: number;
    uploadBytes: number;
    trash: number;
    history: number;
    historyBytes: number;
  };
  items: {
    uploads: { id: string; name: string; bytes: number }[];
    trash: { id: string; title: string }[];
    history: { noteId: string; title: string; versions: number }[];
  };
  warnings: string[];
}
interface Selection {
  trash: TrashCandidate[];
  history: HistoryCandidate[];
  uploads: UploadCandidate[];
  warnings: string[];
}

function assertManager(access: ResolvedWorkspace) {
  if (!canManageWorkspace(access))
    throw new WorkspaceError(
      "Only workspace owners and admins can clean up storage.",
      403,
    );
  if (!env.BUCKET)
    throw new WorkspaceError("Media storage is unavailable.", 503);
}
const encodedTrash = (rows: TrashCandidate[]) =>
  JSON.stringify(rows.map((row) => row.id));
const encodedHistory = (rows: HistoryCandidate[]) =>
  JSON.stringify(rows.map((row) => [row.noteId, row.id]));

/** SQLite cannot decode arbitrary URL text. Keep uncertain encoded paths safely. */
function uncertainPathSQL(text: string, jsonEncoded = true) {
  const backslash = jsonEncoded ? "char(92) || char(92)" : "char(92)";
  return `((${text} GLOB '*%[0-9A-Fa-f][0-9A-Fa-f]*' AND
    (instr(${text}, '/') > 0 OR instr(lower(${text}), '%2f') > 0
      OR instr(lower(${text}), '%5c') > 0 OR instr(${text}, ${backslash}) > 0))
    OR instr(${text}, '/./') > 0 OR instr(${text}, '/../') > 0
    OR instr(${text}, 'api' || char(92)) > 0
    OR instr(${text}, char(92) || 'media' || char(92)) > 0)`;
}

/** Kept recovery records protect their attachments, including deleted canvas cards. */
function recoveryReferencesSQL(uncertainOnly = false) {
  const reference = (text: string, jsonEncoded = true) =>
    uncertainOnly
      ? uncertainPathSQL(text, jsonEncoded)
      : `(instr(${text}, 'api/media/' || candidate.media_id) > 0 OR ${uncertainPathSQL(text, jsonEncoded)})`;
  return `EXISTS (SELECT 1 FROM workspace_trash t WHERE t.workspace_id = ?
    AND t.trash_id NOT IN (SELECT value FROM json_each(?))
    AND (${reference("t.payload")}${uncertainOnly ? "" : ` OR instr(t.payload, '"entityId":"' || candidate.media_id || '"') > 0`}))
    OR EXISTS (SELECT 1 FROM note_history h WHERE h.workspace_id = ?
      AND NOT EXISTS (SELECT 1 FROM json_each(?) selected
        WHERE json_extract(selected.value, '$[0]') = h.note_id
        AND json_extract(selected.value, '$[1]') = h.snapshot_id)
      AND ${reference("h.content", false)})
    OR EXISTS (SELECT 1 FROM workrooms r WHERE r.workspace_id = ?
      AND ${reference("r.data")})
    OR EXISTS (SELECT 1 FROM personal_templates p
      WHERE ${reference("p.data")})`;
}

async function selectCleanup(
  access: ResolvedWorkspace,
  workspace: Workspace,
  options: CleanupOptions,
  expiresAt: string,
): Promise<Selection> {
  assertManager(access);
  const db = database();
  const cutoff = new Date(
    Date.parse(expiresAt) - reviewLifetime - options.retentionDays * 86_400_000,
  ).toISOString();
  const selection: Selection = {
    trash: [],
    history: [],
    uploads: [],
    warnings: [],
  };
  let remaining = maximumItems;
  if (options.remove.trash) {
    const rows = await db
      .prepare(
        `SELECT trash_id AS id, title, deleted_at AS deletedAt
      FROM workspace_trash WHERE workspace_id = ? AND deleted_at < ? AND julianday(deleted_at) IS NOT NULL
      ORDER BY deleted_at, trash_id LIMIT ?`,
      )
      .bind(access.id, cutoff, remaining + 1)
      .all<TrashCandidate>();
    selection.trash = rows.results.slice(0, remaining);
    if (rows.results.length > remaining)
      selection.warnings.push(
        "This review includes the first 1,000 eligible records. Review again after cleanup for the rest.",
      );
    remaining -= selection.trash.length;
  }
  if (options.remove.history) {
    const rows = await db
      .prepare(
        `SELECT h.note_id AS noteId, h.snapshot_id AS id, h.saved_at AS savedAt,
      length(CAST(h.content AS BLOB)) AS bytes FROM note_history h
      WHERE h.workspace_id = ? AND h.saved_at < ? AND julianday(h.saved_at) IS NOT NULL
      AND EXISTS (SELECT 1 FROM note_history newer WHERE newer.workspace_id = h.workspace_id
        AND newer.note_id = h.note_id AND (newer.saved_at > h.saved_at
          OR (newer.saved_at = h.saved_at AND newer.snapshot_id > h.snapshot_id)))
      ORDER BY h.saved_at, h.note_id, h.snapshot_id LIMIT ?`,
      )
      .bind(access.id, cutoff, remaining + 1)
      .all<HistoryCandidate>();
    selection.history = rows.results.slice(0, remaining);
    if (rows.results.length > remaining)
      selection.warnings.push(
        "More saved versions remain outside this review. Review again after cleanup to continue.",
      );
    remaining -= selection.history.length;
    selection.warnings.push(
      "The newest saved version of every note is kept, including deleted notes.",
    );
  }
  if (options.remove.uploads) {
    const protectedIds = referencedMediaIds(workspace);
    for (const file of workspace.media) protectedIds.add(file.id);
    const recoveryBindings = [
      access.id,
      encodedTrash(selection.trash),
      access.id,
      encodedHistory(selection.history),
      access.id,
    ];
    // Filter before the limit: kept files must not hide later eligible uploads.
    // Pending claims stay first, and only this bounded result needs bucket reads.
    const rows = await db
      .prepare(
        `WITH candidate AS (
      SELECT media_id, object_key, claimed_at AS created_at,
        NULL AS unreferenced_at, 1 AS claimed, claimed_at AS sort_at
      FROM storage_media_purges WHERE workspace_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT m.media_id, m.object_key, m.created_at, m.unreferenced_at,
        0 AS claimed, COALESCE(m.unreferenced_at, m.created_at) AS sort_at
      FROM media_objects m WHERE m.workspace_id = ? AND m.state = 'retained'
        AND COALESCE(m.unreferenced_at, m.created_at) < ?
        AND julianday(COALESCE(m.unreferenced_at, m.created_at)) IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM storage_media_purges p
          WHERE p.workspace_id = m.workspace_id AND p.media_id = m.media_id)
      ) SELECT media_id AS id, object_key AS key, created_at AS createdAt,
        unreferenced_at AS unreferencedAt, claimed FROM candidate
      WHERE (object_key = 'media/' || ? || '/' || media_id
        OR (? AND object_key = 'media/' || media_id))
        AND media_id NOT IN (SELECT value FROM json_each(?))
        AND NOT (${recoveryReferencesSQL()})
      ORDER BY claimed DESC, sort_at, media_id LIMIT ?`,
      )
      .bind(
        access.id,
        access.id,
        cutoff,
        access.id,
        access.kind === "guest" && access.id === "main" ? 1 : 0,
        JSON.stringify([...protectedIds]),
        ...recoveryBindings,
        remaining + 1,
      )
      .all<
        Omit<UploadCandidate, "name" | "bytes" | "claimed"> & {
          claimed: number;
        }
      >();
    const eligible = rows.results.map((row) => ({
      ...row,
      claimed: row.claimed === 1,
    }));
    const uncertain = await db
      .prepare(`SELECT (${recoveryReferencesSQL(true)}) AS found`)
      .bind(...recoveryBindings)
      .first<{ found: number }>();
    if (uncertain?.found)
      selection.warnings.push(
        "Some kept recovery records contain encoded file paths or paths that need normalization. Unused uploads are preserved because those references cannot be checked with certainty. Use ordinary attachment links before reviewing uploads again.",
      );
    for (
      let start = 0;
      start < Math.min(eligible.length, remaining);
      start += 20
    ) {
      const batch = eligible.slice(start, Math.min(start + 20, remaining));
      selection.uploads.push(
        ...(await Promise.all(
          batch.map(async (row) => {
            const metadata = await env.BUCKET!.head(row.key);
            return {
              ...row,
              name:
                metadata?.customMetadata?.name?.slice(0, 240) ||
                "Unused upload",
              bytes: metadata?.size || 0,
            };
          }),
        )),
      );
    }
    if (eligible.length > remaining)
      selection.warnings.push(
        "The upload scan reached its review limit. More files may be eligible in a later review.",
      );
    selection.warnings.push(
      "Current attachments, linked recovery files, uploads still in progress, and files with unknown age are kept. Device drafts and external backups are not checked.",
    );
    if (selection.uploads.some((row) => row.claimed))
      selection.warnings.push(
        "Previously confirmed file deletions that did not finish are included for retry.",
      );
  }
  return selection;
}

async function selectionToken(
  access: ResolvedWorkspace,
  workspace: Workspace,
  options: CleanupOptions,
  expiresAt: string,
  selection: Selection,
) {
  return payloadHash({
    workspaceId: access.id,
    revision: workspace.revision,
    securityRevision: access.securityRevision || 0,
    options,
    expiresAt,
    trash: selection.trash,
    history: selection.history,
    uploads: selection.uploads,
  });
}

export async function previewStorageCleanup(
  access: ResolvedWorkspace,
  workspace: Workspace,
  input: CleanupOptions,
): Promise<StorageCleanupPreview> {
  const options = optionsSchema.parse(input);
  if (!Object.values(options.remove).some(Boolean))
    throw new WorkspaceError(
      "Choose at least one kind of recovery data to review.",
    );
  const expiresAt = new Date(Date.now() + reviewLifetime).toISOString();
  const selection = await selectCleanup(access, workspace, options, expiresAt);
  const history = new Map<string, number>();
  for (const row of selection.history)
    history.set(row.noteId, (history.get(row.noteId) || 0) + 1);
  return {
    ...options,
    expiresAt,
    token: await selectionToken(
      access,
      workspace,
      options,
      expiresAt,
      selection,
    ),
    counts: {
      uploads: selection.uploads.length,
      uploadBytes: selection.uploads.reduce((sum, row) => sum + row.bytes, 0),
      trash: selection.trash.length,
      history: selection.history.length,
      historyBytes: selection.history.reduce((sum, row) => sum + row.bytes, 0),
    },
    items: {
      uploads: selection.uploads.slice(0, 50).map((row) => ({
        id: row.id,
        name: row.name,
        bytes: row.bytes,
      })),
      trash: selection.trash
        .slice(0, 50)
        .map(({ id, title }) => ({ id, title })),
      history: [...history].slice(0, 50).map(([noteId, versions]) => ({
        noteId,
        title:
          workspace.notes.find((note) => note.id === noteId)?.title ||
          "Deleted note",
        versions,
      })),
    },
    warnings: selection.warnings,
  };
}

export async function applyStorageCleanup(
  access: ResolvedWorkspace,
  workspace: Workspace,
  input: z.infer<typeof previewSchema>,
) {
  assertManager(access);
  const preview = previewSchema.parse(input);
  const expiry = Date.parse(preview.expiresAt);
  if (expiry <= Date.now() || expiry > Date.now() + reviewLifetime)
    throw new WorkspaceError(
      "This cleanup review expired. Review storage again before deleting anything.",
      409,
    );
  const options = optionsSchema.parse(preview);
  const selection = await selectCleanup(
    access,
    workspace,
    options,
    preview.expiresAt,
  );
  if (
    (await selectionToken(
      access,
      workspace,
      options,
      preview.expiresAt,
      selection,
    )) !== preview.token
  )
    throw new WorkspaceError(
      "Storage changed after this review. Review it again before deleting anything.",
      409,
    );
  const db = database();
  const authorization = permissionsSnapshotSQL(access);
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const trash = encodedTrash(selection.trash),
    history = encodedHistory(selection.history);
  const newUploads = selection.uploads.filter((row) => !row.claimed);
  const uploadedIds = JSON.stringify(selection.uploads.map((row) => row.id));
  // Claims, archive deletion and revision advance are one transaction. Workspace
  // writes reject claimed IDs before an idempotent bucket delete can start.
  const guard =
    "EXISTS (SELECT 1 FROM workspace_write_guards WHERE workspace_id = ? AND token = ?)";
  const guardValues = [access.id, token];
  const results = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO workspace_write_guards (workspace_id, token)
      SELECT ?, ? FROM workspaces w WHERE w.id = ? AND w.revision = ? AND (${authorization.sql})
      AND NOT EXISTS (SELECT 1 FROM (SELECT value AS media_id FROM json_each(?)) candidate
        WHERE ${recoveryReferencesSQL()})
      AND NOT EXISTS (SELECT 1 FROM json_each(?) selected
        WHERE NOT EXISTS (SELECT 1 FROM media_objects m WHERE m.workspace_id = ?
          AND m.media_id = json_extract(selected.value, '$.id') AND m.state = 'retained'
          AND m.object_key = json_extract(selected.value, '$.key')
          AND m.created_at = json_extract(selected.value, '$.createdAt')
          AND m.unreferenced_at IS json_extract(selected.value, '$.unreferencedAt')))`,
      )
      .bind(
        access.id,
        token,
        access.id,
        workspace.revision,
        ...authorization.bindings,
        uploadedIds,
        access.id,
        trash,
        access.id,
        history,
        access.id,
        JSON.stringify(newUploads),
        access.id,
      ),
    db
      .prepare(
        `UPDATE workspaces SET revision = revision + 1,
      data = json_set(data, '$.revision', revision + 1), updated_at = ? WHERE id = ? AND ${guard}`,
      )
      .bind(now, access.id, ...guardValues),
    db
      .prepare(
        `INSERT OR IGNORE INTO storage_media_purges (workspace_id, media_id, object_key, claimed_at)
      SELECT ?, json_extract(value, '$.id'), json_extract(value, '$.key'), ? FROM json_each(?) WHERE ${guard}`,
      )
      .bind(access.id, now, JSON.stringify(newUploads), ...guardValues),
    db
      .prepare(
        `DELETE FROM workspace_trash WHERE workspace_id = ?
      AND trash_id IN (SELECT value FROM json_each(?)) AND ${guard}`,
      )
      .bind(access.id, trash, ...guardValues),
    db
      .prepare(
        `DELETE FROM note_history WHERE workspace_id = ? AND EXISTS (SELECT 1 FROM json_each(?) selected
      WHERE json_extract(selected.value, '$[0]') = note_history.note_id
      AND json_extract(selected.value, '$[1]') = note_history.snapshot_id) AND ${guard}`,
      )
      .bind(access.id, history, ...guardValues),
    db
      .prepare(
        `DELETE FROM media_objects WHERE workspace_id = ?
      AND media_id IN (SELECT value FROM json_each(?)) AND ${guard}`,
      )
      .bind(access.id, uploadedIds, ...guardValues),
    db
      .prepare(
        "DELETE FROM workspace_write_guards WHERE workspace_id = ? AND token = ?",
      )
      .bind(...guardValues),
  ]);
  if (results[1].meta.changes !== 1)
    throw new WorkspaceError(
      "Storage or workspace access changed. Review cleanup again before deleting anything.",
      409,
    );
  let removedUploads = 0;
  for (let start = 0; start < selection.uploads.length; start += 10) {
    await Promise.allSettled(
      selection.uploads.slice(start, start + 10).map(async (row) => {
        await env.BUCKET!.delete(row.key);
        await db
          .prepare(
            "UPDATE storage_media_purges SET deleted_at = ? WHERE workspace_id = ? AND media_id = ?",
          )
          .bind(new Date().toISOString(), access.id, row.id)
          .run();
        removedUploads++;
      }),
    );
  }
  const pendingUploads = selection.uploads.length - removedUploads;
  return {
    removed: {
      uploads: removedUploads,
      trash: results[3].meta.changes || 0,
      history: results[4].meta.changes || 0,
    },
    pendingUploads,
    message: pendingUploads
      ? "Recovery records were cleaned up. Some file deletions could not finish; review uploads again to retry them."
      : "Cleanup finished. Current workspace items were kept.",
  };
}
