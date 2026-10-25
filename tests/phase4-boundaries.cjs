const assert = require("node:assert/strict");

// These checks use separate authenticated fixture identities and the real HTTP
// handlers. Only session verification is replaced by the shared test harness.
module.exports = async function checkTeamBoundaries({
  sql,
  store,
  request,
  users,
}) {
  const access = require("./compiled/app/lib/access-store");
  const stateRoute = require("./compiled/app/api/state/route");
  const historyRoute = require("./compiled/app/api/history/route");
  const trashRoute = require("./compiled/app/api/trash/route");
  const storageRoute = require("./compiled/app/api/storage/route");
  const uploadRoute = require("./compiled/app/api/media/route");
  const mediaRoute = require("./compiled/app/api/media/[id]/route");
  const liveRoute = require("./compiled/app/api/live/route");
  const identities = ["boundary_owner", "boundary_editor", "boundary_viewer"];
  for (const id of identities) {
    const user = { id, username: id, name: id, email: `${id}@example.test` };
    users.set(id, user);
    sql
      .prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,username) VALUES(?,?,?,0,?,?,?)",
      )
      .run(id, id, user.email, Date.now(), Date.now(), id);
  }
  const [owner, editor, viewer] = identities;
  const created = await access.teamAction(request("/api/teams", owner), {
    action: "create",
    name: "Team boundary fixture",
  });
  const team = created.workspaces.find(
    (item) => item.name === "Team boundary fixture",
  );
  assert(team);
  const req = (user, route = "/api/state", options = {}) =>
    request(route, user, team.id, options);
  const manage = (user, body) =>
    access.teamAction(req(user, "/api/teams"), {
      ...body,
      workspaceId: team.id,
    });
  for (const [id, role] of [
    [editor, "editor"],
    [viewer, "viewer"],
  ]) {
    await manage(owner, { action: "invite", username: id, role });
    const invitation = (
      await access.getAccountContext(request("/api/account", id))
    ).invitations.find((item) => item.workspaceId === team.id);
    await access.teamAction(request("/api/teams", id), {
      action: "accept",
      invitationId: invitation.id,
    });
  }
  const read = (user) => store.readWorkspace(req(user));
  const write = async (user, entity, item) =>
    store.mutateWorkspace(req(user), {
      action: "upsert",
      entity,
      item,
      base:
        (await read(user))[entity]?.find(
          (existing) => existing.id === item.id,
        ) || null,
      operationId: crypto.randomUUID(),
    });
  const remove = async (entity, id) => {
    const deletion = crypto.randomUUID();
    await store.mutateWorkspace(req(owner), {
      action: "delete",
      entity,
      id,
      base: (await read(owner))[entity].find((item) => item.id === id),
      operationId: deletion,
    });
    return deletion;
  };
  await write(owner, "projects", {
    id: "boundary_public",
    name: "Open project",
    key: "OPEN",
  });
  await write(owner, "projects", {
    id: "boundary_private",
    name: "Private project",
    key: "PRIV",
  });
  const projectPolicy = (members) =>
    manage(owner, {
      action: "project-access",
      projectId: "boundary_private",
      restricted: true,
      members,
    });
  await projectPolicy([{ userId: editor, role: "editor" }]);
  await write(owner, "notes", {
    id: "boundary_history",
    title: "Private history title",
    content: "Private historical text",
    projectId: "boundary_private",
  });
  await write(owner, "notes", {
    id: "boundary_history",
    content: "Private current text",
  });
  assert(
    sql
      .prepare(
        "SELECT COUNT(*) AS count FROM note_history WHERE workspace_id=? AND note_id=?",
      )
      .get(team.id, "boundary_history").count > 0,
  );
  assert.equal(
    (await historyRoute.GET(req(editor, "/api/history?note=boundary_history")))
      .status,
    200,
  );
  const deniedHistory = await historyRoute.GET(
    req(viewer, "/api/history?note=boundary_history"),
  );
  assert.equal(deniedHistory.status, 404);
  assert(!(await deniedHistory.text()).includes("Private historical text"));
  assert.equal(
    (
      await historyRoute.GET(
        req(viewer, "/api/history?note=boundary_history&cursor=unknown_cursor"),
      )
    ).status,
    404,
    "An inaccessible note is rejected before history cursor lookup",
  );

  function upload(user, project = "boundary_private") {
    const form = new FormData();
    form.append(
      "file",
      new Blob(["Private attachment bytes"], { type: "text/plain" }),
      "private-reference.txt",
    );
    form.append("projectId", project);
    return uploadRoute.POST(
      req(user, "/api/media", { method: "POST", body: form }),
    );
  }
  const uploadResponse = await upload(owner);
  assert.equal(uploadResponse.status, 201);
  const attachment = (await uploadResponse.json()).media;
  const download = (user) =>
    mediaRoute.GET(req(user, `/api/media/${attachment.id}`), {
      params: Promise.resolve({ id: attachment.id }),
    });
  assert.equal((await download(editor)).status, 200);
  const deniedDownload = await download(viewer);
  assert.equal(deniedDownload.status, 404);
  assert(!deniedDownload.headers.has("content-disposition"));
  assert(!(await deniedDownload.text()).includes("Private attachment bytes"));
  const mediaCount = sql
    .prepare("SELECT COUNT(*) AS count FROM media_objects WHERE workspace_id=?")
    .get(team.id).count;
  assert.equal(
    (await upload(viewer, "boundary_public")).status,
    403,
    "A viewer cannot upload even to an open project",
  );
  assert.equal(
    sql
      .prepare(
        "SELECT COUNT(*) AS count FROM media_objects WHERE workspace_id=?",
      )
      .get(team.id).count,
    mediaCount,
    "Denied uploads do not register upload records",
  );

  await write(owner, "notes", {
    id: "boundary_deleted_private",
    title: "Hidden Trash title",
    projectId: "boundary_private",
  });
  await write(owner, "notes", {
    id: "boundary_deleted_public",
    title: "Public recovery title",
    projectId: "boundary_public",
  });
  const hiddenDeletion = await remove("notes", "boundary_deleted_private");
  const publicDeletion = await remove("notes", "boundary_deleted_public");
  const viewerTrashResponse = await trashRoute.GET(req(viewer, "/api/trash"));
  assert.equal(viewerTrashResponse.status, 200);
  const viewerTrash = await viewerTrashResponse.json();
  assert(!viewerTrash.entries.some((item) => item.id === hiddenDeletion));
  const viewerEntry = viewerTrash.entries.find(
    (item) => item.id === publicDeletion,
  );
  assert(viewerEntry);
  assert.equal(
    viewerEntry.restorable,
    false,
    "Viewers see permitted recovery metadata without restore permission",
  );
  assert.equal(
    (await storageRoute.GET(req(viewer, "/api/storage"))).status,
    403,
  );
  assert.equal(
    (await storageRoute.GET(req(editor, "/api/storage"))).status,
    403,
  );
  await assert.rejects(
    () =>
      store.mutateWorkspace(req(viewer), {
        action: "restore",
        id: publicDeletion,
        operationId: crypto.randomUUID(),
      }),
    (error) => error.status === 403,
  );

  // A confirmed restore receipt must not bypass later access checks, including
  // when its actor used to own this team.
  await write(owner, "notes", {
    id: "boundary_owner_restore",
    title: "Owner-only restored record",
    projectId: "boundary_private",
  });
  const ownerDeletion = await remove("notes", "boundary_owner_restore");
  const restore = {
    action: "restore",
    id: ownerDeletion,
    operationId: crypto.randomUUID(),
  };
  await store.mutateWorkspace(req(owner), restore);
  assert(
    sql
      .prepare(
        "SELECT 1 FROM workspace_receipts WHERE workspace_id=? AND actor_key=? AND operation_id=?",
      )
      .get(team.id, `user:${owner}`, restore.operationId),
  );

  const beforeStateResponse = await stateRoute.GET(req(editor));
  assert.equal(beforeStateResponse.status, 200);
  const beforeTag = beforeStateResponse.headers.get("etag"),
    beforeState = (await beforeStateResponse.json()).workspace;
  assert(beforeState.notes.some((item) => item.id === "boundary_history"));
  const liveBefore = await liveRoute.GET(req(editor, "/api/live?wait=0"));
  assert.equal(liveBefore.status, 200);
  const beforeCursor = await liveBefore.json();
  const storedBefore = sql
    .prepare("SELECT data,revision FROM workspaces WHERE id=?")
    .get(team.id);

  // Revoke only project access while a Trash list is being prepared. Membership
  // stays valid, so a membership-only final check would still leak the title.
  const originalResolve = access.resolveWorkspace;
  let resolves = 0;
  access.resolveWorkspace = async function (...args) {
    if (++resolves === 2) await projectPolicy([]);
    return originalResolve(...args);
  };
  let racedTrash;
  try {
    racedTrash = await trashRoute.GET(req(editor, "/api/trash"));
  } finally {
    access.resolveWorkspace = originalResolve;
  }
  assert(resolves >= 2, "Trash must recheck access after preparing its list");
  assert([200, 409].includes(racedTrash.status));
  if (racedTrash.status === 200)
    assert(
      !(await racedTrash.text()).includes("Hidden Trash title"),
      "A mid-read project revocation cannot return old private Trash metadata",
    );
  const storedAfter = sql
    .prepare("SELECT data,revision FROM workspaces WHERE id=?")
    .get(team.id);
  assert.equal(storedAfter.revision, storedBefore.revision);
  assert.equal(
    storedAfter.data,
    storedBefore.data,
    "Project access changes do not rewrite workspace records",
  );
  const afterStateResponse = await stateRoute.GET(
    req(editor, "/api/state", { headers: { "if-none-match": beforeTag } }),
  );
  assert.equal(
    afterStateResponse.status,
    200,
    "Permission-only changes invalidate a formerly valid ETag",
  );
  assert.notEqual(afterStateResponse.headers.get("etag"), beforeTag);
  const afterState = (await afterStateResponse.json()).workspace;
  assert.equal(afterState.revision, beforeState.revision);
  assert.deepEqual(afterState.people, beforeState.people);
  assert(!afterState.notes.some((item) => item.id === "boundary_history"));
  assert.equal(
    (await historyRoute.GET(req(editor, "/api/history?note=boundary_history")))
      .status,
    404,
  );
  assert.equal((await download(editor)).status, 404);
  assert([403, 404].includes((await upload(editor)).status));
  const editorTrash = await (
    await trashRoute.GET(req(editor, "/api/trash"))
  ).json();
  assert(!editorTrash.entries.some((item) => item.id === hiddenDeletion));
  await assert.rejects(
    () =>
      store.mutateWorkspace(req(editor), {
        action: "restore",
        id: hiddenDeletion,
        operationId: crypto.randomUUID(),
      }),
    (error) => [403, 404].includes(error.status),
  );
  const liveAfter = await liveRoute.GET(
    req(
      editor,
      `/api/live?wait=0&since=${encodeURIComponent(beforeCursor.cursor)}`,
    ),
  );
  assert.equal(liveAfter.status, 200);
  const afterCursor = await liveAfter.json();
  assert.equal(afterCursor.revision, beforeCursor.revision);
  assert(afterCursor.securityRevision > beforeCursor.securityRevision);
  assert.notEqual(afterCursor.cursor, beforeCursor.cursor);

  await manage(owner, {
    action: "transfer",
    userId: editor,
    expectedOwnerId: owner,
  });
  await manage(editor, {
    action: "set-role",
    userId: owner,
    role: "editor",
    expectedRole: "admin",
  });
  const beforeRetry = sql
    .prepare("SELECT data,revision FROM workspaces WHERE id=?")
    .get(team.id);
  await assert.rejects(
    () => store.mutateWorkspace(req(owner), restore),
    (error) => [403, 404].includes(error.status),
    "A previous owner's receipt cannot restore outside current project access",
  );
  assert.deepEqual(
    sql.prepare("SELECT data,revision FROM workspaces WHERE id=?").get(team.id),
    beforeRetry,
  );
  const viewerLive = await liveRoute.GET(req(viewer, "/api/live?wait=0"));
  assert.equal(viewerLive.status, 200);
  await manage(editor, { action: "remove", userId: viewer });
  const revokedLive = await liveRoute.GET(req(viewer, "/api/live?wait=0"));
  assert([403, 404].includes(revokedLive.status));
  assert.equal((await stateRoute.GET(req(viewer))).status, 404);
  console.log(
    "PASS: HTTP history/media/Trash/storage boundaries, permission-only ETag/live invalidation, mid-read project revocation, viewer recovery metadata, and former-owner receipt isolation.",
  );
};
