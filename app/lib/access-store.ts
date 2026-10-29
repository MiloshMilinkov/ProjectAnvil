import { env } from "cloudflare:workers";
import { z } from "zod";
import { getSessionUser } from "./auth";
import { accountPolicy } from "./account-policy";
import { createSeedWorkspace } from "./seed";
import { WorkspaceError } from "./workspace-model";
import type {
  AccountContext,
  AccountUser,
  ProjectPermission,
  WorkspaceAccess,
  WorkspaceRole,
} from "./access-types";
import {
  canEditProject,
  canManageWorkspace,
  canReadProject,
  permissionsSnapshotSQL,
} from "./permissions";
export {
  canReadProject,
  canEditProject,
  canReadEntity,
  canEditEntity,
  canReadMedia,
  canEditWorkspace,
  canManageWorkspace,
  filterWorkspaceForAccess,
  assertWorkspaceWritable,
  assertProjectWritable,
  assertMutationAccess,
  assertMutationInputAccess,
  permissionsSnapshotSQL,
} from "./permissions";

export interface ResolvedWorkspace {
  id: string;
  kind: WorkspaceAccess["kind"];
  role: WorkspaceRole;
  user: AccountUser | null;
  securityRevision?: number;
  permissions?: ProjectPermission[];
}
type AccessRow = {
  id: string;
  kind: "personal" | "team";
  owner_user_id: string;
  role: WorkspaceRole;
  security_revision: number;
};
export interface TeamDetails {
  members: { id: string; username: string; role: WorkspaceRole }[];
  invitations: {
    id: string;
    username: string;
    role: Exclude<WorkspaceRole, "owner">;
  }[];
  projectPermissions: ProjectPermission[];
  securityRevision: number;
}
const identifier = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+$/);
const username = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[a-zA-Z0-9_.]+$/);
const memberRole = z.enum(["admin", "editor", "viewer"]);
const teamActions = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      name: z.string().trim().min(1).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal("invite"),
      workspaceId: identifier,
      username,
      role: memberRole.default("editor"),
    })
    .strict(),
  z.object({ action: z.literal("accept"), invitationId: identifier }).strict(),
  z.object({ action: z.literal("decline"), invitationId: identifier }).strict(),
  z
    .object({
      action: z.literal("cancel"),
      workspaceId: identifier,
      invitationId: identifier,
    })
    .strict(),
  z
    .object({
      action: z.literal("remove"),
      workspaceId: identifier,
      userId: identifier,
    })
    .strict(),
  z.object({ action: z.literal("leave"), workspaceId: identifier }).strict(),
  z
    .object({
      action: z.literal("set-role"),
      workspaceId: identifier,
      userId: identifier,
      role: memberRole,
      expectedRole: memberRole.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("transfer"),
      workspaceId: identifier,
      userId: identifier,
      expectedOwnerId: identifier.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("project-access"),
      workspaceId: identifier,
      projectId: identifier,
      restricted: z.boolean(),
      members: z
        .array(
          z
            .object({ userId: identifier, role: z.enum(["viewer", "editor"]) })
            .strict(),
        )
        .max(200)
        .refine(
          (items) =>
            new Set(items.map((item) => item.userId)).size === items.length,
          "Each member can have one project role.",
        ),
      expectedRevision: z.number().int().min(0).optional(),
    })
    .strict(),
]);

export function database(): D1Database {
  if (!env.DB)
    throw new WorkspaceError("Workspace storage is unavailable.", 503);
  return env.DB;
}
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin"),
    site = request.headers.get("sec-fetch-site");
  if (
    (origin && origin !== new URL(request.url).origin) ||
    (site && !["same-origin", "none"].includes(site))
  ) {
    throw new WorkspaceError(
      "Open ProjectAnvil in this browser to make changes.",
      403,
    );
  }
}
export function accountPersonId(userId: string): string {
  return `account_${userId}`;
}
export function personalWorkspaceId(userId: string): string {
  return `personal_${userId}`;
}

async function ensurePersonalWorkspace(user: AccountUser): Promise<string> {
  const db = database(),
    id = personalWorkspaceId(user.id);
  const existing = await db
    .prepare(
      "SELECT id, kind, owner_user_id FROM workspace_access WHERE id = ?",
    )
    .bind(id)
    .first<{ id: string; kind: string; owner_user_id: string }>();
  if (existing) {
    if (existing.kind !== "personal" || existing.owner_user_id !== user.id)
      throw new WorkspaceError(
        "Your personal workspace could not be opened.",
        409,
      );
    return id;
  }
  const workspace = createSeedWorkspace();
  workspace.name = "My workspace";
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO workspaces (id, data, revision, updated_at) VALUES (?, ?, 0, ?)",
      )
      .bind(id, JSON.stringify(workspace), new Date().toISOString()),
    db
      .prepare(
        "INSERT OR IGNORE INTO workspace_access (id, kind, owner_user_id) VALUES (?, 'personal', ?)",
      )
      .bind(id, user.id),
    db
      .prepare(
        "INSERT OR IGNORE INTO appmembers (workspace_id, user_id, role) VALUES (?, ?, 'owner')",
      )
      .bind(id, user.id),
  ]);
  return id;
}
async function requireUser(request: Request): Promise<AccountUser> {
  const user = await sessionUser(request);
  if (!user)
    throw new WorkspaceError(
      "Sign in to use personal or team workspaces.",
      401,
    );
  return user;
}
async function sessionUser(request: Request): Promise<AccountUser | null> {
  const user = await getSessionUser(request),
    expected = request.headers.get("x-account-id");
  if (expected && expected !== (user?.id || "guest"))
    throw new WorkspaceError(
      "The signed-in account changed. Reload before saving this workspace.",
      409,
    );
  return user;
}
const effectiveRole =
  "CASE WHEN m.role = 'owner' THEN 'owner' ELSE COALESCE(r.role, 'editor') END";
async function accessForUser(
  user: AccountUser,
  workspaceId: string,
): Promise<AccessRow> {
  const row = await database()
    .prepare(
      `SELECT a.id, a.kind, a.owner_user_id, ${effectiveRole} AS role,
    COALESCE(s.revision, 0) AS security_revision
    FROM workspace_access a JOIN appmembers m ON m.workspace_id = a.id
    LEFT JOIN appmember_roles r ON r.workspace_id = m.workspace_id AND r.user_id = m.user_id
    LEFT JOIN workspace_security s ON s.workspace_id = a.id
    WHERE a.id = ? AND m.user_id = ?`,
    )
    .bind(workspaceId, user.id)
    .first<AccessRow>();
  if (!row || (row.kind === "personal" && row.owner_user_id !== user.id))
    throw new WorkspaceError(
      "This workspace is unavailable to your account.",
      404,
    );
  return row;
}
async function projectPermissions(
  workspaceId: string,
): Promise<ProjectPermission[]> {
  const rows = await database()
    .prepare(
      `SELECT p.project_id, p.restricted, g.user_id, g.role
    FROM project_permissions p LEFT JOIN project_members g ON g.workspace_id = p.workspace_id AND g.project_id = p.project_id
    WHERE p.workspace_id = ? ORDER BY p.project_id, g.user_id`,
    )
    .bind(workspaceId)
    .all<{
      project_id: string;
      restricted: number;
      user_id: string | null;
      role: "editor" | "viewer" | null;
    }>();
  const result = new Map<string, ProjectPermission>();
  for (const row of rows.results) {
    const item = result.get(row.project_id) || {
      projectId: row.project_id,
      restricted: !!row.restricted,
      members: [],
    };
    if (
      row.user_id &&
      row.role &&
      !item.members.some((member) => member.userId === row.user_id)
    )
      item.members.push({ userId: row.user_id, role: row.role });
    result.set(row.project_id, item);
  }
  return [...result.values()];
}

/** Resolve a trusted account as a recipient, without accepting an actor ID from a client. */
export async function resolveWorkspaceForUser(
  user: AccountUser,
  workspaceId: string,
): Promise<ResolvedWorkspace> {
  return resolveUserWorkspace(user, workspaceId, true);
}

async function resolveUserWorkspace(
  user: AccountUser,
  workspaceId: string,
  includeProjectPermissions: boolean,
): Promise<ResolvedWorkspace> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await accessForUser(user, workspaceId);
    const permissions =
      row.kind === "team" && includeProjectPermissions
        ? await projectPermissions(workspaceId)
        : [];
    const latest = await accessForUser(user, workspaceId);
    if (
      row.security_revision === latest.security_revision &&
      row.role === latest.role &&
      row.owner_user_id === latest.owner_user_id
    ) {
      return {
        id: row.id,
        kind: row.kind,
        role: row.role,
        user,
        securityRevision: row.security_revision,
        permissions,
      };
    }
  }
  throw new WorkspaceError(
    "Team access changed while opening this workspace. Refresh and try again.",
    409,
  );
}
export async function resolveWorkspace(
  request: Request,
): Promise<ResolvedWorkspace> {
  return resolveWorkspaceAccess(request, true);
}

/** Only marker fields escape this path; it cannot authorize record access. */
export async function resolveWorkspaceMarker(request: Request) {
  const { id, kind, role, securityRevision } = await resolveWorkspaceAccess(
    request,
    false,
  );
  return { id, kind, role, securityRevision };
}

async function resolveWorkspaceAccess(
  request: Request,
  includeProjectPermissions: boolean,
): Promise<ResolvedWorkspace> {
  const user = await sessionUser(request);
  const selected =
    request.headers.get("x-workspace-id") ||
    new URL(request.url).searchParams.get("workspace");
  if (selected && !identifier.safeParse(selected).success)
    throw new WorkspaceError("Choose a valid workspace.", 400);
  if (!user) {
    if (accountPolicy(env, request.url).public.mode === "online")
      throw new WorkspaceError(
        "Sign in with an approved account to open your workspace.",
        401,
      );
    if (selected && selected !== "main")
      throw new WorkspaceError("Sign in to open this workspace.", 401);
    return {
      id: "main",
      kind: "guest",
      role: "owner",
      user: null,
      securityRevision: 0,
      permissions: [],
    };
  }
  const workspaceId = selected || (await ensurePersonalWorkspace(user));
  return resolveUserWorkspace(user, workspaceId, includeProjectPermissions);
}
export async function getAccountContext(
  request: Request,
): Promise<AccountContext> {
  const user = await sessionUser(request),
    db = database();
  if (!user) {
    const policy = accountPolicy(env, request.url).public;
    if (policy.mode === "online")
      return { user: null, workspaces: [], invitations: [], policy };
    const row = await db
      .prepare("SELECT data FROM workspaces WHERE id = ?")
      .bind("main")
      .first<{ data: string }>();
    let name = createSeedWorkspace().name;
    if (row) {
      try {
        name = JSON.parse(row.data).name || name;
      } catch {}
    }
    return {
      user: null,
      workspaces: [
        { id: "main", name, kind: "guest", role: "owner", securityRevision: 0 },
      ],
      invitations: [],
      policy,
    };
  }
  await ensurePersonalWorkspace(user);
  const rows = await db
    .prepare(
      `SELECT a.id, a.kind, a.owner_user_id, w.data FROM workspace_access a
    JOIN appmembers m ON m.workspace_id = a.id JOIN workspaces w ON w.id = a.id
    WHERE m.user_id = ? ORDER BY CASE a.kind WHEN 'personal' THEN 0 ELSE 1 END, a.id`,
    )
    .bind(user.id)
    .all<{
      id: string;
      kind: "personal" | "team";
      owner_user_id: string;
      data: string;
    }>();
  const invites = await db
    .prepare(
      `SELECT i.id, i.workspace_id, w.data, u.username, COALESCE(r.role, 'editor') AS role
    FROM appinvites i JOIN workspace_access a ON a.id = i.workspace_id AND a.kind = 'team'
    JOIN workspaces w ON w.id = i.workspace_id JOIN user u ON u.id = i.invited_by
    LEFT JOIN appinvite_roles r ON r.invitation_id = i.id
    WHERE i.user_id = ? ORDER BY i.created_at DESC`,
    )
    .bind(user.id)
    .all<{
      id: string;
      workspace_id: string;
      data: string;
      username: string;
      role: Exclude<WorkspaceRole, "owner">;
    }>();
  const workspaces: WorkspaceAccess[] = [];
  for (const row of rows.results) {
    if (row.kind === "personal" && row.owner_user_id !== user.id) continue;
    try {
      const resolved = await resolveWorkspaceForUser(user, row.id);
      const data = JSON.parse(row.data) as {
        name: string;
        projects?: { id: string }[];
      };
      workspaces.push({
        id: row.id,
        name: data.name,
        kind: resolved.kind,
        role: resolved.role,
        ownerId: row.owner_user_id,
        securityRevision: resolved.securityRevision,
        projectRoles: Object.fromEntries(
          (data.projects || [])
            .filter((project) => canReadProject(resolved, project.id))
            .map((project) => [
              project.id,
              canEditProject(resolved, project.id) ? "editor" : "viewer",
            ]),
        ),
      });
    } catch (cause) {
      if (
        !(cause instanceof WorkspaceError) ||
        ![404, 409].includes(cause.status)
      )
        throw cause;
      // A concurrently removed workspace is omitted rather than breaking the account menu.
    }
  }
  return {
    user,
    workspaces,
    policy: accountPolicy(env, request.url).public,
    invitations: invites.results.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      workspaceName: JSON.parse(row.data).name,
      invitedBy: row.username,
      role: row.role,
    })),
  };
}
export async function listTeamMembers(
  request: Request,
  workspaceId: string,
): Promise<TeamDetails> {
  const user = await requireUser(request);
  if (!identifier.safeParse(workspaceId).success)
    throw new WorkspaceError("Choose a valid workspace.");
  const access = await resolveWorkspaceForUser(user, workspaceId),
    db = database();
  const members = await db
    .prepare(
      `SELECT u.id, u.username, ${effectiveRole} AS role FROM appmembers m
    JOIN user u ON u.id = m.user_id LEFT JOIN appmember_roles r ON r.workspace_id = m.workspace_id AND r.user_id = m.user_id
    WHERE m.workspace_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, u.username`,
    )
    .bind(workspaceId)
    .all<{ id: string; username: string; role: WorkspaceRole }>();
  const invitations = canManageWorkspace(access)
    ? await db
        .prepare(
          `SELECT i.id, u.username, COALESCE(r.role, 'editor') AS role
    FROM appinvites i JOIN user u ON u.id = i.user_id LEFT JOIN appinvite_roles r ON r.invitation_id = i.id
    WHERE i.workspace_id = ? ORDER BY i.created_at`,
        )
        .bind(workspaceId)
        .all<TeamDetails["invitations"][number]>()
    : { results: [] };
  return {
    members: members.results,
    invitations: invitations.results,
    projectPermissions: canManageWorkspace(access)
      ? access.permissions || []
      : [],
    securityRevision: access.securityRevision || 0,
  };
}
function securityBump(
  workspaceId: string,
  condition: string,
  values: (string | number)[],
) {
  return database()
    .prepare(
      `INSERT INTO workspace_security (workspace_id, revision) SELECT ?, 1 WHERE ${condition}
    ON CONFLICT(workspace_id) DO UPDATE SET revision = revision + 1`,
    )
    .bind(workspaceId, ...values);
}
function managementAccess(access: ResolvedWorkspace): void {
  if (!canManageWorkspace(access))
    throw new WorkspaceError(
      "Only workspace owners and administrators can manage team access.",
      403,
    );
}
function changed(
  result: D1Result<unknown>,
  message = "Team access changed. Reload the team settings and try again.",
) {
  if (!result.meta.changes) throw new WorkspaceError(message, 409);
}
function accessEvent(
  workspaceId: string,
  user: AccountUser,
  fields: string[],
  condition: string,
  values: (string | number)[],
): D1PreparedStatement {
  return database()
    .prepare(
      `INSERT INTO workspace_activity
    (id,workspace_id,revision,actor_id,actor_name,entity_type,entity_id,project_id,title,action,fields_json,created_at)
    SELECT ?, w.id, w.revision, ?, ?, 'workspace', w.id, '', 'Team access', 'access-changed', ?, ?
    FROM workspaces w WHERE w.id = ? AND (${condition})`,
    )
    .bind(
      crypto.randomUUID(),
      user.id,
      user.username,
      JSON.stringify(fields),
      new Date().toISOString(),
      workspaceId,
      ...values,
    );
}
export async function teamAction(
  request: Request,
  input: unknown,
): Promise<AccountContext> {
  assertSameOrigin(request);
  const user = await requireUser(request),
    parsed = teamActions.safeParse(input),
    db = database();
  if (!parsed.success)
    throw new WorkspaceError(
      parsed.error.issues[0]?.message || "Choose a valid team action.",
    );
  const action = parsed.data;
  if (action.action === "create") {
    const owned = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM workspace_access WHERE owner_user_id = ? AND kind = 'team'",
      )
      .bind(user.id)
      .first<{ count: number }>();
    if ((owned?.count || 0) >= 30)
      throw new WorkspaceError("You can own up to 30 team workspaces.");
    const id = `team_${crypto.randomUUID()}`,
      workspace = createSeedWorkspace();
    workspace.name = action.name;
    const created = await db.batch([
      db
        .prepare(
          "INSERT INTO workspaces (id, data, revision, updated_at) SELECT ?, ?, 0, ? WHERE (SELECT COUNT(*) FROM workspace_access WHERE owner_user_id=? AND kind='team') < 30",
        )
        .bind(id, JSON.stringify(workspace), new Date().toISOString(), user.id),
      db
        .prepare(
          "INSERT INTO workspace_access (id, kind, owner_user_id) SELECT ?, 'team', ? WHERE EXISTS(SELECT 1 FROM workspaces WHERE id=?)",
        )
        .bind(id, user.id, id),
      db
        .prepare(
          "INSERT INTO appmembers (workspace_id, user_id, role) SELECT ?, ?, 'owner' WHERE EXISTS(SELECT 1 FROM workspace_access WHERE id=?)",
        )
        .bind(id, user.id, id),
    ]);
    if (!created[0].meta.changes)
      throw new WorkspaceError("You can own up to 30 team workspaces.");
  } else if (action.action === "accept" || action.action === "decline") {
    const invite = await db
      .prepare(
        "SELECT i.id, i.workspace_id FROM appinvites i JOIN workspace_access a ON a.id = i.workspace_id AND a.kind = 'team' WHERE i.id = ? AND i.user_id = ?",
      )
      .bind(action.invitationId, user.id)
      .first<{ id: string; workspace_id: string }>();
    if (!invite)
      throw new WorkspaceError("This invitation is no longer available.", 404);
    const condition =
      "EXISTS (SELECT 1 FROM appinvites WHERE id = ? AND user_id = ?)";
    const values = [invite.id, user.id];
    if (action.action === "accept")
      await db.batch([
        db
          .prepare(
            "INSERT OR IGNORE INTO appmembers (workspace_id, user_id, role) SELECT workspace_id, user_id, 'member' FROM appinvites WHERE id = ? AND user_id = ?",
          )
          .bind(invite.id, user.id),
        db
          .prepare(
            `INSERT INTO appmember_roles(workspace_id,user_id,role)
        SELECT i.workspace_id,i.user_id,COALESCE(r.role,'editor') FROM appinvites i LEFT JOIN appinvite_roles r ON r.invitation_id=i.id
        WHERE i.id=? AND i.user_id=? ON CONFLICT(workspace_id,user_id) DO NOTHING`,
          )
          .bind(invite.id, user.id),
        accessEvent(
          invite.workspace_id,
          user,
          ["Membership"],
          condition,
          values,
        ),
        securityBump(invite.workspace_id, condition, values),
        db
          .prepare(
            `DELETE FROM workspace_activity WHERE workspace_id=? AND seq NOT IN
        (SELECT seq FROM workspace_activity WHERE workspace_id=? ORDER BY seq DESC LIMIT 10000)
        AND (${condition})`,
          )
          .bind(invite.workspace_id, invite.workspace_id, ...values),
        db
          .prepare("DELETE FROM appinvites WHERE id = ? AND user_id = ?")
          .bind(invite.id, user.id),
      ]);
    else
      await db
        .prepare("DELETE FROM appinvites WHERE id = ? AND user_id = ?")
        .bind(invite.id, user.id)
        .run();
  } else {
    const access = await resolveWorkspaceForUser(user, action.workspaceId);
    if (access.kind !== "team")
      throw new WorkspaceError("Personal workspaces cannot have a team.", 400);
    const snapshot = permissionsSnapshotSQL(access);
    const token = crypto.randomUUID();
    const guard =
      "EXISTS(SELECT 1 FROM workspace_security_guards WHERE workspace_id=? AND token=?)";
    const values = [action.workspaceId, token];
    const extra =
      action.action === "project-access"
        ? {
            sql: " AND EXISTS(SELECT 1 FROM workspaces w,json_each(w.data,'$.projects') p WHERE w.id=? AND json_extract(p.value,'$.id')=?)",
            values: [action.workspaceId, action.projectId],
          }
        : action.action === "transfer"
          ? {
              sql: " AND (SELECT COUNT(*) FROM workspace_access WHERE owner_user_id=? AND kind='team') < 30",
              values: [action.userId],
            }
          : { sql: "", values: [] };
    const guardedBatch = async (statements: D1PreparedStatement[]) => {
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO workspace_security_guards(workspace_id,token) SELECT ?,? WHERE (${snapshot.sql})${extra.sql}
          ON CONFLICT(workspace_id) DO UPDATE SET token=excluded.token`,
          )
          .bind(
            action.workspaceId,
            token,
            ...snapshot.bindings,
            ...extra.values,
          ),
        ...statements,
        db
          .prepare(
            `DELETE FROM workspace_activity WHERE workspace_id=? AND seq NOT IN
          (SELECT seq FROM workspace_activity WHERE workspace_id=? ORDER BY seq DESC LIMIT 10000)
          AND (${guard})`,
          )
          .bind(action.workspaceId, action.workspaceId, ...values),
        db
          .prepare(
            "DELETE FROM workspace_security_guards WHERE workspace_id=? AND token=?",
          )
          .bind(action.workspaceId, token),
      ]);
      changed(results[0]);
      return results.slice(1, -1);
    };
    if (action.action === "leave") {
      if (access.role === "owner")
        throw new WorkspaceError(
          "Transfer ownership to another member before leaving this workspace.",
        );
      const condition = `EXISTS(SELECT 1 FROM appmembers WHERE workspace_id=? AND user_id=? AND role='member') AND (${guard})`;
      const args = [action.workspaceId, user.id, ...values];
      const results = await guardedBatch([
        accessEvent(action.workspaceId, user, ["Membership"], condition, args),
        securityBump(action.workspaceId, condition, args),
        db
          .prepare(
            `DELETE FROM appmembers WHERE workspace_id = ? AND user_id = ? AND role = 'member' AND (${guard})`,
          )
          .bind(action.workspaceId, user.id, ...values),
      ]);
      changed(results[2], "This membership is no longer available.");
    } else {
      managementAccess(access);
      if (action.action === "invite") {
        if (access.role !== "owner" && action.role === "admin")
          throw new WorkspaceError(
            "Only the owner can appoint an administrator.",
            403,
          );
        const target = await db
          .prepare("SELECT id FROM user WHERE lower(username) = lower(?)")
          .bind(action.username)
          .first<{ id: string }>();
        if (!target)
          throw new WorkspaceError(
            "No account has that username. Ask them to register first.",
            404,
          );
        if (target.id === user.id)
          throw new WorkspaceError("You already belong to this workspace.");
        if (
          await db
            .prepare(
              "SELECT user_id FROM appmembers WHERE workspace_id = ? AND user_id = ?",
            )
            .bind(action.workspaceId, target.id)
            .first()
        )
          throw new WorkspaceError(
            "This person already belongs to the workspace.",
          );
        if (
          await db
            .prepare(
              "SELECT id FROM appinvites WHERE workspace_id=? AND user_id=?",
            )
            .bind(action.workspaceId, target.id)
            .first()
        )
          throw new WorkspaceError(
            "This person already has a pending invitation. Cancel it before choosing another role.",
          );
        const count = await db
          .prepare(
            "SELECT (SELECT COUNT(*) FROM appmembers WHERE workspace_id = ?) + (SELECT COUNT(*) FROM appinvites WHERE workspace_id = ?) AS count",
          )
          .bind(action.workspaceId, action.workspaceId)
          .first<{ count: number }>();
        if ((count?.count || 0) >= 200)
          throw new WorkspaceError(
            "A team workspace supports up to 200 members and invitations.",
          );
        const id = crypto.randomUUID();
        const condition = `EXISTS(SELECT 1 FROM appinvites WHERE id=?) AND (${guard})`;
        await guardedBatch([
          db
            .prepare(
              `INSERT OR IGNORE INTO appinvites(id,workspace_id,user_id,invited_by,created_at) SELECT ?,?,?,?,? WHERE (${guard})
            AND (SELECT COUNT(*) FROM appmembers WHERE workspace_id=?) + (SELECT COUNT(*) FROM appinvites WHERE workspace_id=?) < 200`,
            )
            .bind(
              id,
              action.workspaceId,
              target.id,
              user.id,
              new Date().toISOString(),
              ...values,
              action.workspaceId,
              action.workspaceId,
            ),
          db
            .prepare(
              "INSERT INTO appinvite_roles(invitation_id,role) SELECT ?,? WHERE EXISTS(SELECT 1 FROM appinvites WHERE id=?)",
            )
            .bind(id, action.role, id),
          accessEvent(action.workspaceId, user, ["Invitation"], condition, [
            id,
            ...values,
          ]),
          securityBump(action.workspaceId, condition, [id, ...values]),
        ]);
        const pending = await db
          .prepare(
            "SELECT id FROM appinvites WHERE workspace_id=? AND user_id=?",
          )
          .bind(action.workspaceId, target.id)
          .first();
        if (!pending)
          throw new WorkspaceError(
            "Team access changed before the invitation was saved. Refresh and try again.",
            409,
          );
      } else if (action.action === "cancel") {
        const target = await db
          .prepare(
            "SELECT COALESCE(r.role,'editor') AS role FROM appinvites i LEFT JOIN appinvite_roles r ON r.invitation_id=i.id WHERE i.id=? AND i.workspace_id=?",
          )
          .bind(action.invitationId, action.workspaceId)
          .first<{ role: string }>();
        if (!target)
          throw new WorkspaceError(
            "This invitation is no longer available.",
            404,
          );
        if (access.role !== "owner" && target.role === "admin")
          throw new WorkspaceError(
            "Only the owner can cancel an administrator invitation.",
            403,
          );
        const condition = `EXISTS(SELECT 1 FROM appinvites WHERE id=? AND workspace_id=?) AND (${guard})`;
        const args = [action.invitationId, action.workspaceId, ...values];
        const results = await guardedBatch([
          accessEvent(
            action.workspaceId,
            user,
            ["Invitation"],
            condition,
            args,
          ),
          securityBump(action.workspaceId, condition, args),
          db
            .prepare(
              `DELETE FROM appinvites WHERE id=? AND workspace_id=? AND (${guard})`,
            )
            .bind(action.invitationId, action.workspaceId, ...values),
        ]);
        changed(results[2], "This invitation is no longer available.");
      } else if (action.action === "transfer") {
        if (access.role !== "owner")
          throw new WorkspaceError(
            "Only the current owner can transfer ownership.",
            403,
          );
        if (action.userId === user.id)
          throw new WorkspaceError(
            "Choose another accepted member as the new owner.",
          );
        if (action.expectedOwnerId && action.expectedOwnerId !== user.id)
          throw new WorkspaceError(
            "Ownership changed. Refresh the team settings.",
            409,
          );
        const target = await db
          .prepare(
            "SELECT user_id FROM appmembers WHERE workspace_id=? AND user_id=?",
          )
          .bind(action.workspaceId, action.userId)
          .first();
        if (!target)
          throw new WorkspaceError(
            "The new owner must be an accepted team member.",
            400,
          );
        const owned = await db
          .prepare(
            "SELECT COUNT(*) AS count FROM workspace_access WHERE owner_user_id=? AND kind='team'",
          )
          .bind(action.userId)
          .first<{ count: number }>();
        if ((owned?.count || 0) >= 30)
          throw new WorkspaceError(
            "The chosen member already owns the maximum number of teams.",
          );
        const condition = `EXISTS(SELECT 1 FROM workspace_access WHERE id=? AND owner_user_id=?) AND (${guard})`;
        const args = [action.workspaceId, user.id, ...values];
        const transferred = `EXISTS(SELECT 1 FROM workspace_access WHERE id=? AND owner_user_id=?) AND (${guard})`;
        const transferArgs = [action.workspaceId, action.userId, ...values];
        const results = await guardedBatch([
          accessEvent(action.workspaceId, user, ["Ownership"], condition, args),
          db
            .prepare(
              `UPDATE workspace_access SET owner_user_id=? WHERE id=? AND owner_user_id=? AND (${guard})
            AND EXISTS(SELECT 1 FROM appmembers WHERE workspace_id=? AND user_id=?)
            AND (SELECT COUNT(*) FROM workspace_access WHERE owner_user_id=? AND kind='team') < 30`,
            )
            .bind(
              action.userId,
              action.workspaceId,
              user.id,
              ...values,
              action.workspaceId,
              action.userId,
              action.userId,
            ),
          db
            .prepare(
              `UPDATE appmembers SET role='member' WHERE workspace_id=? AND user_id=? AND ${transferred}`,
            )
            .bind(action.workspaceId, user.id, ...transferArgs),
          db
            .prepare(
              `UPDATE appmembers SET role='owner' WHERE workspace_id=? AND user_id=? AND ${transferred}`,
            )
            .bind(action.workspaceId, action.userId, ...transferArgs),
          db
            .prepare(
              `DELETE FROM appmember_roles WHERE workspace_id=? AND user_id=? AND ${transferred}`,
            )
            .bind(action.workspaceId, action.userId, ...transferArgs),
          db
            .prepare(
              `INSERT INTO appmember_roles(workspace_id,user_id,role) SELECT ?,?,'admin' WHERE ${transferred}
            ON CONFLICT(workspace_id,user_id) DO UPDATE SET role='admin'`,
            )
            .bind(action.workspaceId, user.id, ...transferArgs),
          securityBump(action.workspaceId, transferred, transferArgs),
        ]);
        changed(
          results[1],
          "Ownership changed before this transfer could finish. Refresh the team settings.",
        );
      } else if (action.action === "remove" || action.action === "set-role") {
        const target = await db
          .prepare(
            `SELECT ${effectiveRole} AS role FROM appmembers m
          LEFT JOIN appmember_roles r ON r.workspace_id=m.workspace_id AND r.user_id=m.user_id WHERE m.workspace_id=? AND m.user_id=?`,
          )
          .bind(action.workspaceId, action.userId)
          .first<{ role: WorkspaceRole }>();
        if (!target)
          throw new WorkspaceError(
            "This member is no longer in the workspace.",
            404,
          );
        if (target.role === "owner")
          throw new WorkspaceError(
            "Transfer ownership before changing the owner's membership.",
          );
        if (
          access.role !== "owner" &&
          (target.role === "admin" ||
            action.userId === user.id ||
            (action.action === "set-role" && action.role === "admin"))
        )
          throw new WorkspaceError(
            "Only the owner can change administrator access.",
            403,
          );
        if (
          action.action === "set-role" &&
          action.expectedRole &&
          action.expectedRole !== target.role
        )
          throw new WorkspaceError(
            "This member's role changed. Refresh the team settings.",
            409,
          );
        const condition = `EXISTS(SELECT 1 FROM appmembers WHERE workspace_id=? AND user_id=? AND role='member') AND (${guard})`;
        const args = [action.workspaceId, action.userId, ...values];
        if (action.action === "set-role") {
          const results = await guardedBatch([
            db
              .prepare(
                `INSERT INTO appmember_roles(workspace_id,user_id,role) SELECT ?,?,? WHERE ${condition} ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role`,
              )
              .bind(action.workspaceId, action.userId, action.role, ...args),
            accessEvent(action.workspaceId, user, ["Roles"], condition, args),
            securityBump(action.workspaceId, condition, args),
          ]);
          changed(results[0]);
        } else {
          const results = await guardedBatch([
            accessEvent(
              action.workspaceId,
              user,
              ["Membership"],
              condition,
              args,
            ),
            securityBump(action.workspaceId, condition, args),
            db
              .prepare(
                `DELETE FROM appmembers WHERE workspace_id=? AND user_id=? AND role='member' AND (${guard})`,
              )
              .bind(action.workspaceId, action.userId, ...values),
          ]);
          changed(results[2], "This member is no longer in the workspace.");
        }
      } else if (action.action === "project-access") {
        if (
          action.expectedRevision !== undefined &&
          action.expectedRevision !== access.securityRevision
        )
          throw new WorkspaceError(
            "Project permissions changed. Reload them before saving.",
            409,
          );
        const project = await db
          .prepare(
            "SELECT 1 AS present FROM workspaces w,json_each(w.data,'$.projects') p WHERE w.id=? AND json_extract(p.value,'$.id')=?",
          )
          .bind(action.workspaceId, action.projectId)
          .first();
        if (!project)
          throw new WorkspaceError(
            "This project is no longer in the workspace.",
            404,
          );
        const members = await db
          .prepare("SELECT user_id FROM appmembers WHERE workspace_id=?")
          .bind(action.workspaceId)
          .all<{ user_id: string }>();
        const valid = new Set(members.results.map((member) => member.user_id));
        if (action.members.some((member) => !valid.has(member.userId)))
          throw new WorkspaceError(
            "Project grants can only name accepted team members.",
          );
        const statements = [
          db
            .prepare(
              `INSERT INTO project_permissions(workspace_id,project_id,restricted) SELECT ?,?,? WHERE (${guard})
            AND EXISTS(SELECT 1 FROM workspaces w,json_each(w.data,'$.projects') p WHERE w.id=? AND json_extract(p.value,'$.id')=?)
            ON CONFLICT(workspace_id,project_id) DO UPDATE SET restricted=excluded.restricted`,
            )
            .bind(
              action.workspaceId,
              action.projectId,
              Number(action.restricted),
              ...values,
              action.workspaceId,
              action.projectId,
            ),
          db
            .prepare(
              `DELETE FROM project_members WHERE workspace_id=? AND project_id=? AND (${guard})`,
            )
            .bind(action.workspaceId, action.projectId, ...values),
          ...action.members.map((member) =>
            db
              .prepare(
                `INSERT INTO project_members(workspace_id,project_id,user_id,role) SELECT ?,?,?,? WHERE (${guard})
            AND EXISTS(SELECT 1 FROM appmembers WHERE workspace_id=? AND user_id=?)`,
              )
              .bind(
                action.workspaceId,
                action.projectId,
                member.userId,
                member.role,
                ...values,
                action.workspaceId,
                member.userId,
              ),
          ),
          accessEvent(
            action.workspaceId,
            user,
            ["Project permissions"],
            guard,
            values,
          ),
          securityBump(action.workspaceId, guard, values),
        ];
        const results = await guardedBatch(statements);
        changed(results[0]);
      }
    }
  }
  return getAccountContext(request);
}
