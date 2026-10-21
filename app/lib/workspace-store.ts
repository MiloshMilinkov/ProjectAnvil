import { createSeedWorkspace } from './seed';
import { applyMutation, WorkspaceError } from './workspace-model';
import { accountPersonId, assertSameOrigin, database, resolveWorkspace, type ResolvedWorkspace } from './access-store';
import type { Person, Task, Workspace } from './types';

interface WorkspaceRow { data: string; revision: number }
type MemberRow = { id: string; username: string; role: 'owner' | 'member' };

async function rawWorkspace(access: ResolvedWorkspace): Promise<Workspace> {
  const db = database();
  let row = await db.prepare('SELECT data, revision FROM workspaces WHERE id = ?').bind(access.id).first<WorkspaceRow>();
  if (!row && access.kind === 'guest') {
    await db.prepare('INSERT OR IGNORE INTO workspaces (id, data, revision, updated_at) VALUES (?, ?, 0, ?)')
      .bind('main', JSON.stringify(createSeedWorkspace()), new Date().toISOString()).run();
    row = await db.prepare('SELECT data, revision FROM workspaces WHERE id = ?').bind('main').first<WorkspaceRow>();
  }
  if (!row) throw new WorkspaceError('The workspace could not be opened.', 404);
  const workspace = JSON.parse(row.data) as Workspace;
  workspace.relationships ??= [];
  workspace.revision = row.revision;
  return workspace;
}

async function verifiedMembers(access: ResolvedWorkspace): Promise<MemberRow[]> {
  if (!access.user) return [];
  const result = await database().prepare('SELECT u.id, u.username, m.role FROM appmembers m JOIN user u ON u.id = m.user_id WHERE m.workspace_id = ?').bind(access.id).all<MemberRow>();
  return result.results;
}

function withAccountPeople(workspace: Workspace, access: ResolvedWorkspace, members: MemberRow[]): Workspace {
  if (!access.user) return workspace;
  const verified = new Map(members.map(member => [accountPersonId(member.id), member]));
  const people: Person[] = workspace.people.map(person => {
    const member = verified.get(person.id);
    if (member) {
      verified.delete(person.id);
      return { id: person.id, name: member.username, role: access.kind === 'personal' ? 'You' : member.role === 'owner' ? 'Workspace owner' : 'Team member', color: person.color, userId: member.id, inactive: false };
    }
    return person.userId ? { ...person, inactive: true } : person;
  });
  for (const member of verified.values()) people.push({ id: accountPersonId(member.id), name: member.username, role: access.kind === 'personal' ? 'You' : member.role === 'owner' ? 'Workspace owner' : 'Team member', color: '#8a78fa', userId: member.id, inactive: false });
  return { ...workspace, people };
}

/** A scoped URL keeps image/audio/PDF requests in the workspace that owns the file. */
export function workspaceForClient(workspace: Workspace, workspaceId: string): Workspace {
  return { ...workspace, media: workspace.media.map(file => ({ ...file, url: `/api/media/${file.id}?workspace=${encodeURIComponent(workspaceId)}` })) };
}

function canonicalMediaUrl(item: Record<string, unknown>): Record<string, unknown> {
  if (typeof item.id !== 'string' || typeof item.url !== 'string') return item;
  // URL scope is transport context, never transferable ownership from an import.
  if (item.url === `/api/media/${item.id}` || new RegExp(`^/api/media/${item.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?workspace=[a-zA-Z0-9_-]+$`).test(item.url)) return { ...item, url: `/api/media/${item.id}` };
  return item;
}

function prepareMutation(input: unknown, current: Workspace, access: ResolvedWorkspace): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const mutation = structuredClone(input) as Record<string, any>;
  if ((mutation.action === 'rename' || mutation.action === 'import') && access.role !== 'owner') throw new WorkspaceError('Only the workspace owner can rename or replace the workspace.', 403);
  if (mutation.action === 'upsert' && mutation.entity === 'media' && mutation.item && typeof mutation.item === 'object') mutation.item = canonicalMediaUrl(mutation.item);
  if (mutation.action === 'upsert' && mutation.entity === 'people' && mutation.item && typeof mutation.item === 'object') {
    const person = current.people.find(person => person.id === mutation.item.id);
    if (person?.userId || mutation.item.userId !== undefined || mutation.item.inactive !== undefined || String(mutation.item.id || '').startsWith('account_')) throw new WorkspaceError('Account names and membership are managed through Team & accounts.', 403);
  }
  if (mutation.action === 'delete' && mutation.entity === 'people' && current.people.some(person => person.id === mutation.id && person.userId)) throw new WorkspaceError('Manage account access through Team & accounts.', 403);
  if (mutation.action === 'upsert' && mutation.entity === 'tasks' && mutation.item && typeof mutation.item === 'object') {
    const previous = current.tasks.find(task => task.id === mutation.item.id);
    const assignee = current.people.find(person => person.id === mutation.item.assigneeId);
    if (assignee?.userId && assignee.inactive && mutation.item.assigneeId !== previous?.assigneeId) throw new WorkspaceError('This account is no longer a member. Choose an active member or another assignment label.');
    if (Array.isArray(mutation.item.comments)) mutation.item.comments = authenticatedComments(mutation.item.comments, previous?.comments || [], access);
  }
  if (mutation.action === 'import' && mutation.workspace && typeof mutation.workspace === 'object') {
    const imported = mutation.workspace as Workspace;
    for(const key of ['people','projects','tasks','notes','media','canvases','savedViews'] as const){
      if(!Array.isArray(imported[key])||!imported[key].every(item=>item&&typeof item==='object'&&!Array.isArray(item)&&typeof item.id==='string'))throw new WorkspaceError('The imported workspace contains invalid records.');
    }
    if(!imported.tasks.every(task=>Array.isArray(task.comments)&&task.comments.every(comment=>comment&&typeof comment==='object'&&!Array.isArray(comment))))throw new WorkspaceError('The imported discussions are invalid.');
    if (Array.isArray(imported.media)) imported.media = imported.media.map(file => canonicalMediaUrl(file as unknown as Record<string, unknown>) as unknown as Workspace['media'][number]);
    if (Array.isArray(imported.people)) {
      const remap = new Map<string, string>();
      imported.people = imported.people.map(person => {
        const verified = current.people.find(existing => existing.id === person.id && existing.userId && existing.userId === person.userId);
        if (verified) return verified;
        if (person.userId || person.id?.startsWith('account_')) {
          const id = `label_${crypto.randomUUID()}`;
          remap.set(person.id, id);
          return { id, name: person.name, role: person.role, color: person.color };
        }
        const { userId: _userId, inactive: _inactive, ...label } = person;
        return label;
      });
      for (const task of imported.tasks || []) {
        task.assigneeId = remap.get(task.assigneeId) || task.assigneeId;
        for (const comment of task.comments || []) comment.personId = remap.get(comment.personId) || comment.personId;
      }
      for (const view of imported.savedViews || []) view.assignee = remap.get(view.assignee) || view.assignee;
    }
    // Keep verified members present even if the imported backup predates them.
    const memberPeople = current.people.filter(person => person.userId);
    if (Array.isArray(imported.people)) for (const person of memberPeople) if (!imported.people.some(existing => existing.id === person.id)) imported.people.push(person);
    for (const task of imported.tasks || []) {
      const previous = current.tasks.find(existing => existing.id === task.id);
      for (const comment of task.comments || []) {
        if (!comment.personId?.startsWith('account_')) continue;
        const existing = previous?.comments.find(existing => existing.id === comment.id);
        if (existing && existing.personId === comment.personId && existing.body === comment.body && existing.createdAt === comment.createdAt) continue;
        comment.personId = access.user ? accountPersonId(access.user.id) : '';
        comment.createdAt = new Date().toISOString();
      }
    }
  }
  return mutation;
}

function authenticatedComments(incoming: unknown[], previous: Task['comments'], access: ResolvedWorkspace): unknown[] {
  const old = new Map(previous.map(comment => [comment.id, comment]));
  const result = incoming.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const comment = value as Task['comments'][number], existing = old.get(comment.id);
    if (existing) {
      if (existing.body !== comment.body) throw new WorkspaceError('Existing discussion messages cannot be changed through the task editor.');
      old.delete(comment.id);
      return existing;
    }
    return { ...comment, personId: access.user ? accountPersonId(access.user.id) : '', createdAt: new Date().toISOString() };
  });
  if (old.size) throw new WorkspaceError('Existing discussion messages cannot be removed through the task editor.');
  return result;
}

export async function readWorkspace(request: Request): Promise<Workspace> {
  const access = await resolveWorkspace(request);
  const workspace = await rawWorkspace(access);
  return withAccountPeople(workspace, access, await verifiedMembers(access));
}

export async function mutateWorkspace(request: Request, mutation: unknown): Promise<Workspace> {
  assertSameOrigin(request);
  const db = database();
  // Merge again against the latest committed data whenever another writer wins.
  for (let attempt = 0; attempt < 12; attempt++) {
    // Recheck membership on retries, including a removal during an edit.
    const access = await resolveWorkspace(request);
    const current = withAccountPeople(await rawWorkspace(access), access, await verifiedMembers(access));
    const updated = applyMutation(current, prepareMutation(mutation, current, access));
    for (const task of updated.tasks) {
      const assignee = updated.people.find(person => person.id === task.assigneeId);
      if (assignee?.userId && assignee.inactive && current.tasks.find(existing => existing.id === task.id)?.assigneeId !== task.assigneeId) throw new WorkspaceError('This account is no longer a member. Choose an active member or another assignment label.');
    }
    const authorization = access.user ? ' AND EXISTS (SELECT 1 FROM appmembers WHERE workspace_id = ? AND user_id = ?)' : '';
    const values: (string | number)[] = [JSON.stringify(updated), updated.revision, new Date().toISOString(), access.id, current.revision];
    if (access.user) values.push(access.id, access.user.id);
    const result = await db.prepare(`UPDATE workspaces SET data = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?${authorization}`).bind(...values).run();
    if (result.meta.changes === 1) return updated;
    await new Promise(resolve => setTimeout(resolve, 15 + Math.floor(Math.random() * 35) * (attempt + 1)));
  }
  throw new WorkspaceError('Several changes are being saved at once. Your change was not saved; try again.', 409);
}

export function routeError(error: unknown): Response {
  if (error instanceof WorkspaceError) return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  if (error instanceof SyntaxError) return Response.json({ error: 'The request must contain valid JSON.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  const message = error instanceof Error ? error.message : '';
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
  if (`${message} ${cause}`.includes('no such table')) return Response.json({ error: 'Local account storage needs its database setup. Run the ProjectAnvil launcher to apply the database migrations.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  console.error('Workspace request failed:', error);
  return Response.json({ error: 'The server could not save or load the workspace. Please try again.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
}

export async function readMutationRequest(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new WorkspaceError('Send this request as application/json.', 415);
  if (Number(request.headers.get('content-length') || 0) > 2_000_000) throw new WorkspaceError('This request is too large. Keep workspace imports below 1.5 MB.', 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 2_000_000) throw new WorkspaceError('This request is too large. Keep workspace imports below 1.5 MB.', 413);
  return JSON.parse(text);
}
