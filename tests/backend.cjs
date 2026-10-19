const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const Module = require('node:module');
const { createSeedWorkspace } = require('./compiled/app/lib/seed');
const { applyMutation, validateWorkspace } = require('./compiled/app/lib/workspace-model');

const now = '2026-10-19T12:00:00Z';
const collections = ['people', 'projects', 'tasks', 'notes', 'media', 'canvases', 'savedViews'];

// Explicit test data belongs here rather than in a new user's workspace.
function fixtureWorkspace() {
  let state = createSeedWorkspace();
  const add = (entity, item) => { state = applyMutation(state, { action: 'upsert', entity, item }, now); };
  add('people', { id: 'person-alex', name: 'Test director', role: '', color: '#8a78fa' });
  add('people', { id: 'person-jamie', name: 'Test engineer', role: '', color: '#54b5cc' });
  add('projects', { id: 'test-project', name: 'Test project', key: 'TST' });
  add('notes', { id: 'note-vision', title: 'Test vision', content: '# Test vision', projectId: 'test-project' });
  add('notes', { id: 'note-city', title: 'Test place', content: '# Test place', projectId: 'test-project' });
  add('tasks', { id: 'task-1', title: 'Test interaction', key: 'TST-1', priority: 'high', projectId: 'test-project', assigneeId: 'person-jamie', noteIds: ['note-city'], comments: [{ id: 'comment-1', personId: 'person-alex', body: 'Test comment', createdAt: now }] });
  add('tasks', { id: 'task-2', title: 'Test environment', key: 'TST-2', projectId: 'test-project' });
  add('tasks', { id: 'task-7', title: 'Test playtest', key: 'TST-7', projectId: 'test-project', blockedBy: ['task-1'] });
  add('canvases', { id: 'canvas-world', title: 'Test canvas', cards: [
    { id: 'card-vision', x: 0, y: 0, width: 200, height: 100, type: 'note', entityId: 'note-vision', text: '', color: '#8a78fa' },
    { id: 'card-city', x: 240, y: 0, width: 200, height: 100, type: 'note', entityId: 'note-city', text: '', color: '#54b5cc' },
  ], edges: [{ id: 'test-edge', from: 'card-vision', to: 'card-city', label: 'Test connection' }] });
  return { ...state, revision: 0 };
}

async function main() {
  const empty = createSeedWorkspace();
  assert.equal(empty.name, 'My workspace');
  assert.equal(empty.revision, 0);
  for (const key of collections) assert.deepEqual(empty[key], [], `New workspace must not contain ${key}`);
  validateWorkspace(empty);
  let guest = applyMutation(empty, { action: 'upsert', entity: 'tasks', item: { id: 'first-task', title: 'First task' } });
  assert.equal(guest.tasks[0].projectId, '');
  assert.equal(guest.tasks[0].assigneeId, '');
  assert.equal(guest.tasks[0].key, 'TASK-1');
  guest = applyMutation(guest, { action: 'upsert', entity: 'tasks', item: { id: 'first-task', comments: [{ id: 'guest-comment', personId: '', body: 'Created as a guest', createdAt: now }] } });
  guest = applyMutation(guest, { action: 'upsert', entity: 'notes', item: { id: 'first-note', title: 'First note', content: 'A guest can write without creating a project.' } });
  guest = applyMutation(guest, { action: 'upsert', entity: 'canvases', item: { id: 'first-canvas', title: 'First canvas', cards: [
    { id: 'guest-note-card', x: 0, y: 0, width: 200, height: 100, type: 'note', entityId: 'first-note', text: '', color: '#8a78fa' },
    { id: 'guest-task-card', x: 240, y: 0, width: 200, height: 100, type: 'task', entityId: 'first-task', text: '', color: '#54b5cc' },
  ], edges: [{ id: 'guest-edge', from: 'guest-note-card', to: 'guest-task-card', label: 'Plan' }] } });
  assert.equal(guest.people.length, 0);
  assert.equal(guest.projects.length, 0);
  assert.equal(guest.notes[0].projectId, '');
  assert.equal(guest.tasks[0].comments[0].personId, '');
  assert.equal(guest.canvases[0].cards.length, 2);
  const guestImport = applyMutation(guest, { action: 'import', workspace: JSON.parse(JSON.stringify(guest)) });
  assert.equal(guestImport.tasks[0].comments[0].body, 'Created as a guest');
  assert.equal(guestImport.people.length, 0);

  const seed = fixtureWorkspace();
  const updated = applyMutation(seed, { action: 'upsert', entity: 'tasks', item: { id: 'task-1', priority: 'urgent' } });
  assert.equal(updated.tasks[0].title, seed.tasks[0].title);
  assert.equal(updated.tasks[0].priority, 'urgent');
  assert.equal(seed.tasks[0].priority, 'high', 'Mutations must not alter their input');
  assert.equal(updated.revision, 1);
  assert.throws(() => applyMutation(seed, { action: 'upsert', entity: 'tasks', item: { id: 'task-1', assigneeId: 'missing' } }), /missing person/);
  assert.throws(() => applyMutation(seed, { action: 'upsert', entity: 'tasks', item: { id: 'task-1', comments: [{ id: 'missing-author', personId: 'missing', body: 'Bad reference', createdAt: now }] } }), /missing person/);
  assert.throws(() => applyMutation(seed, { action: 'upsert', entity: 'tasks', item: { id: 'task-1', blockedBy: ['task-7'] } }), /cycle/);
  assert.throws(() => applyMutation(seed, { action: 'upsert', entity: 'tasks', item: { id: 'task-1', status: 'invalid' } }), /status/);
  assert.throws(() => applyMutation(seed, { action: 'upsert', entity: 'tasks', item: { id: 'task-1', dueDate: '2026-02-31' } }), /valid date/);
  assert.throws(() => applyMutation(seed, { action: 'delete', entity: 'projects', id: 'test-project' }), /Move or delete/);
  assert.throws(() => applyMutation(seed, { action: 'import', workspace: { ...seed, revision: 7 } }), /changed/);
  const note = applyMutation(seed, { action: 'upsert', entity: 'notes', item: { id: 'note-vision', content: '# New content' } });
  assert.equal(note.notes[0].snapshots[0].content, seed.notes[0].content);
  assert.equal(note.notes[0].snapshots.length, 1);
  const retainedHistory = applyMutation(note, { action: 'upsert', entity: 'notes', item: { id: 'note-vision', title: 'New title', snapshots: Array.from({ length: 30 }, (_, i) => ({ id: `stale-${i}`, content: 'stale', savedAt: now })) } });
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
  const deletedAuthor = applyMutation(seed, { action: 'delete', entity: 'people', id: 'person-alex' });
  assert.equal(deletedAuthor.tasks[0].comments[0].personId, '');
  assert.equal(deletedAuthor.tasks[0].comments[0].body, 'Test comment');
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
  const initial = await store.readWorkspace();
  for (const key of collections) assert.equal(initial[key].length, 0, `Stored workspace must start without ${key}`);
  await Promise.all(Array.from({ length: 8 }, (_, i) => store.mutateWorkspace({ action: 'upsert', entity: 'tasks', item: { id: `task-${i + 1}`, title: `Concurrent edit ${i}` } })));
  let state = await store.readWorkspace();
  assert.equal(state.revision, 8);
  for (let i = 0; i < 8; i++) assert.equal(state.tasks.find(task => task.id === `task-${i + 1}`).title, `Concurrent edit ${i}`);
  await Promise.all([
    store.mutateWorkspace({ action: 'upsert', entity: 'tasks', item: { id: 'task-1', priority: 'low' } }),
    store.mutateWorkspace({ action: 'upsert', entity: 'tasks', item: { id: 'task-1', status: 'done' } }),
  ]);
  state = await store.readWorkspace();
  assert.equal(state.tasks[0].priority, 'low');
  assert.equal(state.tasks[0].status, 'done');
  await Promise.all([
    store.mutateWorkspace({ action: 'upsert', entity: 'tasks', item: { id: 'new-a', title: 'New task A', key: 'TASK-9' } }),
    store.mutateWorkspace({ action: 'upsert', entity: 'tasks', item: { id: 'new-b', title: 'New task B', key: 'TASK-9' } }),
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
  assert.equal(payload.workspace.people.length, 0);
  assert.equal(payload.workspace.projects.length, 0);
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
  const post = mutation => stateRoute.POST(new Request('https://forgeboard.example/api/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mutation) }));
  const commentResponse = await post({ action: 'upsert', entity: 'tasks', item: { id: 'task-1', comments: [{ id: 'local-guest-comment', personId: '', body: 'Guest comment persists', createdAt: now }] } });
  assert.equal(commentResponse.status, 200);
  assert.equal((await commentResponse.json()).workspace.tasks[0].comments[0].personId, '');
  const exported = await require('./compiled/app/api/export/route').GET();
  assert.equal(exported.status, 200);
  const backup = await exported.json();
  assert.equal(backup.tasks[0].comments[0].body, 'Guest comment persists');
  assert.equal(backup.people.length, 0);
  const importResponse = await post({ action: 'import', workspace: backup });
  assert.equal(importResponse.status, 200);
  assert.equal((await importResponse.json()).workspace.tasks[0].comments[0].personId, '');
  const invalid = await stateRoute.POST(new Request('https://forgeboard.example/api/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' }));
  assert.equal(invalid.status, 400);
  state = await store.readWorkspace();
  await store.mutateWorkspace({ action: 'import', workspace: { ...createSeedWorkspace(), revision: state.revision } });
  const reopened = await store.readWorkspace();
  for (const key of collections) assert.equal(reopened[key].length, 0, `Reopening a cleared workspace must not repopulate ${key}`);
  console.log('PASS: clean guest initialization, project-free tasks/notes/canvas/media, guest comments and export/import, partial merges, references, dependency cycles, dates, snapshot history, cleanup, stale import, unsafe URLs, concurrent SQLite CAS/task key allocation, media persistence/safe downloads, malformed JSON, empty workspace reopening.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
