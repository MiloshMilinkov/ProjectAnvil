import { env } from 'cloudflare:workers';
import { createSeedWorkspace } from './seed';
import { applyMutation, WorkspaceError } from './workspace-model';
import type { Workspace } from './types';

const workspaceId = 'main';
interface WorkspaceRow { data: string; revision: number }

function database(): D1Database {
  if (!env.DB) throw new WorkspaceError('Workspace storage is unavailable. Enable the DB database binding before using this app.', 503);
  return env.DB;
}

export async function readWorkspace(): Promise<Workspace> {
  const db = database();
  let row = await db.prepare('SELECT data, revision FROM workspaces WHERE id = ?').bind(workspaceId).first<WorkspaceRow>();
  if (!row) {
    const seed = createSeedWorkspace();
    await db.prepare('INSERT OR IGNORE INTO workspaces (id, data, revision, updated_at) VALUES (?, ?, ?, ?)')
      .bind(workspaceId, JSON.stringify(seed), 0, new Date().toISOString()).run();
    row = await db.prepare('SELECT data, revision FROM workspaces WHERE id = ?').bind(workspaceId).first<WorkspaceRow>();
  }
  if (!row) throw new WorkspaceError('The workspace could not be opened. Please try again.', 503);
  const workspace = JSON.parse(row.data) as Workspace;
  workspace.revision = row.revision;
  return workspace;
}

export async function mutateWorkspace(mutation: unknown): Promise<Workspace> {
  const db = database();
  // Merge again against the latest committed data whenever another writer wins.
  for (let attempt = 0; attempt < 12; attempt++) {
    const current = await readWorkspace();
    const updated = applyMutation(current, mutation);
    const result = await db.prepare('UPDATE workspaces SET data = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?')
      .bind(JSON.stringify(updated), updated.revision, new Date().toISOString(), workspaceId, current.revision).run();
    if (result.meta.changes === 1) return updated;
    await new Promise(resolve => setTimeout(resolve, 15 + Math.floor(Math.random() * 35) * (attempt + 1)));
  }
  throw new WorkspaceError('Several teammates are saving at once. Your change was not saved; try again.', 409);
}

export function routeError(error: unknown): Response {
  if (error instanceof WorkspaceError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof SyntaxError) return Response.json({ error: 'The request must contain valid JSON.' }, { status: 400 });
  const message = error instanceof Error ? error.message : '';
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
  if (`${message} ${cause}`.includes('no such table')) {
    return Response.json({ error: 'Workspace storage needs its initial database migration. Apply the generated migration and reload the app.' }, { status: 503 });
  }
  console.error('Workspace request failed:', error);
  return Response.json({ error: 'The server could not save or load the workspace. Please try again.' }, { status: 500 });
}

export async function readMutationRequest(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new WorkspaceError('Send this request as application/json.', 415);
  if (Number(request.headers.get('content-length') || 0) > 2_000_000) throw new WorkspaceError('This request is too large. Keep workspace imports below 1.5 MB.', 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 2_000_000) throw new WorkspaceError('This request is too large. Keep workspace imports below 1.5 MB.', 413);
  return JSON.parse(text);
}
