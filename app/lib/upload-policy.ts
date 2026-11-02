import { env } from "cloudflare:workers";
import { database, type ResolvedWorkspace } from "./access-store";
import { assertWorkspaceWritable, permissionsSnapshotSQL } from "./permissions";
import { WorkspaceError } from "./workspace-model";

export const attachmentLimitBytes = 500 * 1024 * 1024;
const windowMilliseconds = 60_000;
const inventoryLeaseMilliseconds = 120_000;

async function admitUploads(
  access: ResolvedWorkspace,
  kind: "request" | "write",
  count: number,
  actorLimit: number,
  workspaceLimit: number,
) {
  assertWorkspaceWritable(access);
  if (!Number.isSafeInteger(count) || count < 0)
    throw new WorkspaceError("Choose a valid number of attachments.");
  if (!count) return;
  const now = Date.now();
  const authorization = permissionsSnapshotSQL(access);
  const actor = access.user ? `user:${access.user.id}` : "guest";
  for (const [key, limit] of [
    [`${kind}:actor:${actor}`, actorLimit],
    [`${kind}:workspace:${access.id}`, workspaceLimit],
  ] as const) {
    const accepted = await database()
      .prepare(
        `INSERT INTO upload_rate_limits (bucket_key, count, started_at)
        SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ?)
        AND (${authorization.sql}) AND ? <= ?
        ON CONFLICT(bucket_key) DO UPDATE SET
          count = CASE WHEN upload_rate_limits.started_at + ? <= ?
            THEN excluded.count ELSE upload_rate_limits.count + excluded.count END,
          started_at = CASE WHEN upload_rate_limits.started_at + ? <= ?
            THEN excluded.started_at ELSE upload_rate_limits.started_at END
        WHERE upload_rate_limits.started_at + ? <= ?
          OR upload_rate_limits.count <= ? - excluded.count
        RETURNING count`,
      )
      .bind(
        key,
        count,
        now,
        access.id,
        ...authorization.bindings,
        count,
        limit,
        windowMilliseconds,
        now,
        windowMilliseconds,
        now,
        windowMilliseconds,
        now,
        limit,
      )
      .first();
    if (!accepted) {
      const current = await database()
        .prepare(
          "SELECT started_at FROM upload_rate_limits WHERE bucket_key = ?",
        )
        .bind(key)
        .first<{ started_at: number }>();
      const error = new WorkspaceError(
        "Too many uploads. Wait a moment before trying again.",
        429,
      ) as WorkspaceError & { retryAfter: number };
      error.retryAfter = Math.max(
        1,
        Math.min(
          60,
          Math.ceil(
            ((current?.started_at ?? now) + windowMilliseconds - now) / 1000,
          ),
        ),
      );
      throw error;
    }
  }
}

/** Admission precedes body parsing; object writes have their own weighted limit. */
export async function admitUploadRequest(access: ResolvedWorkspace) {
  await admitUploads(access, "request", 1, 20, 60);
}

export async function admitUploadWrites(
  access: ResolvedWorkspace,
  count: number,
) {
  await admitUploads(access, "write", count, 500, 1500);
}

/** Inventory old/untracked files once, while new reservations fail closed. */
async function initializeInventory(access: ResolvedWorkspace) {
  const bucket = env.BUCKET;
  if (!bucket)
    throw new WorkspaceError("Attachment storage is unavailable.", 503);
  const db = database();
  const current = await db
    .prepare(
      "SELECT ready FROM upload_storage_inventory WHERE workspace_id = ?",
    )
    .bind(access.id)
    .first<{ ready: number }>();
  if (current?.ready === 1) return;
  const token = crypto.randomUUID(),
    now = Date.now();
  const authorization = permissionsSnapshotSQL(access);
  const claimed = await db
    .prepare(
      `INSERT INTO upload_storage_inventory (workspace_id, token, ready, started_at)
    SELECT ?, ?, 0, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ?)
    AND (${authorization.sql})
    ON CONFLICT(workspace_id) DO UPDATE SET token = excluded.token, started_at = excluded.started_at
    WHERE upload_storage_inventory.ready = 0 AND upload_storage_inventory.started_at <= ?`,
    )
    .bind(
      access.id,
      token,
      now,
      access.id,
      ...authorization.bindings,
      now - inventoryLeaseMilliseconds,
    )
    .run();
  if (!claimed.meta.changes)
    throw new WorkspaceError(
      "Attachment storage is being checked. Try uploading again shortly.",
      503,
    );
  const ownsInventory =
    "EXISTS (SELECT 1 FROM upload_storage_inventory WHERE workspace_id = ? AND token = ? AND ready = 0)";
  try {
    await db
      .prepare(
        `DELETE FROM upload_storage_objects WHERE workspace_id = ? AND ${ownsInventory}`,
      )
      .bind(access.id, access.id, token)
      .run();
    const canonical = `media/${access.id}/`;
    const legacyGuest = access.kind === "guest" && access.id === "main";
    const prefix = legacyGuest ? "media/" : canonical;
    let cursor: string | undefined;
    const cursors = new Set<string>();
    let complete = false;
    for (let page = 0; page < 100; page++) {
      const listing = await bucket.list({ prefix, cursor, limit: 1000 });
      const objects = listing.objects
        .filter(
          (object) =>
            object.key.startsWith(canonical) ||
            (legacyGuest && /^media\/[A-Za-z0-9_-]+$/.test(object.key)),
        )
        .map((object) => ({ key: object.key, bytes: object.size }));
      if (
        objects.some(
          (object) => !Number.isSafeInteger(object.bytes) || object.bytes < 0,
        )
      )
        throw new Error(
          "Attachment inventory contains an invalid object size.",
        );
      await db
        .prepare(
          `INSERT OR IGNORE INTO upload_storage_objects (workspace_id, object_key, bytes)
        SELECT ?, json_extract(value, '$.key'), json_extract(value, '$.bytes') FROM json_each(?)
        WHERE ${ownsInventory} AND NOT EXISTS (SELECT 1 FROM storage_media_purges p
          WHERE p.workspace_id = ? AND p.object_key = json_extract(value, '$.key') AND p.deleted_at IS NOT NULL)`,
        )
        .bind(access.id, JSON.stringify(objects), access.id, token, access.id)
        .run();
      if (!listing.truncated) {
        complete = true;
        break;
      }
      if (!listing.cursor || cursors.has(listing.cursor)) break;
      cursor = listing.cursor;
      cursors.add(cursor);
    }
    if (!complete) throw new Error("Attachment inventory did not finish.");
    const finished = await db
      .prepare(
        `UPDATE upload_storage_inventory SET ready = 1 WHERE workspace_id = ? AND token = ? AND ready = 0 AND (${authorization.sql})`,
      )
      .bind(access.id, token, ...authorization.bindings)
      .run();
    if (!finished.meta.changes)
      throw new Error("Attachment inventory ownership changed.");
  } catch {
    await db
      .prepare(
        "UPDATE upload_storage_inventory SET started_at = 0 WHERE workspace_id = ? AND token = ? AND ready = 0",
      )
      .bind(access.id, token)
      .run()
      .catch(() => undefined);
    throw new WorkspaceError(
      "Attachment storage could not be checked. Try uploading again shortly.",
      503,
    );
  }
}

/** One SQL statement serializes competing reservations; metadata cannot lower the charge. */
export async function reserveUploadBytes(
  access: ResolvedWorkspace,
  objectKey: string,
  bytes: number,
) {
  assertWorkspaceWritable(access);
  const prefix = `media/${access.id}/`;
  if (
    !objectKey.startsWith(prefix) ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(objectKey.slice(prefix.length)) ||
    !Number.isSafeInteger(bytes) ||
    bytes <= 0
  )
    throw new WorkspaceError("Choose a valid attachment to upload.");
  await initializeInventory(access);
  const authorization = permissionsSnapshotSQL(access);
  const accepted = await database()
    .prepare(
      `INSERT INTO upload_storage_objects (workspace_id, object_key, bytes)
    SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ?)
    AND (${authorization.sql})
    AND EXISTS (SELECT 1 FROM upload_storage_inventory WHERE workspace_id = ? AND ready = 1)
    AND EXISTS (SELECT 1 FROM media_objects WHERE workspace_id = ? AND object_key = ? AND state IN ('uploading', 'active'))
    AND NOT EXISTS (SELECT 1 FROM storage_media_purges WHERE workspace_id = ? AND object_key = ?)
    AND (EXISTS (SELECT 1 FROM upload_storage_objects WHERE workspace_id = ? AND object_key = ? AND bytes = ?)
      OR COALESCE((SELECT SUM(bytes) FROM upload_storage_objects WHERE workspace_id = ?), 0) <= ? - ?)
    ON CONFLICT(workspace_id, object_key) DO UPDATE SET bytes = upload_storage_objects.bytes
    WHERE upload_storage_objects.bytes = excluded.bytes RETURNING bytes`,
    )
    .bind(
      access.id,
      objectKey,
      bytes,
      access.id,
      ...authorization.bindings,
      access.id,
      access.id,
      objectKey,
      access.id,
      objectKey,
      access.id,
      objectKey,
      bytes,
      access.id,
      attachmentLimitBytes,
      bytes,
    )
    .first();
  if (!accepted)
    throw new WorkspaceError(
      "This workspace has reached its 500 MB attachment limit, or the upload has changed. Clean up unused files before uploading more.",
      413,
    );
}

/** Call only after the bucket deletion and its durable purge acknowledgement succeed. */
export async function releaseUploadBytes(
  workspaceId: string,
  objectKey: string,
) {
  await database()
    .prepare(
      `DELETE FROM upload_storage_objects WHERE workspace_id = ? AND object_key = ?
      AND EXISTS (SELECT 1 FROM storage_media_purges p WHERE p.workspace_id = upload_storage_objects.workspace_id
        AND p.object_key = upload_storage_objects.object_key AND p.deleted_at IS NOT NULL)`,
    )
    .bind(workspaceId, objectKey)
    .run();
}
