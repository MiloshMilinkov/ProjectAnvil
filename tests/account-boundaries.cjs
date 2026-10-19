const assert = require('node:assert/strict');

// These tests exercise the real access SQL, workspace store and HTTP handlers.
// Only session verification is replaced by the fixture identity in backend.cjs;
// the real Better Auth credentials/cookies are checked by the HTTP smoke test.
module.exports = async function checkAccountBoundaries({ sql, store, access, users, request }) {
  const stateRoute = require('./compiled/app/api/state/route');
  const teamRoute = require('./compiled/app/api/teams/route');
  const accountRoute = require('./compiled/app/api/account/route');
  const exportRoute = require('./compiled/app/api/export/route');
  const uploadRoute = require('./compiled/app/api/media/route');
  const downloadRoute = require('./compiled/app/api/media/[id]/route');
  const fixtures = [
    { id: 'alice', username: 'alice', email: 'alice@gmail.com', name: 'alice' },
    { id: 'bob', username: 'bob', email: 'bob@gmail.com', name: 'bob' },
    { id: 'charlie', username: 'charlie', email: 'charlie@gmail.com', name: 'charlie' },
  ];
  for (const user of fixtures) {
    users.set(user.id, user);
    // Use the actual migrated Better Auth user table, rather than a fake access
    // repository that could hide misspelled columns or joins.
    sql.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, username) VALUES (?, ?, ?, 0, ?, ?, ?)')
      .run(user.id, user.name, user.email, Date.now(), Date.now(), user.username);
  }
  const req = (user, workspace, path = '/api/state', options = {}) => request(path, user, workspace, options);
  const mutation = (user, workspace, body, headers = {}) => stateRoute.POST(req(user, workspace, '/api/state', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }));
  const teamMutation = (user, body, headers = {}) => teamRoute.POST(req(user, '', '/api/teams', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }));
  const rejected = async (callback, status) => assert.rejects(callback, error => error.status === status);
  const alice = await access.resolveWorkspace(req('alice'));
  const bob = await access.resolveWorkspace(req('bob'));
  const guest = await access.resolveWorkspace(req());
  assert.equal(alice.kind, 'personal');
  assert.equal(alice.role, 'owner');
  assert.notEqual(alice.id, bob.id);
  assert.equal(guest.id, 'main');
  assert.equal(guest.user, null);
  assert.equal((await access.getAccountContext(req('alice'))).workspaces.some(item => item.id === 'main'), false);
  await rejected(() => access.resolveWorkspace(req('alice', bob.id)), 404);
  await rejected(() => access.resolveWorkspace(req('bob', alice.id)), 404);
  await rejected(() => access.resolveWorkspace(req('', alice.id)), 401);
  await rejected(() => access.resolveWorkspace(req('alice', 'main')), 404);
  await rejected(() => access.resolveWorkspace(req('alice', '../../main')), 400);
  await store.mutateWorkspace(req('alice'), { action: 'upsert', entity: 'notes', item: { id: 'alice-private', title: 'Alice private', content: 'private alice content' } });
  await store.mutateWorkspace(req('bob'), { action: 'upsert', entity: 'notes', item: { id: 'bob-private', title: 'Bob private', content: 'private bob content' } });
  await store.mutateWorkspace(req(), { action: 'upsert', entity: 'notes', item: { id: 'guest-only', title: 'Guest only', content: 'local guest content' } });
  for (const [user, expected] of [['alice', 'alice-private'], ['bob', 'bob-private'], ['', 'guest-only']]) {
    const workspace = await store.readWorkspace(req(user));
    assert.deepEqual(workspace.notes.map(note => note.id), [expected]);
  }
  assert.equal((await stateRoute.GET(req('alice', bob.id))).status, 404);
  assert.equal((await stateRoute.GET(req('alice', '', '/api/state', { headers: { 'x-account-id': 'bob' } }))).status, 409);
  assert.equal((await stateRoute.GET(req('', '', '/api/state', { headers: { 'x-account-id': 'alice' } }))).status, 409);
  assert.equal((await mutation('alice', '', { action: 'rename', name: 'Stale account write' }, { 'x-account-id': 'guest' })).status, 409);
  assert.equal((await mutation('bob', alice.id, { action: 'rename', name: 'Stolen' })).status, 404);
  assert.equal((await mutation('alice', '', { action: 'rename', name: 'CSRF' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await mutation('alice', '', { action: 'rename', name: 'CSRF' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await teamMutation('', { action: 'create', name: 'Anonymous team' })).status, 401);
  assert.equal((await teamMutation('alice', { action: 'create', name: 'Team project space' }, { origin: 'https://evil.example' })).status, 403);

  await access.teamAction(req('alice'), { action: 'create', name: 'Team project space' });
  const team = (await access.getAccountContext(req('alice'))).workspaces.find(item => item.kind === 'team');
  assert.ok(team);
  assert.equal(team.role, 'owner');
  await store.mutateWorkspace(req('alice', team.id), { action: 'upsert', entity: 'projects', item: { id: 'shared-project', name: 'Shared project', key: 'TEAM' } });
  await store.mutateWorkspace(req('alice', team.id), { action: 'upsert', entity: 'notes', item: { id: 'shared-note', title: 'Shared note', content: 'team content', projectId: 'shared-project' } });
  await store.mutateWorkspace(req('alice', team.id), { action: 'upsert', entity: 'tasks', item: { id: 'shared-task', title: 'Shared task', projectId: 'shared-project' } });
  await rejected(() => access.resolveWorkspace(req('bob', team.id)), 404);
  await access.teamAction(req('alice'), { action: 'invite', workspaceId: team.id, username: 'BOB' });
  const invitation = (await access.getAccountContext(req('bob'))).invitations[0];
  assert.equal(invitation.workspaceId, team.id);
  assert.equal(invitation.invitedBy, 'alice');
  assert.equal((await access.getAccountContext(req('bob'))).workspaces.some(item => item.id === team.id), false);
  await rejected(() => access.resolveWorkspace(req('bob', team.id)), 404);
  await rejected(() => access.teamAction(req('charlie'), { action: 'accept', invitationId: invitation.id }), 404);
  await access.teamAction(req('bob'), { action: 'accept', invitationId: invitation.id });
  assert.equal((await access.resolveWorkspace(req('bob', team.id))).role, 'member');
  assert.equal((await access.getAccountContext(req('bob'))).invitations.length, 0);
  const shared = await store.readWorkspace(req('bob', team.id));
  assert.equal(shared.notes[0].id, 'shared-note');
  assert.equal(shared.tasks[0].projectId, 'shared-project');
  assert.equal(shared.notes.some(note => /private/.test(note.id)), false);
  await store.mutateWorkspace(req('bob', team.id), { action: 'upsert', entity: 'tasks', item: { id: 'shared-task', status: 'done' } });
  assert.equal((await store.readWorkspace(req('alice', team.id))).tasks[0].status, 'done');
  assert.equal((await store.readWorkspace(req('bob'))).notes[0].id, 'bob-private');
  assert.equal((await mutation('bob', team.id, { action: 'rename', name: 'Member rename' })).status, 403);
  assert.equal((await mutation('bob', team.id, { action: 'import', workspace: shared })).status, 403);
  assert.equal((await mutation('bob', team.id, { action: 'upsert', entity: 'people', item: { id: 'account_alice', name: 'Impersonated owner' } })).status, 403);

  for (const action of [
    { action: 'invite', workspaceId: team.id, username: 'charlie' },
    { action: 'remove', workspaceId: team.id, userId: 'alice' },
    { action: 'cancel', workspaceId: team.id, invitationId: 'forged' },
  ]) await rejected(() => access.teamAction(req('bob'), action), 403);
  await rejected(() => access.teamAction(req('alice'), { action: 'leave', workspaceId: team.id }), 400);
  await rejected(() => access.teamAction(req('alice'), { action: 'remove', workspaceId: team.id, userId: 'alice' }), 400);
  await rejected(() => access.teamAction(req('alice'), { action: 'invite', workspaceId: alice.id, username: 'charlie' }), 400);
  await access.teamAction(req('alice'), { action: 'invite', workspaceId: team.id, username: 'charlie' });
  let pending = (await access.getAccountContext(req('charlie'))).invitations[0];
  assert.equal((await access.listTeamMembers(req('bob'), team.id)).invitations.length, 0);
  assert.equal((await access.listTeamMembers(req('alice'), team.id)).invitations[0].id, pending.id);
  await access.teamAction(req('alice'), { action: 'cancel', workspaceId: team.id, invitationId: pending.id });
  await rejected(() => access.teamAction(req('charlie'), { action: 'accept', invitationId: pending.id }), 404);
  await access.teamAction(req('alice'), { action: 'invite', workspaceId: team.id, username: 'charlie' });
  pending = (await access.getAccountContext(req('charlie'))).invitations[0];
  await access.teamAction(req('charlie'), { action: 'decline', invitationId: pending.id });
  await rejected(() => access.resolveWorkspace(req('charlie', team.id)), 404);

  // Account-linked assignment labels are never an access-control source. An
  // export/import can carry labels and content, but cannot add team members.
  const membersBefore = sql.prepare('SELECT workspace_id, user_id, role FROM appmembers ORDER BY workspace_id, user_id').all();
  const exportedTeam = await (await exportRoute.GET(req('alice', team.id, '/api/export'))).json();
  assert.equal(exportedTeam.notes[0].id, 'shared-note');
  assert.equal(exportedTeam.notes.some(note => note.id === 'alice-private'), false);
  for (const [label, malformed] of [
    ['null person', { ...exportedTeam, people: [null] }],
    ['non-array tasks', { ...exportedTeam, tasks: {} }],
    ['null discussion entry', { ...exportedTeam, tasks: [{ ...exportedTeam.tasks[0], comments: [null] }] }],
  ]) {
    const response = await mutation('alice', team.id, { action: 'import', workspace: malformed });
    assert.equal(response.status, 400, `Malformed import (${label}) must be a validation error`);
    assert.equal((await store.readWorkspace(req('alice', team.id))).revision, exportedTeam.revision, `Malformed import (${label}) must not change the workspace`);
  }
  const importedTeam = { ...exportedTeam, people: [...exportedTeam.people, { id: 'forged-label', name: 'charlie', role: 'owner', color: '#8a78fa', userId: 'charlie' }] };
  const importResult = await mutation('alice', team.id, { action: 'import', workspace: importedTeam });
  assert.ok([200, 400, 403].includes(importResult.status));
  assert.deepEqual(sql.prepare('SELECT workspace_id, user_id, role FROM appmembers ORDER BY workspace_id, user_id').all(), membersBefore);
  await rejected(() => access.resolveWorkspace(req('charlie', team.id)), 404);
  assert.equal((await exportRoute.GET(req('bob', alice.id, '/api/export'))).status, 404);
  const bobBackup = await (await exportRoute.GET(req('bob', '', '/api/export'))).json();
  assert.deepEqual(bobBackup.notes.map(note => note.id), ['bob-private']);
  const accountResponse = await accountRoute.GET(req('bob', '', '/api/account'));
  assert.equal(accountResponse.status, 200);
  assert.equal(JSON.stringify(await accountResponse.json()).includes('alice@gmail.com'), false);

  // New comments are stamped from the session; supplied authors and timestamps
  // cannot impersonate another account. Old discussion is immutable.
  let current = await store.readWorkspace(req('bob', team.id));
  const bobPerson = current.people.find(person => person.userId === 'bob' || person.id === 'account_bob');
  const alicePerson = current.people.find(person => person.userId === 'alice' || person.id === 'account_alice');
  assert.ok(bobPerson && alicePerson);
  const comment = { id: 'bob-comment', personId: bobPerson.id, body: 'A real team update', createdAt: new Date().toISOString() };
  assert.equal((await mutation('bob', team.id, { action: 'upsert', entity: 'tasks', item: { id: 'shared-task', comments: [comment] } })).status, 200);
  const spoofResponse = await mutation('bob', team.id, { action: 'upsert', entity: 'tasks', item: { id: 'shared-task', comments: [comment, { ...comment, id: 'spoofed', personId: alicePerson.id, body: 'Forged owner comment' }] } });
  assert.equal(spoofResponse.status, 200);
  const stamped = (await spoofResponse.json()).workspace.tasks[0].comments;
  assert.equal(stamped.find(item => item.id === 'spoofed').personId, bobPerson.id);
  await mutation('alice', team.id, { action: 'upsert', entity: 'tasks', item: { id: 'shared-task', comments: [...stamped, { ...comment, id: 'alice-comment', personId: alicePerson.id, body: 'Owner comment' }] } });
  const impersonated = (await store.readWorkspace(req('bob', team.id))).tasks[0].comments.map(item => item.id === 'alice-comment' ? { ...item, body: 'Rewritten by Bob' } : item);
  assert.equal((await mutation('bob', team.id, { action: 'upsert', entity: 'tasks', item: { id: 'shared-task', comments: impersonated } })).status, 400);
  assert.equal((await mutation('bob', team.id, { action: 'upsert', entity: 'tasks', item: { id: 'shared-task', comments: [] } })).status, 400);

  // A known attachment ID is insufficient: both the workspace and the file
  // metadata must belong to an authorized scope, including ranged downloads.
  const upload = async (user, workspace, label) => {
    const body = new FormData();
    body.append('file', new File([`${label} private attachment`], `${label}.txt`, { type: 'text/plain' }));
    const response = await uploadRoute.POST(req(user, workspace, '/api/media', { method: 'POST', body }));
    assert.equal(response.status, 201);
    return (await response.json()).media;
  };
  const aliceFile = await upload('alice', '', 'alice');
  const teamFile = await upload('alice', team.id, 'team');
  const download = (user, workspace, file, headers = {}) => downloadRoute.GET(req(user, workspace, `/api/media/${file.id}`, { headers }), { params: Promise.resolve({ id: file.id }) });
  assert.equal((await download('alice', '', aliceFile)).status, 200);
  assert.equal((await download('bob', '', aliceFile)).status, 404);
  assert.equal((await download('', '', aliceFile)).status, 404);
  assert.equal((await download('bob', alice.id, aliceFile)).status, 404);
  assert.equal((await download('bob', team.id, teamFile, { range: 'bytes=0-3' })).status, 206);
  assert.equal((await download('charlie', team.id, teamFile, { range: 'bytes=0-3' })).status, 404);
  const queryDownload = await downloadRoute.GET(req('bob', '', `/api/media/${teamFile.id}?workspace=${team.id}`), { params: Promise.resolve({ id: teamFile.id }) });
  assert.equal(queryDownload.status, 200);
  const fakeCopy = await store.readWorkspace(req('bob'));
  const attachmentClone = { ...fakeCopy, media: [...fakeCopy.media, aliceFile] };
  const cloneResponse = await mutation('bob', '', { action: 'import', workspace: attachmentClone });
  assert.ok([200, 400, 403].includes(cloneResponse.status));
  assert.equal((await download('bob', '', aliceFile)).status, 404, 'Importing metadata must never grant access to another workspace storage object');

  // Removing membership immediately revokes writes, exports and attachments.
  await access.teamAction(req('alice'), { action: 'remove', workspaceId: team.id, userId: 'bob' });
  await rejected(() => access.resolveWorkspace(req('bob', team.id)), 404);
  assert.equal((await mutation('bob', team.id, { action: 'rename', name: 'Revoked write' })).status, 404);
  assert.equal((await exportRoute.GET(req('bob', team.id, '/api/export'))).status, 404);
  assert.equal((await download('bob', team.id, teamFile)).status, 404);
  assert.equal((await store.readWorkspace(req('bob'))).notes[0].id, 'bob-private');
  await access.teamAction(req('alice'), { action: 'invite', workspaceId: team.id, username: 'bob' });
  const rejoin = (await access.getAccountContext(req('bob'))).invitations[0];
  await access.teamAction(req('bob'), { action: 'accept', invitationId: rejoin.id });
  await access.teamAction(req('bob'), { action: 'leave', workspaceId: team.id });
  await rejected(() => access.resolveWorkspace(req('bob', team.id)), 404);
  assert.equal((await store.readWorkspace(req())).notes[0].id, 'guest-only');
  console.log('PASS: account, personal/team/guest boundaries, forged workspace IDs, same-origin checks, invitation ownership/accept/cancel/decline, member permissions/removal, import access isolation, comment authorship, scoped exports and media/ranges.');
};
