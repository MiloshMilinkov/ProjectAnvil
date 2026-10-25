const assert = require("node:assert/strict");
const Y = require("yjs");

module.exports = async function checkSharedNotes({
  sql,
  store,
  request,
  users,
}) {
  const access = require("./compiled/app/lib/access-store");
  const coedit = require("./compiled/app/lib/note-collaboration-store");
  const {
    decodeDocumentUpdate,
    encodeDocumentUpdate,
    replaceCollaborativeText,
    documentText,
  } = require("./compiled/app/lib/note-collaboration");
  for (const name of ["coowner", "coeditor", "coviewer"]) {
    const user = {
      id: name,
      username: name,
      name,
      email: `${name}@example.test`,
    };
    users.set(name, user);
    sql
      .prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,username) VALUES(?,?,?,0,?,?,?)",
      )
      .run(name, name, user.email, Date.now(), Date.now(), name);
  }
  const owner = request("/api/teams", "coowner");
  const created = await access.teamAction(owner, {
    action: "create",
    name: "Shared editing fixture",
  });
  const team = created.workspaces.find((item) => item.kind === "team");
  for (const [name, role] of [
    ["coeditor", "editor"],
    ["coviewer", "viewer"],
  ]) {
    await access.teamAction(owner, {
      action: "invite",
      workspaceId: team.id,
      username: name,
      role,
    });
    const invitation = (
      await access.getAccountContext(request("/api/account", name))
    ).invitations.find((item) => item.workspaceId === team.id);
    await access.teamAction(request("/api/teams", name), {
      action: "accept",
      invitationId: invitation.id,
    });
  }
  const req = (user, path = "/api/state") => request(path, user, team.id);
  const save = async (input) =>
    store.mutateWorkspace(req("coowner"), {
      ...input,
      operationId: crypto.randomUUID(),
    });
  await save({
    action: "upsert",
    entity: "projects",
    item: { id: "shared-project", name: "Shared project", key: "SHR" },
    base: null,
  });
  await save({
    action: "upsert",
    entity: "notes",
    item: {
      id: "shared-note",
      title: "Shared note",
      content: "Plan\n",
      projectId: "shared-project",
    },
    base: null,
  });
  const get = (user, tab = "tab-one") =>
    coedit.readNoteCollaboration(
      req(user, `/api/coedit?note=shared-note&tab=${tab}`),
    );
  const first = await get("coowner"),
    second = await get("coeditor", "tab-two");
  assert.equal(first.generation, second.generation);
  for (let index = 0; index < 35; index++)
    await get("coowner", `presence-${index}`);
  assert.equal(
    sql
      .prepare(
        "SELECT COUNT(*) AS count FROM note_presence WHERE workspace_id=? AND actor_id='coowner'",
      )
      .get(team.id).count,
    30,
    "Presence cannot grow without a per-account bound",
  );
  const recentlySeen = new Date(Date.now() - 1000).toISOString();
  sql
    .prepare(
      "UPDATE note_presence SET seen_at=? WHERE workspace_id=? AND actor_id='coowner' AND tab_id='tab-one'",
    )
    .run(recentlySeen, team.id);
  await get("coowner");
  assert.equal(
    sql
      .prepare(
        "SELECT seen_at FROM note_presence WHERE workspace_id=? AND actor_id='coowner' AND tab_id='tab-one'",
      )
      .get(team.id).seen_at,
    recentlySeen,
    "Rapid polls should not rewrite the same presence row",
  );
  assert.equal((await get("coviewer", "tab-viewer")).canEdit, false);
  const alice = new Y.Doc(),
    bob = new Y.Doc();
  Y.applyUpdate(alice, decodeDocumentUpdate(first.update));
  Y.applyUpdate(bob, decodeDocumentUpdate(second.update));
  replaceCollaborativeText(alice, "Alice: Plan\n");
  replaceCollaborativeText(bob, "Plan\nBob: Review\n");
  const body = (doc, generation, tab) => ({
    noteId: "shared-note",
    generation,
    update: encodeDocumentUpdate(Y.encodeStateAsUpdate(doc)),
    operationId: crypto.randomUUID(),
    tabId: tab,
  });
  const aliceBody = body(alice, first.generation, "tab-one"),
    bobBody = body(bob, second.generation, "tab-two");
  await assert.rejects(
    () => coedit.updateNoteCollaboration(req("coviewer"), aliceBody),
    (error) => error.status === 403,
  );
  await Promise.all([
    coedit.updateNoteCollaboration(req("coowner"), aliceBody),
    coedit.updateNoteCollaboration(req("coeditor"), bobBody),
  ]);
  let committed = await get("coowner");
  Y.applyUpdate(alice, decodeDocumentUpdate(committed.update));
  Y.applyUpdate(bob, decodeDocumentUpdate(committed.update));
  assert.equal(documentText(alice), documentText(bob));
  assert.match(committed.content, /Alice:/);
  assert.match(committed.content, /Bob:/);
  const afterRevision = committed.revision;
  await coedit.updateNoteCollaboration(req("coowner"), aliceBody);
  assert.equal(
    (await get("coowner")).revision,
    afterRevision,
    "Lost response retries must not append duplicate activity/content",
  );

  replaceCollaborativeText(bob, `${documentText(bob)}Offline note\n`);
  replaceCollaborativeText(alice, `Online note\n${documentText(alice)}`);
  await coedit.updateNoteCollaboration(
    req("coowner"),
    body(alice, committed.generation, "tab-one"),
  );
  await coedit.updateNoteCollaboration(
    req("coeditor"),
    body(bob, committed.generation, "tab-two"),
  );
  committed = await get("coowner");
  assert.match(committed.content, /Offline note/);
  assert.match(committed.content, /Online note/);
  const restartBody = {
    action: "restart",
    noteId: "shared-note",
    generation: committed.generation,
    operationId: crypto.randomUUID(),
    tabId: "tab-one",
  };
  const restarted = await coedit.updateNoteCollaboration(
    req("coowner"),
    restartBody,
  );
  assert.notEqual(restarted.generation, committed.generation);
  assert.equal(restarted.content, committed.content);
  assert.equal(
    (await coedit.updateNoteCollaboration(req("coowner"), restartBody))
      .generation,
    restarted.generation,
    "Session restart is receipt-safe",
  );
  await assert.rejects(
    () =>
      coedit.updateNoteCollaboration(
        req("coeditor"),
        body(bob, committed.generation, "tab-two"),
      ),
    (error) => error.status === 409,
  );

  const note = (await store.readWorkspace(req("coowner"))).notes.find(
    (item) => item.id === "shared-note",
  );
  await save({
    action: "upsert",
    entity: "notes",
    item: { id: note.id, content: "A restored plan" },
    base: { id: note.id, content: note.content },
  });
  const replacement = await get("coowner");
  assert.notEqual(replacement.generation, restarted.generation);
  assert.equal(replacement.content, "A restored plan");
  await assert.rejects(
    () =>
      coedit.updateNoteCollaboration(
        req("coeditor"),
        body(bob, restarted.generation, "tab-two"),
      ),
    (error) => error.status === 409,
  );
  await access.teamAction(owner, {
    action: "project-access",
    workspaceId: team.id,
    projectId: "shared-project",
    restricted: true,
    members: [],
  });
  await assert.rejects(
    () => get("coeditor"),
    (error) => error.status === 404,
  );
  await assert.rejects(
    () =>
      coedit.updateNoteCollaboration(
        req("coeditor"),
        body(bob, replacement.generation, "tab-two"),
      ),
    (error) => [403, 404].includes(error.status),
  );
  await access.teamAction(owner, {
    action: "remove",
    workspaceId: team.id,
    userId: "coeditor",
  });
  await assert.rejects(
    () => get("coeditor"),
    (error) => error.status === 404,
  );
  await assert.rejects(
    () => get(""),
    (error) => error.status === 401,
  );
  await assert.rejects(
    () =>
      coedit.updateNoteCollaboration(req("coowner"), {
        ...aliceBody,
        update: "not base64",
      }),
    /invalid/,
  );
  const foreign = new Y.Doc();
  foreign.getMap("other").set("x", "outside note");
  await assert.rejects(
    () =>
      coedit.updateNoteCollaboration(
        req("coowner"),
        body(foreign, replacement.generation, "tab-one"),
      ),
    /only contain note text/,
  );
  await access.teamAction(owner, {
    action: "project-access",
    workspaceId: team.id,
    projectId: "shared-project",
    restricted: true,
    members: [{ userId: "coviewer", role: "viewer" }],
  });
  const originalResolve = access.resolveWorkspace;
  let viewerReads = 0;
  access.resolveWorkspace = async (request) => {
    if (
      request.headers.get("x-test-user") === "coviewer" &&
      ++viewerReads === 2
    )
      await access.teamAction(owner, {
        action: "project-access",
        workspaceId: team.id,
        projectId: "shared-project",
        restricted: true,
        members: [],
      });
    return originalResolve(request);
  };
  try {
    await assert.rejects(
      () => get("coviewer"),
      (error) => error.status === 404,
    );
  } finally {
    access.resolveWorkspace = originalResolve;
  }
  const final = (await store.readWorkspace(req("coowner"))).notes.find(
    (item) => item.id === "shared-note",
  );
  const deletion = crypto.randomUUID();
  await store.mutateWorkspace(req("coowner"), {
    action: "delete",
    entity: "notes",
    id: final.id,
    base: final,
    operationId: deletion,
  });
  await assert.rejects(
    () => get("coowner"),
    (error) => error.status === 404,
  );
  await save({ action: "restore", id: deletion });
  assert.notEqual((await get("coowner")).generation, replacement.generation);
  for (const doc of [alice, bob, foreign]) doc.destroy();
  console.log(
    "PASS: shared note initialization, viewer denial, separate-account concurrent edits/reconnects, retry-safe sessions, generic replacement boundaries, project revocation, deletion/restore, and malformed CRDT rejection.",
  );
};
