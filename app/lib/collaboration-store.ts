import { z } from "zod";
import {
  assertSameOrigin,
  canManageWorkspace,
  canReadProject,
  database,
  filterWorkspaceForAccess,
  permissionsSnapshotSQL,
  resolveWorkspace,
  type ResolvedWorkspace,
} from "./access-store";
import { canReadEntity } from "./permissions";
import { WorkspaceError } from "./workspace-model";
import type { AccountUser, WorkspaceRole } from "./access-types";
import type { Entity, EntityRef, Mutation, Workspace } from "./types";
import type {
  ActivityEntry,
  ActivityPage,
  NotificationPage,
  WatchState,
} from "./collaboration-types";
import { prepareActivity, referenceFor } from "./collaboration-model";

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/);
const watchInput = z
  .object({
    type: z.enum(["note", "task", "project"]),
    id: identifier,
    watching: z.boolean(),
  })
  .strict();
const notificationInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), id: identifier }).strict(),
  z.object({ action: z.literal("read-all") }).strict(),
]);
interface ActivityRow {
  seq: number;
  id: string;
  workspace_id: string;
  revision: number;
  actor_id: string;
  actor_name: string;
  entity_type: Entity | "workspace";
  entity_id: string;
  project_id: string;
  title: string;
  action: ActivityEntry["action"];
  fields_json: string;
  created_at: string;
}
interface NotificationRow extends ActivityRow {
  notification_id: string;
  reason: "mention" | "watch";
  read_at: string | null;
  notified_at: string;
}
type WatcherRow = {
  user_id: string;
  entity_type: EntityRef["type"];
  entity_id: string;
};

async function storedWorkspace(access: ResolvedWorkspace): Promise<Workspace> {
  const row = await database()
    .prepare("SELECT data, revision FROM workspaces WHERE id = ?")
    .bind(access.id)
    .first<{ data: string; revision: number }>();
  if (!row)
    throw new WorkspaceError("This workspace is no longer available.", 404);
  const workspace = JSON.parse(row.data) as Workspace;
  workspace.relationships ??= [];
  workspace.noteTypes ??= [];
  workspace.relationshipPresets ??= [];
  workspace.brainstorms ??= [];
  workspace.revision = row.revision;
  return workspace;
}
function collection(type: EntityRef["type"]): "notes" | "tasks" | "projects" {
  return type === "note" ? "notes" : type === "task" ? "tasks" : "projects";
}
function requireVisibleReference(
  access: ResolvedWorkspace,
  workspace: Workspace,
  reference: EntityRef,
) {
  const visible = filterWorkspaceForAccess(access, workspace);
  const item = visible[collection(reference.type)].find(
    (item) => item.id === reference.id,
  );
  if (!item)
    throw new WorkspaceError(
      "This item is no longer available to your account.",
      404,
    );
  return item;
}
function visibleEvent(
  access: ResolvedWorkspace,
  workspace: Workspace,
  visible: Workspace,
  row: ActivityRow,
): boolean {
  if (row.entity_type === "workspace") return true;
  if (
    row.project_id &&
    (!canReadProject(access, row.project_id) ||
      (!workspace.projects.some((project) => project.id === row.project_id) &&
        !canManageWorkspace(access)))
  )
    return false;
  const saved = workspace[row.entity_type]?.some(
    (item) => item.id === row.entity_id,
  );
  if (saved)
    return !!visible[row.entity_type]?.some(
      (item) => item.id === row.entity_id,
    );
  if (
    (row.entity_type === "media" || row.entity_type === "projects") &&
    !canManageWorkspace(access)
  )
    return false;
  return true;
}
function publicEntry(row: ActivityRow, visible: Workspace): ActivityEntry {
  let fields: unknown;
  try {
    fields = JSON.parse(row.fields_json);
  } catch {
    fields = [];
  }
  const reference = referenceFor(row.entity_type, row.entity_id);
  const present =
    reference &&
    visible[collection(reference.type)].some(
      (item) => item.id === reference.id,
    );
  return {
    id: row.id,
    sequence: row.seq,
    actor: row.actor_name,
    entity: row.entity_type,
    entityId: row.entity_id,
    projectId: row.project_id,
    title: row.title,
    action: row.action,
    fields: Array.isArray(fields)
      ? fields
          .filter((field): field is string => typeof field === "string")
          .slice(0, 25)
      : [],
    createdAt: row.created_at,
    revision: row.revision,
    ...(present ? { reference } : {}),
  };
}
function limitFrom(url: URL): number {
  const value = url.searchParams.get("limit") || "30";
  if (!/^\d{1,2}$/.test(value) || Number(value) < 1 || Number(value) > 50)
    throw new WorkspaceError("Choose a page size from 1 to 50.");
  return Number(value);
}

/** Scope and current project permissions are checked before exposing historical titles. */
export async function readActivity(
  request: Request,
  retry = 0,
): Promise<ActivityPage> {
  const access = await resolveWorkspace(request),
    workspace = await storedWorkspace(access),
    visible = filterWorkspaceForAccess(access, workspace);
  const url = new URL(request.url),
    limit = limitFrom(url),
    cursor = url.searchParams.get("cursor"),
    project = url.searchParams.get("project") || "";
  if (cursor && !/^[1-9]\d{0,14}$/.test(cursor))
    throw new WorkspaceError("Choose a valid activity cursor.");
  if (
    project &&
    (!identifier.safeParse(project).success ||
      !visible.projects.some((item) => item.id === project))
  )
    throw new WorkspaceError("This project is no longer available.", 404);
  const rows = await database()
    .prepare(
      `SELECT * FROM workspace_activity WHERE workspace_id = ?${cursor ? " AND seq < ?" : ""}${project ? " AND project_id = ?" : ""} ORDER BY seq DESC LIMIT 201`,
    )
    .bind(
      access.id,
      ...(cursor ? [Number(cursor)] : []),
      ...(project ? [project] : []),
    )
    .all<ActivityRow>();
  const entries: ActivityEntry[] = [];
  let scanned = 0;
  for (const row of rows.results) {
    scanned++;
    if (visibleEvent(access, workspace, visible, row))
      entries.push(publicEntry(row, visible));
    if (entries.length === limit) break;
  }
  const nextCursor =
    (scanned < rows.results.length || rows.results.length === 201) && scanned
      ? String(rows.results[scanned - 1].seq)
      : null;
  // Re-resolve after reads so an account switch or revoked membership cannot return a stale feed.
  const latest = await resolveWorkspace(request);
  if (latest.securityRevision !== access.securityRevision) {
    if (retry)
      throw new WorkspaceError(
        "Your access changed. Refresh activity to see the latest permitted updates.",
        409,
      );
    return readActivity(request, retry + 1);
  }
  return { entries, nextCursor };
}

export async function readWatch(request: Request): Promise<WatchState> {
  const access = await resolveWorkspace(request);
  if (!access.user) return { available: false, watching: false };
  const url = new URL(request.url),
    parsed = watchInput.omit({ watching: true }).safeParse({
      type: url.searchParams.get("type"),
      id: url.searchParams.get("id"),
    });
  if (!parsed.success)
    throw new WorkspaceError("Choose a valid note, task, or project to watch.");
  requireVisibleReference(access, await storedWorkspace(access), parsed.data);
  const row = await database()
    .prepare(
      "SELECT 1 AS watching FROM workspace_watchers WHERE workspace_id = ? AND user_id = ? AND entity_type = ? AND entity_id = ?",
    )
    .bind(access.id, access.user.id, parsed.data.type, parsed.data.id)
    .first();
  const latest = await resolveWorkspace(request);
  if (latest.securityRevision !== access.securityRevision)
    throw new WorkspaceError(
      "Your access changed. Refresh this item before watching it.",
      409,
    );
  return { available: true, watching: !!row };
}

/** Watching is personal and does not grant access or allow editing. */
export async function changeWatch(
  request: Request,
  input: unknown,
): Promise<WatchState> {
  assertSameOrigin(request);
  const action = watchInput.safeParse(input);
  if (!action.success)
    throw new WorkspaceError("Choose a valid item and watch preference.");
  const access = await resolveWorkspace(request);
  if (!access.user) throw new WorkspaceError("Sign in to watch updates.", 401);
  if (action.data.watching)
    requireVisibleReference(access, await storedWorkspace(access), action.data);
  const guard = permissionsSnapshotSQL(access),
    db = database();
  if (action.data.watching) {
    const existing = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM workspace_watchers WHERE workspace_id = ? AND user_id = ?",
      )
      .bind(access.id, access.user.id)
      .first<{ count: number }>();
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO workspace_watchers (workspace_id,user_id,entity_type,entity_id,created_at) SELECT ?,?,?,?,? WHERE (${guard.sql}) AND ((SELECT COUNT(*) FROM workspace_watchers WHERE workspace_id = ? AND user_id = ?) < 500)`,
      )
      .bind(
        access.id,
        access.user.id,
        action.data.type,
        action.data.id,
        new Date().toISOString(),
        ...guard.bindings,
        access.id,
        access.user.id,
      )
      .run();
    const saved = await db
      .prepare(
        "SELECT 1 FROM workspace_watchers WHERE workspace_id = ? AND user_id = ? AND entity_type = ? AND entity_id = ?",
      )
      .bind(access.id, access.user.id, action.data.type, action.data.id)
      .first();
    if (!saved) {
      if ((existing?.count || 0) >= 500)
        throw new WorkspaceError(
          "You can watch up to 500 items in a workspace. Unwatch another item first.",
        );
      if (!result.meta.changes)
        throw new WorkspaceError(
          "Your access changed. Refresh before watching this item.",
          409,
        );
    }
  } else {
    await db
      .prepare(
        `DELETE FROM workspace_watchers WHERE workspace_id = ? AND user_id = ? AND entity_type = ? AND entity_id = ? AND (${guard.sql})`,
      )
      .bind(
        access.id,
        access.user.id,
        action.data.type,
        action.data.id,
        ...guard.bindings,
      )
      .run();
  }
  const latest = await resolveWorkspace(request);
  if (action.data.watching)
    requireVisibleReference(latest, await storedWorkspace(latest), action.data);
  if (latest.securityRevision !== access.securityRevision)
    throw new WorkspaceError(
      "Your access changed. Refresh before changing this watch preference.",
      409,
    );
  return { available: true, watching: action.data.watching };
}

export async function readNotifications(
  request: Request,
  retry = 0,
): Promise<NotificationPage> {
  const access = await resolveWorkspace(request);
  if (!access.user)
    return { entries: [], nextCursor: null, unreadCount: 0, available: false };
  const url = new URL(request.url),
    limit = limitFrom(url),
    cursor = url.searchParams.get("cursor"),
    unread = url.searchParams.get("unread") === "true";
  if (cursor && !identifier.safeParse(cursor).success)
    throw new WorkspaceError("Choose a valid notification cursor.");
  const workspace = await storedWorkspace(access),
    visible = filterWorkspaceForAccess(access, workspace);
  const rows = await database()
    .prepare(
      `SELECT a.*, n.id AS notification_id,n.reason,n.read_at,n.created_at AS notified_at FROM workspace_notifications n JOIN workspace_activity a ON a.workspace_id = n.workspace_id AND a.id = n.activity_id WHERE n.workspace_id = ? AND n.user_id = ? ORDER BY n.created_at DESC,n.id DESC LIMIT 1000`,
    )
    .bind(access.id, access.user.id)
    .all<NotificationRow>();
  const permitted = rows.results.filter((row) =>
    visibleEvent(access, workspace, visible, row),
  );
  const unreadCount = permitted.filter((row) => !row.read_at).length;
  const filtered = permitted.filter((row) => !unread || !row.read_at);
  const anchor = cursor
    ? filtered.findIndex((row) => row.notification_id === cursor)
    : -1;
  if (cursor && anchor < 0)
    throw new WorkspaceError(
      "Notifications changed. Refresh this list to see the latest updates.",
      409,
    );
  const slice = filtered.slice(anchor + 1, anchor + 1 + limit);
  const latest = await resolveWorkspace(request);
  if (latest.securityRevision !== access.securityRevision) {
    if (retry)
      throw new WorkspaceError(
        "Your access changed. Refresh notifications to see the latest permitted updates.",
        409,
      );
    return readNotifications(request, retry + 1);
  }
  return {
    available: true,
    unreadCount,
    entries: slice.map((row) => ({
      id: row.notification_id,
      reason: row.reason,
      read: !!row.read_at,
      createdAt: row.notified_at,
      activity: publicEntry(row, visible),
    })),
    nextCursor:
      anchor + 1 + limit < filtered.length
        ? slice.at(-1)?.notification_id || null
        : null,
  };
}

export async function changeNotifications(
  request: Request,
  input: unknown,
): Promise<void> {
  assertSameOrigin(request);
  const parsed = notificationInput.safeParse(input);
  if (!parsed.success)
    throw new WorkspaceError("Choose a valid notification action.");
  const access = await resolveWorkspace(request);
  if (!access.user)
    throw new WorkspaceError("Sign in to manage notifications.", 401);
  const guard = permissionsSnapshotSQL(access);
  await database()
    .prepare(
      `UPDATE workspace_notifications SET read_at = COALESCE(read_at,?) WHERE workspace_id = ? AND user_id = ?${parsed.data.action === "read" ? " AND id = ?" : ""} AND (${guard.sql})`,
    )
    .bind(
      new Date().toISOString(),
      access.id,
      access.user.id,
      ...(parsed.data.action === "read" ? [parsed.data.id] : []),
      ...guard.bindings,
    )
    .run();
  const latest = await resolveWorkspace(request);
  if (latest.securityRevision !== access.securityRevision)
    throw new WorkspaceError(
      "Your access changed. Refresh before marking notifications read.",
      409,
    );
}

/** Append these statements before releasing the existing workspace commit guard. */
export async function prepareCollaborationStatements(
  access: ResolvedWorkspace,
  current: Workspace,
  updated: Workspace,
  committed: string,
  guardValues: unknown[],
  _operationId?: string,
  mutation?: Mutation,
): Promise<D1PreparedStatement[]> {
  const db = database(),
    now = new Date().toISOString();
  const members = access.user
    ? (
        await db
          .prepare(
            "SELECT u.id,u.username,CASE WHEN m.role='owner' THEN 'owner' ELSE COALESCE(r.role,'editor') END AS role FROM appmembers m JOIN user u ON u.id = m.user_id LEFT JOIN appmember_roles r ON r.workspace_id=m.workspace_id AND r.user_id=m.user_id WHERE m.workspace_id = ?",
          )
          .bind(access.id)
          .all<{ id: string; username: string; role: WorkspaceRole }>()
      ).results
    : [];
  const usernames = new Map(
    members.map((member) => [member.username.toLowerCase(), member.id]),
  );
  const prepared = prepareActivity(
    current,
    updated,
    { id: access.user?.id || "guest", name: access.user?.username || "Guest" },
    usernames,
    mutation,
    now,
  );
  const events = [] as ReturnType<typeof prepareActivity>;
  for (const event of prepared) {
    // Continuous text autosaves share a short activity interval. New mentions
    // and other fields are always recorded immediately.
    if (
      event.entity === "notes" &&
      event.action === "updated" &&
      event.fields.length === 1 &&
      event.fields[0] === "Text" &&
      !event.mentions.length
    ) {
      const recent = await db
        .prepare(
          "SELECT created_at FROM workspace_activity WHERE workspace_id=? AND actor_id=? AND entity_type='notes' AND entity_id=? AND fields_json='[\"Text\"]' ORDER BY seq DESC LIMIT 1",
        )
        .bind(access.id, event.actorId, event.entityId)
        .first<{ created_at: string }>();
      if (recent && Date.parse(recent.created_at) > Date.now() - 30_000)
        continue;
    }
    events.push(event);
  }
  if (!events.length) return [];
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT OR IGNORE INTO workspace_activity (id,workspace_id,revision,actor_id,actor_name,entity_type,entity_id,project_id,title,action,fields_json,created_at) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.revision'),json_extract(value,'$.actorId'),json_extract(value,'$.actor'),json_extract(value,'$.entity'),json_extract(value,'$.entityId'),json_extract(value,'$.projectId'),json_extract(value,'$.title'),json_extract(value,'$.action'),json_extract(value,'$.fields'),json_extract(value,'$.createdAt') FROM json_each(?) WHERE ${committed}`,
      )
      .bind(access.id, JSON.stringify(events), ...guardValues),
  ];
  if (access.user && mutation?.action !== "import") {
    const watchTargets = events.flatMap((event) => {
      const reference = referenceFor(event.entity, event.entityId);
      return [
        ...(reference ? [reference] : []),
        ...(event.projectId ? [{ type: "project", id: event.projectId }] : []),
      ];
    });
    const watchers = (
      await db
        .prepare(
          "SELECT user_id,entity_type,entity_id FROM workspace_watchers WHERE workspace_id = ? AND EXISTS(SELECT 1 FROM json_each(?) target WHERE json_extract(target.value,'$.type')=entity_type AND json_extract(target.value,'$.id')=entity_id)",
        )
        .bind(access.id, JSON.stringify(watchTargets))
        .all<WatcherRow>()
    ).results;
    const active = new Map(members.map((member) => [member.id, member]));
    const candidates = new Set<string>(
      events.flatMap((event) => event.mentions),
    );
    for (const watcher of watchers) candidates.add(watcher.user_id);
    candidates.delete(access.user.id);
    const permitted = new Map<string, ResolvedWorkspace>();
    for (const userId of candidates) {
      const member = active.get(userId);
      if (!member) continue;
      const user: AccountUser = {
        id: member.id,
        username: member.username,
        name: member.username,
        email: "",
      };
      // Roles come from current membership SQL; the entire batch is guarded
      // by this same security revision, including changes to recipients.
      permitted.set(userId, { ...access, user, role: member.role });
    }
    const notices: {
      id: string;
      userId: string;
      activityId: string;
      entity: string;
      entityId: string;
      reason: "mention" | "watch";
      createdAt: string;
    }[] = [];
    for (const event of events) {
      const reference = referenceFor(event.entity, event.entityId);
      if (!reference) continue;
      const recipients = new Map<string, "mention" | "watch">();
      for (const watcher of watchers)
        if (
          (watcher.entity_type === reference.type &&
            watcher.entity_id === reference.id) ||
          (watcher.entity_type === "project" &&
            !!event.projectId &&
            watcher.entity_id === event.projectId)
        )
          recipients.set(watcher.user_id, "watch");
      for (const userId of event.mentions) recipients.set(userId, "mention");
      for (const [userId, reason] of recipients) {
        const recipient = permitted.get(userId);
        if (
          !recipient ||
          !canReadEntity(
            recipient,
            event.action === "deleted" ? current : updated,
            reference,
          )
        )
          continue;
        notices.push({
          id: crypto.randomUUID(),
          userId,
          activityId: event.id,
          entity: reference.type,
          entityId: reference.id,
          reason,
          createdAt: now,
        });
      }
    }
    if (notices.length)
      statements.push(
        db
          .prepare(
            `INSERT INTO workspace_notifications (id,workspace_id,user_id,activity_id,entity_type,entity_id,reason,created_at,last_notified_at,read_at)
      SELECT json_extract(value,'$.id'),?,json_extract(value,'$.userId'),json_extract(value,'$.activityId'),json_extract(value,'$.entity'),json_extract(value,'$.entityId'),json_extract(value,'$.reason'),json_extract(value,'$.createdAt'),json_extract(value,'$.createdAt'),NULL FROM json_each(?) WHERE ${committed}
      ON CONFLICT(workspace_id,user_id,entity_type,entity_id,reason) DO UPDATE SET activity_id=excluded.activity_id,created_at=excluded.created_at,
      read_at=CASE WHEN excluded.reason='mention' OR workspace_notifications.read_at IS NULL OR workspace_notifications.last_notified_at <= ? THEN NULL ELSE workspace_notifications.read_at END,
      last_notified_at=CASE WHEN excluded.reason='mention' OR workspace_notifications.read_at IS NULL OR workspace_notifications.last_notified_at <= ? THEN excluded.created_at ELSE workspace_notifications.last_notified_at END`,
          )
          .bind(
            access.id,
            JSON.stringify(notices),
            ...guardValues,
            new Date(Date.now() - 300_000).toISOString(),
            new Date(Date.now() - 300_000).toISOString(),
          ),
      );
  }
  const removedReferences = (["notes", "tasks", "projects"] as const).flatMap(
    (entity) => {
      const remaining = new Set(updated[entity].map((item) => item.id));
      return current[entity]
        .filter((item) => !remaining.has(item.id))
        .map((item) => referenceFor(entity, item.id)!);
    },
  );
  if (removedReferences.length)
    statements.push(
      db
        .prepare(
          `DELETE FROM workspace_watchers WHERE workspace_id=? AND EXISTS(SELECT 1 FROM json_each(?) target WHERE json_extract(target.value,'$.type')=entity_type AND json_extract(target.value,'$.id')=entity_id) AND ${committed}`,
        )
        .bind(access.id, JSON.stringify(removedReferences), ...guardValues),
    );
  statements.push(
    db
      .prepare(
        `DELETE FROM workspace_activity WHERE workspace_id = ? AND seq NOT IN (SELECT seq FROM workspace_activity WHERE workspace_id = ? ORDER BY seq DESC LIMIT 10000) AND ${committed}`,
      )
      .bind(access.id, access.id, ...guardValues),
    db
      .prepare(
        `DELETE FROM workspace_notifications WHERE workspace_id = ? AND (NOT EXISTS(SELECT 1 FROM workspace_activity WHERE workspace_activity.id=workspace_notifications.activity_id AND workspace_activity.workspace_id=workspace_notifications.workspace_id) OR id NOT IN (SELECT recent.id FROM workspace_notifications recent WHERE recent.workspace_id=workspace_notifications.workspace_id AND recent.user_id=workspace_notifications.user_id ORDER BY recent.created_at DESC,recent.id DESC LIMIT 1000)) AND ${committed}`,
      )
      .bind(access.id, ...guardValues),
  );
  return statements;
}
