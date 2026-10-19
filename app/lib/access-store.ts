import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { getSessionUser } from './auth';
import { createSeedWorkspace } from './seed';
import { WorkspaceError } from './workspace-model';
import type { AccountContext, AccountUser, WorkspaceAccess } from './access-types';

export interface ResolvedWorkspace { id: string; kind: WorkspaceAccess['kind']; role: WorkspaceAccess['role']; user: AccountUser | null }
type AccessRow = { id: string; kind: 'personal' | 'team'; owner_user_id: string; role: 'owner' | 'member' };
const identifier = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);
const username = z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_.]+$/);
const teamActions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().trim().min(1).max(100) }).strict(),
  z.object({ action: z.literal('invite'), workspaceId: identifier, username }).strict(),
  z.object({ action: z.literal('accept'), invitationId: identifier }).strict(),
  z.object({ action: z.literal('decline'), invitationId: identifier }).strict(),
  z.object({ action: z.literal('cancel'), workspaceId: identifier, invitationId: identifier }).strict(),
  z.object({ action: z.literal('remove'), workspaceId: identifier, userId: identifier }).strict(),
  z.object({ action: z.literal('leave'), workspaceId: identifier }).strict(),
]);

export function database(): D1Database {
  if (!env.DB) throw new WorkspaceError('Workspace storage is unavailable.', 503);
  return env.DB;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if ((origin && origin !== new URL(request.url).origin) || (site && !['same-origin', 'none'].includes(site))) {
    throw new WorkspaceError('Open ProjectAnvil in this browser to make changes.', 403);
  }
}

export function accountPersonId(userId: string): string { return `account_${userId}`; }
export function personalWorkspaceId(userId: string): string { return `personal_${userId}`; }

async function ensurePersonalWorkspace(user: AccountUser): Promise<string> {
  const db = database(), id = personalWorkspaceId(user.id);
  const existing = await db.prepare('SELECT id, kind, owner_user_id FROM workspace_access WHERE id = ?').bind(id).first<{ id: string; kind: string; owner_user_id: string }>();
  if (existing) {
    if (existing.kind !== 'personal' || existing.owner_user_id !== user.id) throw new WorkspaceError('Your personal workspace could not be opened.', 409);
    return id;
  }
  const workspace = createSeedWorkspace();
  workspace.name = 'My workspace';
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO workspaces (id, data, revision, updated_at) VALUES (?, ?, 0, ?)').bind(id, JSON.stringify(workspace), new Date().toISOString()),
    db.prepare("INSERT OR IGNORE INTO workspace_access (id, kind, owner_user_id) VALUES (?, 'personal', ?)").bind(id, user.id),
    db.prepare("INSERT OR IGNORE INTO appmembers (workspace_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, user.id),
  ]);
  return id;
}

async function requireUser(request: Request): Promise<AccountUser> {
  const user = await sessionUser(request);
  if (!user) throw new WorkspaceError('Sign in to use personal or team workspaces.', 401);
  return user;
}

async function sessionUser(request: Request): Promise<AccountUser | null> {
  const user = await getSessionUser(request), expected = request.headers.get('x-account-id');
  if (expected && expected !== (user?.id || 'guest')) throw new WorkspaceError('The signed-in account changed. Reload before saving this workspace.', 409);
  return user;
}

async function accessForUser(user: AccountUser, workspaceId: string): Promise<AccessRow> {
  const row = await database().prepare('SELECT a.id, a.kind, a.owner_user_id, m.role FROM workspace_access a JOIN appmembers m ON m.workspace_id = a.id WHERE a.id = ? AND m.user_id = ?')
    .bind(workspaceId, user.id).first<AccessRow>();
  if (!row || (row.kind === 'personal' && row.owner_user_id !== user.id)) throw new WorkspaceError('This workspace is unavailable to your account.', 404);
  return row;
}

export async function resolveWorkspace(request: Request): Promise<ResolvedWorkspace> {
  const user = await sessionUser(request);
  const selected = request.headers.get('x-workspace-id') || new URL(request.url).searchParams.get('workspace');
  if (selected && !identifier.safeParse(selected).success) throw new WorkspaceError('Choose a valid workspace.', 400);
  if (!user) {
    if (selected && selected !== 'main') throw new WorkspaceError('Sign in to open this workspace.', 401);
    return { id: 'main', kind: 'guest', role: 'owner', user: null };
  }
  const personal = await ensurePersonalWorkspace(user);
  const row = await accessForUser(user, selected || personal);
  return { id: row.id, kind: row.kind, role: row.role, user };
}

export async function getAccountContext(request: Request): Promise<AccountContext> {
  const user = await sessionUser(request), db = database();
  if (!user) {
    const row = await db.prepare('SELECT data FROM workspaces WHERE id = ?').bind('main').first<{ data: string }>();
    let name = 'Local guest workspace';
    if (row) { try { name = JSON.parse(row.data).name || name; } catch {} }
    return { user: null, workspaces: [{ id: 'main', name, kind: 'guest', role: 'owner' }], invitations: [] };
  }
  await ensurePersonalWorkspace(user);
  const access = await db.prepare('SELECT a.id, a.kind, a.owner_user_id, m.role, w.data FROM workspace_access a JOIN appmembers m ON m.workspace_id = a.id JOIN workspaces w ON w.id = a.id WHERE m.user_id = ? ORDER BY CASE a.kind WHEN \'personal\' THEN 0 ELSE 1 END, a.id').bind(user.id)
    .all<AccessRow & { data: string }>();
  const invites = await db.prepare('SELECT i.id, i.workspace_id, w.data, u.username FROM appinvites i JOIN workspace_access a ON a.id = i.workspace_id AND a.kind = \'team\' JOIN workspaces w ON w.id = i.workspace_id JOIN user u ON u.id = i.invited_by WHERE i.user_id = ? ORDER BY i.created_at DESC').bind(user.id)
    .all<{ id: string; workspace_id: string; data: string; username: string }>();
  return {
    user,
    workspaces: access.results.filter(row => row.kind !== 'personal' || row.owner_user_id === user.id).map(row => ({ id: row.id, name: JSON.parse(row.data).name, kind: row.kind, role: row.role })),
    invitations: invites.results.map(row => ({ id: row.id, workspaceId: row.workspace_id, workspaceName: JSON.parse(row.data).name, invitedBy: row.username })),
  };
}

export async function listTeamMembers(request: Request, workspaceId: string): Promise<{ members: { id: string; username: string; role: 'owner' | 'member' }[]; invitations: { id: string; username: string }[] }> {
  const user = await requireUser(request);
  if (!identifier.safeParse(workspaceId).success) throw new WorkspaceError('Choose a valid workspace.');
  const access = await accessForUser(user, workspaceId), db = database();
  const members = await db.prepare('SELECT u.id, u.username, m.role FROM appmembers m JOIN user u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY CASE m.role WHEN \'owner\' THEN 0 ELSE 1 END, u.username').bind(workspaceId)
    .all<{ id: string; username: string; role: 'owner' | 'member' }>();
  const invitations = access.role === 'owner' ? await db.prepare('SELECT i.id, u.username FROM appinvites i JOIN user u ON u.id = i.user_id WHERE i.workspace_id = ? ORDER BY i.created_at').bind(workspaceId).all<{ id: string; username: string }>() : { results: [] };
  return { members: members.results, invitations: invitations.results };
}

export async function teamAction(request: Request, input: unknown): Promise<AccountContext> {
  assertSameOrigin(request);
  const user = await requireUser(request), parsed = teamActions.safeParse(input), db = database();
  if (!parsed.success) throw new WorkspaceError(parsed.error.issues[0]?.message || 'Choose a valid team action.');
  const action = parsed.data;
  if (action.action === 'create') {
    const owned = await db.prepare("SELECT COUNT(*) AS count FROM workspace_access WHERE owner_user_id = ? AND kind = 'team'").bind(user.id).first<{ count: number }>();
    if ((owned?.count || 0) >= 30) throw new WorkspaceError('You can own up to 30 team workspaces.');
    const id = `team_${crypto.randomUUID()}`, workspace = createSeedWorkspace();
    workspace.name = action.name;
    await db.batch([
      db.prepare('INSERT INTO workspaces (id, data, revision, updated_at) VALUES (?, ?, 0, ?)').bind(id, JSON.stringify(workspace), new Date().toISOString()),
      db.prepare("INSERT INTO workspace_access (id, kind, owner_user_id) VALUES (?, 'team', ?)").bind(id, user.id),
      db.prepare("INSERT INTO appmembers (workspace_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, user.id),
    ]);
  } else if (action.action === 'accept' || action.action === 'decline') {
    const invite = await db.prepare("SELECT i.id, i.workspace_id FROM appinvites i JOIN workspace_access a ON a.id = i.workspace_id AND a.kind = 'team' WHERE i.id = ? AND i.user_id = ?").bind(action.invitationId, user.id).first<{ id: string; workspace_id: string }>();
    if (!invite) throw new WorkspaceError('This invitation is no longer available.', 404);
    if (action.action === 'accept') {
      // The INSERT predicate closes the race with an owner cancelling this invitation.
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO appmembers (workspace_id, user_id, role) SELECT workspace_id, user_id, 'member' FROM appinvites WHERE id = ? AND user_id = ?").bind(invite.id, user.id),
        db.prepare('DELETE FROM appinvites WHERE id = ? AND user_id = ?').bind(invite.id, user.id),
      ]);
    } else await db.prepare('DELETE FROM appinvites WHERE id = ? AND user_id = ?').bind(invite.id, user.id).run();
  } else {
    const access = await accessForUser(user, action.workspaceId);
    if (access.kind !== 'team') throw new WorkspaceError('Personal workspaces cannot have a team.', 400);
    if (action.action === 'leave') {
      if (access.role === 'owner') throw new WorkspaceError('The workspace owner cannot leave. Remove other members or keep this workspace for your team.');
      await db.prepare("DELETE FROM appmembers WHERE workspace_id = ? AND user_id = ? AND role = 'member'").bind(action.workspaceId, user.id).run();
    } else {
      if (access.role !== 'owner') throw new WorkspaceError('Only the workspace owner can manage team access.', 403);
      if (action.action === 'invite') {
        const target = await db.prepare('SELECT id FROM user WHERE lower(username) = lower(?)').bind(action.username).first<{ id: string }>();
        if (!target) throw new WorkspaceError('No account has that username. Ask them to register first.', 404);
        if (target.id === user.id) throw new WorkspaceError('You already own this workspace.');
        const member = await db.prepare('SELECT user_id FROM appmembers WHERE workspace_id = ? AND user_id = ?').bind(action.workspaceId, target.id).first();
        if (member) throw new WorkspaceError('This person already belongs to the workspace.');
        const count = await db.prepare('SELECT (SELECT COUNT(*) FROM appmembers WHERE workspace_id = ?) + (SELECT COUNT(*) FROM appinvites WHERE workspace_id = ?) AS count').bind(action.workspaceId, action.workspaceId).first<{ count: number }>();
        if ((count?.count || 0) >= 200) throw new WorkspaceError('A team workspace supports up to 200 members and invitations.');
        await db.prepare("INSERT OR IGNORE INTO appinvites (id, workspace_id, user_id, invited_by, created_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM appmembers WHERE workspace_id = ? AND user_id = ? AND role = 'owner')")
          .bind(crypto.randomUUID(), action.workspaceId, target.id, user.id, new Date().toISOString(), action.workspaceId, user.id).run();
      } else if (action.action === 'cancel') {
        const result = await db.prepare("DELETE FROM appinvites WHERE id = ? AND workspace_id = ? AND EXISTS (SELECT 1 FROM appmembers WHERE workspace_id = ? AND user_id = ? AND role = 'owner')").bind(action.invitationId, action.workspaceId, action.workspaceId, user.id).run();
        if (!result.meta.changes) throw new WorkspaceError('This invitation is no longer available.', 404);
      } else if (action.action === 'remove') {
        if (action.userId === user.id || action.userId === access.owner_user_id) throw new WorkspaceError('The workspace owner cannot be removed.');
        const result = await db.prepare("DELETE FROM appmembers WHERE workspace_id = ? AND user_id = ? AND role = 'member' AND EXISTS (SELECT 1 FROM appmembers owner WHERE owner.workspace_id = ? AND owner.user_id = ? AND owner.role = 'owner')").bind(action.workspaceId, action.userId, action.workspaceId, user.id).run();
        if (!result.meta.changes) throw new WorkspaceError('This member is no longer in the workspace.', 404);
      }
    }
  }
  return getAccountContext(request);
}
