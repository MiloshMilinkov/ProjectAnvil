const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const Module = require('node:module');
const { createSeedWorkspace } = require('./compiled/app/lib/seed');
const { applyMutation, validateWorkspace } = require('./compiled/app/lib/workspace-model');

async function main() {
  const seed = createSeedWorkspace(new Date('2026-10-19T12:00:00Z'));
  assert.equal(validateWorkspace(seed).tasks.length, 14);
  assert.equal(seed.notes.length, 8);
  assert.equal(seed.people.length, 4);
  const empty = { name: 'Small studio', revision: 0, people: [], projects: [], tasks: [], notes: [], media: [], canvases: [], savedViews: [] };
  validateWorkspace(empty);
  const unassigned = applyMutation(empty, { action: 'upsert', entity: 'tasks', item: { id: 'first-task', title: 'First task' } });
  assert.equal(unassigned.tasks[0].projectId, '');
  assert.equal(unassigned.tasks[0].assigneeId, '');
  assert.equal(unassigned.tasks[0].key, 'TASK-1');
  const updated = applyMutation(seed, { action: 'upsert', entity: 'tasks', item: { id: 'task-1', priority: 'urgent' } });
  assert.equal(updated.tasks[0].title, seed.tasks[0].title);
  assert.equal(updated.tasks[0].priority, 'urgent');
  assert.equal(seed.tasks[0].priority, 'high', 'Mutations must not alter their input');
  assert.equal(updated.revision, 1);
  assert.throws(() => applyMutation(seed, { action: 'upsert', entity: 'tasks', item: { id: 'task-1', assigneeId: 'missing' } }), /missing person/);
  assert.throws(() => applyMutation(seed, { action: 'upsert', entity: 'tasks', item: { id: 'task-1', blockedBy: ['task-7'] } }), /cycle/);
  assert.throws(() => applyMutation(seed, { action: 'upsert', entity: 'tasks', item: { id: 'task-1', status: 'invalid' } }), /status/);
  assert.throws(() => applyMutation(seed, { action: 'upsert', entity: 'tasks', item: { id: 'task-1', dueDate: '2026-02-31' } }), /valid date/);
  assert.throws(() => applyMutation(seed, { action: 'delete', entity: 'projects', id: 'aetherfall' }), /Move or delete/);
  assert.throws(() => applyMutation(seed, { action: 'import', workspace: { ...seed, revision: 7 } }), /changed/);
  const note = applyMutation(seed, { action: 'upsert', entity: 'notes', item: { id: 'note-vision', content: '# New content' } });
  assert.equal(note.notes[0].snapshots[0].content, seed.notes[0].content);
  assert.equal(note.notes[0].snapshots.length, 1);
  const retainedHistory = applyMutation(note, { action: 'upsert', entity: 'notes', item: { id: 'note-vision', title: 'New title', snapshots: Array.from({ length: 30 }, (_, i) => ({ id: `stale-${i}`, content: 'stale', savedAt: seed.notes[0].createdAt })) } });
  assert.equal(retainedHistory.notes[0].snapshots.length, 1);
  assert.equal(retainedHistory.notes[0].snapshots[0].content, seed.notes[0].content);
  const quickEdit = applyMutation(note, { action: 'upsert', entity: 'notes', item: { id: 'note-vision', content: 'A quick next sentence' } });
  assert.equal(quickEdit.notes[0].snapshots.length, 1);
  const restored = applyMutation(quickEdit, { action: 'upsert', entity: 'notes', item: { id: 'note-vision', content: seed.notes[0].content } });
  assert.equal(restored.notes[0].snapshots.at(-1).content, 'A quick next sentence');
  const deletedNote = applyMutation(seed, { action: 'delete', entity: 'notes', id: 'note-city' });
  assert.equal(deletedNote.canvases[0].cards.some(card => card.entityId === 'note-city'), false);
  assert.equal(deletedNote.canvases[0].edges.some(edge => edge.from === 'card-city' || edge.to === 'card-city'), false);
  assert.equal(deletedNote.tasks.some(task => task.noteIds.includes('note-city')), false);
  const deletedPerson = applyMutation(seed, { action: 'delete', entity: 'people', id: 'person-jamie' });
  assert.equal(deletedPerson.tasks.some(task => task.assigneeId === 'person-jamie'), false);
  assert.throws(() => applyMutation(seed, { action: 'upsert', entity: 'canvases', item: { id: 'bad-canvas', title: 'Unsafe', cards: [{ id: 'bad-url', type: 'url', text: 'javascript:alert(1)', x: 0, y: 0, width: 200, height: 100, color: '#ffffff' }], edges: [] } }), /http/);
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE workspaces (id TEXT PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)');
  const DB = { prepare(query) {
    const statement = sql.prepare(query);
    return { bind(...values) {
      return { async first() { return statement.get(...values) || null; }, async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; } };
    } };
  } };
  const objects = new Map();
  const BUCKET = {
    async put(key, bytes) { objects.set(key, bytes); },
    async get(key, options) { const bytes = objects.get(key); return bytes ? { body: options?.range ? bytes.slice(options.range.offset, options.range.offset + options.range.length) : bytes, size: bytes.byteLength } : null; },
    async head(key) { const bytes = objects.get(key); return bytes ? { size: bytes.byteLength } : null; },
    async delete(key) { objects.delete(key); },
  };
  const originalLoad = Module._load;
  Module._load = function(specifier, ...args) {
    if (specifier === 'cloudflare:workers') return { env: { DB, BUCKET } };
    return originalLoad.call(this, specifier, ...args);
  };
  const store = require('./compiled/app/lib/workspace-store');
  await store.readWorkspace();
  await Promise.all(Array.from({ length: 8 }, (_, i) => store.mutateWorkspace({ action: 'upsert', entity: 'tasks', item: { id: `task-${i + 1}`, title: `Concurrent edit ${i}` } })));
  let state = await store.readWorkspace();
  assert.equal(state.revision, 8);
  for (let i = 0; i < 8; i++) assert.equal(state.tasks[i].title, `Concurrent edit ${i}`);
  await Promise.all([
    store.mutateWorkspace({ action: 'upsert', entity: 'tasks', item: { id: 'task-1', priority: 'low' } }),
    store.mutateWorkspace({ action: 'upsert', entity: 'tasks', item: { id: 'task-1', status: 'done' } }),
  ]);
  state = await store.readWorkspace();
  assert.equal(state.tasks[0].priority, 'low');
  assert.equal(state.tasks[0].status, 'done');
  await Promise.all([
    store.mutateWorkspace({ action: 'upsert', entity: 'tasks', item: { id: 'new-a', title: 'New task A', key: 'AET-15', projectId: 'aetherfall' } }),
    store.mutateWorkspace({ action: 'upsert', entity: 'tasks', item: { id: 'new-b', title: 'New task B', key: 'AET-15', projectId: 'aetherfall' } }),
  ]);
  state = await store.readWorkspace();
  const newTasks = state.tasks.filter(task => task.id.startsWith('new-'));
  assert.equal(newTasks.length, 2);
  assert.equal(new Set(newTasks.map(task => task.key)).size, 2);
  const upload = require('./compiled/app/api/media/route');
  const form = new FormData();
  form.append('file', new File(['<script>alert(1)</script>'], 'unsafe.html', { type: 'text/html' }));
  const response = await upload.POST(new Request('https://forgeboard.example/api/media', { method: 'POST', body: form }));
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.workspace.media.length, 1);
  const download = require('./compiled/app/api/media/[id]/route');
  const fileResponse = await download.GET(new Request(`https://forgeboard.example${payload.media.url}`), { params: Promise.resolve({ id: payload.media.id }) });
  assert.equal(fileResponse.status, 200);
  assert.equal(fileResponse.headers.get('content-type'), 'application/octet-stream');
  assert.match(fileResponse.headers.get('content-disposition'), /^attachment/);
  assert.equal(fileResponse.headers.get('x-content-type-options'), 'nosniff');
  const ranged = await download.GET(new Request(`https://forgeboard.example${payload.media.url}`, { headers: { range: 'bytes=0-6' } }), { params: Promise.resolve({ id: payload.media.id }) });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-length'), '7');
  assert.match(ranged.headers.get('content-range'), /^bytes 0-6\//);
  assert.equal((await ranged.arrayBuffer()).byteLength, 7);
  const invalidRange = await download.GET(new Request(`https://forgeboard.example${payload.media.url}`, { headers: { range: 'bytes=9999-' } }), { params: Promise.resolve({ id: payload.media.id }) });
  assert.equal(invalidRange.status, 416);
  const stateRoute = require('./compiled/app/api/state/route');
  assert.equal((await stateRoute.GET()).status, 200);
  const invalid = await stateRoute.POST(new Request('https://forgeboard.example/api/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' }));
  assert.equal(invalid.status, 400);
  console.log('PASS: seed, empty workspace, partial merges, references, dependency cycles, dates, snapshot intervals/restoration, cleanup, stale import, unsafe URLs, concurrent SQLite CAS/task key allocation, media persistence/safe downloads, malformed JSON.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
