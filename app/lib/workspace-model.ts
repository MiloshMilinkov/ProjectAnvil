import { z } from 'zod';
import type { Entity, Mutation, Workspace } from './types';

export class WorkspaceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const id = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/, 'Use letters, numbers, dashes, or underscores for IDs.');
const reference = z.union([id, z.literal('')]);
const short = z.string().max(300);
const title = short.refine(value => value.trim().length > 0, 'A name or title is required.');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Choose a six-digit hex color.');
const date = z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Choose a valid date.')]);
const timestamp = z.string().datetime({ offset: true });
const content = z.string().max(100_000, 'Keep a single note or description under 100,000 characters.');
const tags = z.array(z.string().min(1).max(80)).max(40);
const references = z.array(id).max(500).refine(values => new Set(values).size === values.length, 'Remove duplicate links.');
const uniqueIds = <T extends { id: string }>(values: T[]) => new Set(values.map(value => value.id)).size === values.length;
const people = z.object({ id, name: title, role: short, color }).strict();
const projects = z.object({ id, name: title, key: z.string().min(1).max(15).regex(/^[A-Za-z0-9_-]+$/), description: z.string().max(10_000), color, status: short, goal: z.string().max(10_000), targetDate: date }).strict();
const tasks = z.object({
  id, key: z.string().min(1).max(50), title, description: content,
  status: z.enum(['backlog', 'todo', 'in-progress', 'review', 'done']),
  priority: z.enum(['urgent', 'high', 'medium', 'low']), type: z.enum(['task', 'bug', 'story', 'epic']),
  projectId: reference, assigneeId: reference, dueDate: date, estimate: z.number().finite().min(0).max(100_000),
  tags, noteIds: references, blockedBy: references,
  subtasks: z.array(z.object({ id, title, done: z.boolean() }).strict()).max(200).refine(uniqueIds, 'Subtask IDs must be unique.'),
  comments: z.array(z.object({ id, personId: reference, body: z.string().min(1).max(10_000), createdAt: timestamp }).strict()).max(500).refine(uniqueIds, 'Comment IDs must be unique.'),
  createdAt: timestamp, updatedAt: timestamp,
}).strict();
const notes = z.object({
  id, title, content, folder: z.string().max(300), tags, projectId: reference,
  kind: z.enum(['note', 'world', 'character', 'research', 'daily', 'meeting']), bookmarked: z.boolean(),
  properties: z.record(z.string().max(80), z.string().max(2000)).refine(value => Object.keys(value).length <= 50, 'Use at most 50 properties.'),
  snapshots: z.array(z.object({ id, content, savedAt: timestamp }).strict()).max(12), createdAt: timestamp, updatedAt: timestamp,
}).strict();
const media = z.object({ id, name: title, url: z.string().max(500).regex(/^\/api\/media\/[a-zA-Z0-9_-]+$/, 'Media must use this workspace’s upload endpoint.'), type: z.string().max(150), size: z.number().int().min(0).max(20 * 1024 * 1024), createdAt: timestamp }).strict();
const canvasCard = z.object({
  id, x: z.number().finite().min(-100_000).max(100_000), y: z.number().finite().min(-100_000).max(100_000),
  width: z.number().finite().min(80).max(4000), height: z.number().finite().min(60).max(4000),
  type: z.enum(['note', 'task', 'text', 'media', 'url']), entityId: id.optional(), text: z.string().max(10_000), color,
}).strict();
const canvases = z.object({
  id, title, cards: z.array(canvasCard).max(500).refine(uniqueIds, 'Canvas card IDs must be unique.'),
  edges: z.array(z.object({ id, from: id, to: id, label: z.string().max(300) }).strict()).max(1500).refine(uniqueIds, 'Canvas connection IDs must be unique.'),
}).strict();
const savedViews = z.object({ id, name: title, query: z.string().max(500), assignee: reference, priority: z.union([z.literal(''), z.enum(['urgent', 'high', 'medium', 'low'])]), project: reference, status: z.union([z.literal(''), z.enum(['backlog', 'todo', 'in-progress', 'review', 'done'])]) }).strict();
const entitySchemas = { people, projects, tasks, notes, media, canvases, savedViews };
const workspaceSchema = z.object({
  name: title, revision: z.number().int().nonnegative(),
  people: z.array(people).max(200).refine(uniqueIds, 'Person IDs must be unique.'),
  projects: z.array(projects).max(100).refine(uniqueIds, 'Project IDs must be unique.'),
  tasks: z.array(tasks).max(1500).refine(uniqueIds, 'Task IDs must be unique.'),
  notes: z.array(notes).max(1000).refine(uniqueIds, 'Note IDs must be unique.'),
  media: z.array(media).max(500).refine(uniqueIds, 'Media IDs must be unique.'),
  canvases: z.array(canvases).max(100).refine(uniqueIds, 'Canvas IDs must be unique.'),
  savedViews: z.array(savedViews).max(100).refine(uniqueIds, 'Saved view IDs must be unique.'),
}).strict();
const mutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('upsert'), entity: z.enum(['people', 'projects', 'tasks', 'notes', 'media', 'canvases', 'savedViews']), item: z.record(z.unknown()) }).strict(),
  z.object({ action: z.literal('delete'), entity: z.enum(['people', 'projects', 'tasks', 'notes', 'media', 'canvases', 'savedViews']), id }).strict(),
  z.object({ action: z.literal('rename'), name: title }).strict(),
  z.object({ action: z.literal('import'), workspace: workspaceSchema }).strict(),
]);

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new WorkspaceError(`${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`);
  }
  return result.data;
}

export function validateWorkspace(value: unknown): Workspace {
  const workspace = parse(workspaceSchema, value) as Workspace;
  const known = {
    people: new Set(workspace.people.map(item => item.id)),
    projects: new Set(workspace.projects.map(item => item.id)),
    tasks: new Set(workspace.tasks.map(item => item.id)),
    notes: new Set(workspace.notes.map(item => item.id)),
    media: new Set(workspace.media.map(item => item.id)),
  };
  function check(value: string, collection: keyof typeof known, context: string) {
    if (value && !known[collection].has(value)) throw new WorkspaceError(`${context} refers to a missing ${collection === 'people' ? 'person' : collection.slice(0, -1)}. Refresh and try again.`);
  }
  const taskKeys = new Set<string>();
  for (const task of workspace.tasks) {
    if (taskKeys.has(task.key)) throw new WorkspaceError(`Task key ${task.key} is already in use.`);
    taskKeys.add(task.key);
    check(task.projectId, 'projects', task.title);
    check(task.assigneeId, 'people', task.title);
    task.noteIds.forEach(value => check(value, 'notes', task.title));
    task.blockedBy.forEach(value => {
      check(value, 'tasks', task.title);
      if (value === task.id) throw new WorkspaceError('A task cannot block itself.');
    });
    task.comments.forEach(comment => check(comment.personId, 'people', 'Comment'));
  }
  // Cyclic dependencies make the board impossible to complete.
  const tasksById = new Map(workspace.tasks.map(task => [task.id, task]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(taskId: string) {
    if (visiting.has(taskId)) throw new WorkspaceError('This dependency creates a cycle. Remove one of the blocking links.');
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    tasksById.get(taskId)?.blockedBy.forEach(visit);
    visiting.delete(taskId);
    visited.add(taskId);
  }
  workspace.tasks.forEach(task => visit(task.id));
  const titles = new Set<string>();
  for (const note of workspace.notes) {
    const normalized = note.title.trim().toLowerCase();
    if (titles.has(normalized)) throw new WorkspaceError(`A note named “${note.title}” already exists. Give notes unique titles so wiki links resolve reliably.`);
    titles.add(normalized);
    check(note.projectId, 'projects', note.title);
  }
  const projectKeys = new Set<string>();
  for (const project of workspace.projects) {
    if (projectKeys.has(project.key.toUpperCase())) throw new WorkspaceError(`Project key ${project.key} is already in use.`);
    projectKeys.add(project.key.toUpperCase());
  }
  for (const file of workspace.media) {
    if (file.url !== `/api/media/${file.id}`) throw new WorkspaceError('Attachment URLs must match their file IDs.');
  }
  for (const canvas of workspace.canvases) {
    const cards = new Set(canvas.cards.map(card => card.id));
    for (const card of canvas.cards) {
      if (card.type === 'note' || card.type === 'task' || card.type === 'media') {
        if (!card.entityId) throw new WorkspaceError('Choose an item for each linked canvas card.');
        check(card.entityId, card.type === 'media' ? 'media' : card.type === 'note' ? 'notes' : 'tasks', canvas.title);
      }
      if (card.type === 'url') {
        try {
          const url = new URL(card.text);
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
        } catch { throw new WorkspaceError('Web cards need a complete http:// or https:// address.'); }
      }
    }
    for (const edge of canvas.edges) if (!cards.has(edge.from) || !cards.has(edge.to)) throw new WorkspaceError('A canvas connection refers to a missing card.');
  }
  for (const view of workspace.savedViews) {
    check(view.assignee, 'people', view.name);
    check(view.project, 'projects', view.name);
  }
  if (new TextEncoder().encode(JSON.stringify(workspace)).byteLength > 1_500_000) {
    throw new WorkspaceError('This workspace has reached its 1.5 MB text storage limit. Export a backup and remove unused notes or snapshots. Media files are stored separately.');
  }
  return workspace;
}

function defaults(entity: Entity, now: string): Record<string, unknown> {
  const base = { id: crypto.randomUUID() };
  switch (entity) {
    case 'people': return { ...base, role: '', color: '#8a78fa' };
    case 'projects': return { ...base, description: '', color: '#8a78fa', status: 'Planning', goal: '', targetDate: '' };
    case 'tasks': return { ...base, description: '', status: 'todo', priority: 'medium', type: 'task', projectId: '', assigneeId: '', dueDate: '', estimate: 0, tags: [], noteIds: [], blockedBy: [], subtasks: [], comments: [], createdAt: now, updatedAt: now };
    case 'notes': return { ...base, content: '', folder: '', tags: [], projectId: '', kind: 'note', bookmarked: false, properties: {}, snapshots: [], createdAt: now, updatedAt: now };
    case 'canvases': return { ...base, cards: [], edges: [] };
    case 'savedViews': return { ...base, query: '', assignee: '', priority: '', project: '', status: '' };
    case 'media': return base;
  }
}

export function applyMutation(current: Workspace, input: unknown, now = new Date().toISOString()): Workspace {
  const mutation = parse(mutationSchema, input) as Mutation;
  const next = structuredClone(current);
  if (mutation.action === 'rename') next.name = mutation.name!.trim();
  if (mutation.action === 'import') {
    if (mutation.workspace!.revision !== current.revision) throw new WorkspaceError('The workspace changed since this backup was opened. Refresh, export the current version, and retry the import with the latest revision.', 409);
    return validateWorkspace({ ...mutation.workspace!, revision: current.revision + 1 });
  }
  if (mutation.action === 'upsert') {
    const entity = mutation.entity!;
    const values = next[entity] as { id: string }[];
    const existing = values.find(item => item.id === mutation.item.id);
    const merged = { ...defaults(entity, now), ...existing, ...mutation.item };
    if (entity === 'tasks' && !existing) {
      const requestedKey = typeof merged.key === 'string' ? merged.key.trim() : '';
      if (!requestedKey || next.tasks.some(task => task.key === requestedKey)) {
        const project = next.projects.find(project => project.id === merged.projectId);
        const prefix = project?.key || 'TASK';
        const suffixes = next.tasks.filter(task => task.key.startsWith(`${prefix}-`))
          .map(task => Number(task.key.slice(prefix.length + 1))).filter(Number.isFinite);
        let number = Math.max(0, ...suffixes) + 1;
        while (next.tasks.some(task => task.key === `${prefix}-${number}`)) number++;
        merged.key = `${prefix}-${number}`;
      }
    }
    if (entity === 'notes' || entity === 'tasks') merged.updatedAt = now;
    if (existing && (entity === 'tasks' || entity === 'notes')) merged.createdAt = (existing as { id: string; createdAt: string }).createdAt;
    if (entity === 'notes' && existing) {
      const previous = existing as Workspace['notes'][number];
      // History belongs to the committed note, not an editor's stale local draft.
      merged.snapshots = previous.snapshots;
      if (merged.content !== previous.content) {
        const latest = previous.snapshots[previous.snapshots.length - 1];
        const restoring = previous.snapshots.some(snapshot => snapshot.content === merged.content);
        // Autosave can run on every pause. Keep useful intervals rather than 12 keystrokes.
        if (!latest || restoring || new Date(now).getTime() - new Date(latest.savedAt).getTime() >= 30_000) {
          merged.snapshots = [...previous.snapshots, { id: crypto.randomUUID(), content: previous.content, savedAt: now }].slice(-12);
        }
      }
    }
    const parsed = parse(entitySchemas[entity] as z.ZodType<{ id: string }>, merged);
    if (existing) values[values.indexOf(existing)] = parsed;
    else values.push(parsed);
  }
  if (mutation.action === 'delete') {
    const entity = mutation.entity!;
    const deletedId = mutation.id!;
    const values = next[entity] as { id: string }[];
    if (!values.some(item => item.id === deletedId)) throw new WorkspaceError('This item has already been removed. Refresh to see the latest workspace.', 404);
    if (entity === 'projects' && (next.tasks.some(item => item.projectId === deletedId) || next.notes.some(item => item.projectId === deletedId))) {
      throw new WorkspaceError('Move or delete this project’s tasks and notes before deleting the project.');
    }
    values.splice(values.findIndex(item => item.id === deletedId), 1);
    if (entity === 'people') {
      next.tasks.forEach(task => {
        if (task.assigneeId === deletedId) task.assigneeId = '';
        task.comments.forEach(comment => { if (comment.personId === deletedId) comment.personId = ''; });
      });
      next.savedViews.forEach(view => { if (view.assignee === deletedId) view.assignee = ''; });
    }
    if (entity === 'projects') next.savedViews.forEach(view => { if (view.project === deletedId) view.project = ''; });
    if (entity === 'notes') next.tasks.forEach(task => { task.noteIds = task.noteIds.filter(value => value !== deletedId); });
    if (entity === 'tasks') next.tasks.forEach(task => { task.blockedBy = task.blockedBy.filter(value => value !== deletedId); });
    const cardType = entity === 'notes' ? 'note' : entity === 'tasks' ? 'task' : entity === 'media' ? 'media' : '';
    if (cardType) next.canvases.forEach(canvas => {
      canvas.cards = canvas.cards.filter(card => card.type !== cardType || card.entityId !== deletedId);
      const remaining = new Set(canvas.cards.map(card => card.id));
      canvas.edges = canvas.edges.filter(edge => remaining.has(edge.from) && remaining.has(edge.to));
    });
  }
  next.revision = current.revision + 1;
  return validateWorkspace(next);
}
