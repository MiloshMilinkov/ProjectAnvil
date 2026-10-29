const assert = require("node:assert/strict");

module.exports = async function checkCollaboration({
  sql,
  store,
  request,
  users,
}) {
  const access = require("./compiled/app/lib/access-store");
  const collaboration = require("./compiled/app/lib/collaboration-store");
  const {
    mentionedUsers,
    prepareActivity,
  } = require("./compiled/app/lib/collaboration-model");
  const { createSeedWorkspace } = require("./compiled/app/lib/seed");
  const { applyMutation } = require("./compiled/app/lib/workspace-model");
  const names = new Map([
    ["bob", "bob"],
    ["charlie.name", "charlie"],
  ]);
  assert.deepEqual(
    [...mentionedUsers("Hello @bob. Ask @charlie.name next.", names)],
    ["bob", "charlie"],
  );
  assert.equal(
    mentionedUsers(
      "person@bob.example тест@bob \\@bob `@bob` `` @bob `` https://example.test/@bob\n```\n@bob\n```\n~~~\n@bob\n~~~\n @bobby",
      names,
    ).size,
    0,
  );
  assert.equal(
    mentionedUsers(
      "@bob_thing @bob.other @bob........................................",
      names,
    ).size,
    1,
    "Sentence punctuation can follow a handle; longer names never partially match",
  );
  const seed = createSeedWorkspace();
  const first = applyMutation(seed, {
    action: "upsert",
    entity: "notes",
    item: { id: "reasoning", title: "Reasoning", content: "Hello @bob" },
    base: null,
  });
  const prepared = prepareActivity(
    seed,
    first,
    { id: "alice", name: "Alice" },
    names,
    { action: "upsert", entity: "notes", item: { id: "reasoning" } },
  );
  assert.deepEqual(prepared[0].mentions, ["bob"]);
  assert(
    !JSON.stringify(prepared[0]).includes("Hello"),
    "Activity must not copy note text",
  );
  const imported = prepareActivity(
    seed,
    first,
    { id: "alice", name: "Alice" },
    names,
    { action: "import" },
  );
  assert.equal(imported.length, 1);
  assert.deepEqual(imported[0].mentions, []);

  const fixtures = ["alice", "bob", "charlie"].map((name) => ({
    id: `collab-${name}`,
    username: `collab.${name}`,
    name: `collab.${name}`,
    email: `collab-${name}@example.test`,
  }));
  for (const user of fixtures) {
    users.set(user.id, user);
    sql
      .prepare(
        "INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt,username) VALUES (?,?,?,0,?,?,?)",
      )
      .run(
        user.id,
        user.name,
        user.email,
        Date.now(),
        Date.now(),
        user.username,
      );
  }
  const [alice, bob, charlie] = fixtures;
  const ownerAccount = request("/api/teams", alice.id);
  const known = new Set(
    (await access.getAccountContext(ownerAccount)).workspaces.map(
      (item) => item.id,
    ),
  );
  const created = await access.teamAction(ownerAccount, {
    action: "create",
    name: "Collaboration test workspace",
  });
  const team = created.workspaces.find((item) => !known.has(item.id));
  for (const user of [bob, charlie]) {
    await access.teamAction(ownerAccount, {
      action: "invite",
      workspaceId: team.id,
      username: user.username,
      role: user.id === bob.id ? "viewer" : "editor",
    });
    const invitation = (
      await access.getAccountContext(request("/api/account", user.id))
    ).invitations.find((item) => item.workspaceId === team.id);
    await access.teamAction(request("/api/teams", user.id), {
      action: "accept",
      invitationId: invitation.id,
    });
  }
  const req = (user, route = "/api/state", options = {}) =>
    request(route, user.id, team.id, options);
  const read = (user) => store.readWorkspace(req(user));
  const save = async (user, entity, item, operationId = crypto.randomUUID()) =>
    store.mutateWorkspace(req(user), {
      action: "upsert",
      entity,
      item,
      base:
        (await read(user))[entity]?.find((old) => old.id === item.id) || null,
      operationId,
    });
  await save(alice, "projects", {
    id: "public",
    name: "Public plan",
    key: "PUB",
  });
  await save(alice, "projects", {
    id: "restricted",
    name: "Restricted plan",
    key: "SEC",
  });
  await access.teamAction(ownerAccount, {
    action: "project-access",
    workspaceId: team.id,
    projectId: "restricted",
    restricted: true,
    members: [],
  });
  const db = access.database(),
    originalPrepare = db.prepare;
  const queries = [];
  db.prepare = (query) => {
    queries.push(query);
    return originalPrepare(query);
  };
  try {
    const fullAccess = await access.resolveWorkspace(req(bob));
    assert.equal(
      fullAccess.permissions.length,
      1,
      "Normal reads retain restricted project grants",
    );
    assert.equal(queries.length, 3);
    queries.length = 0;
    const marker = await access.resolveWorkspaceMarker(req(bob, "/api/live"));
    assert.deepEqual(Object.keys(marker).sort(), [
      "id",
      "kind",
      "role",
      "securityRevision",
    ]);
    assert.equal(marker.id, team.id);
    assert.equal(marker.securityRevision, fullAccess.securityRevision);
    assert.equal(marker.role, "viewer");
    assert.equal(
      queries.length,
      2,
      "Live markers only need the two consistent membership/security reads",
    );
    assert(!queries.some((query) => query.includes("project_permissions")));
    assert(
      !queries.some((query) =>
        query.includes("SELECT id, kind, owner_user_id"),
      ),
    );
  } finally {
    db.prepare = originalPrepare;
  }
  await save(alice, "notes", {
    id: "shared-note",
    title: "Shared note",
    content: "Initial content",
    projectId: "public",
  });
  await save(alice, "notes", {
    id: "restricted-note",
    title: "Restricted note title",
    content: "Private starting point",
    projectId: "restricted",
  });
  assert.deepEqual(
    await collaboration.readNotifications(request("/api/notifications")),
    { entries: [], nextCursor: null, unreadCount: 0, available: false },
  );
  await Promise.all([
    collaboration.changeWatch(req(bob), {
      type: "note",
      id: "shared-note",
      watching: true,
    }),
    collaboration.changeWatch(req(bob), {
      type: "note",
      id: "shared-note",
      watching: true,
    }),
  ]);
  await collaboration.changeWatch(req(bob), {
    type: "project",
    id: "public",
    watching: true,
  });
  assert.equal(
    sql
      .prepare(
        "SELECT COUNT(*) AS count FROM workspace_watchers WHERE workspace_id=? AND user_id=? AND entity_type='note'",
      )
      .get(team.id, bob.id).count,
    1,
  );
  await assert.rejects(
    () =>
      collaboration.changeWatch(req(bob), {
        type: "note",
        id: "shared-note",
        watching: true,
        userId: alice.id,
      }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    () =>
      collaboration.changeWatch(req(bob), {
        type: "note",
        id: "restricted-note",
        watching: true,
      }),
    (error) => error.status === 404,
  );
  await assert.rejects(
    () =>
      save(bob, "notes", { id: "shared-note", content: "Viewer cannot edit" }),
    (error) => error.status === 403,
  );

  const state = await read(alice),
    mutation = {
      action: "upsert",
      entity: "notes",
      item: { id: "shared-note", content: "Please review @collab.bob" },
      base: state.notes.find((item) => item.id === "shared-note"),
      operationId: crypto.randomUUID(),
    };
  await store.mutateWorkspace(req(alice), mutation);
  const activityCount = sql
    .prepare(
      "SELECT COUNT(*) AS count FROM workspace_activity WHERE workspace_id=?",
    )
    .get(team.id).count;
  await store.mutateWorkspace(req(alice), mutation);
  assert.equal(
    sql
      .prepare(
        "SELECT COUNT(*) AS count FROM workspace_activity WHERE workspace_id=?",
      )
      .get(team.id).count,
    activityCount,
    "A retried acknowledged save cannot duplicate activity",
  );
  let inbox = await collaboration.readNotifications(
    req(bob, "/api/notifications"),
  );
  assert.equal(inbox.unreadCount, 1);
  assert.equal(
    inbox.entries[0].reason,
    "mention",
    "A mention wins over a watch for the same change",
  );
  assert.equal(inbox.entries[0].activity.actor, alice.username);
  assert.equal(
    (await collaboration.readNotifications(req(alice, "/api/notifications")))
      .unreadCount,
    0,
    "Own edits never notify the actor",
  );
  await collaboration.changeNotifications(req(bob), {
    action: "read",
    id: inbox.entries[0].id,
  });
  await collaboration.changeNotifications(req(bob), {
    action: "read",
    id: inbox.entries[0].id,
  });
  assert.equal(
    (await collaboration.readNotifications(req(bob, "/api/notifications")))
      .unreadCount,
    0,
  );
  await assert.rejects(
    () =>
      collaboration.changeNotifications(req(bob), {
        action: "read",
        id: inbox.entries[0].id,
        userId: alice.id,
      }),
    (error) => error.status === 400,
  );

  await save(alice, "notes", { id: "shared-note", folder: "Reference" });
  inbox = await collaboration.readNotifications(req(bob, "/api/notifications"));
  assert.equal(
    inbox.entries.filter((entry) => entry.reason === "watch").length,
    1,
    "Project and direct watchers produce one notice for a change",
  );
  await collaboration.changeNotifications(req(bob), { action: "read-all" });
  await save(alice, "notes", { id: "shared-note", folder: "Notes" });
  assert.equal(
    (await collaboration.readNotifications(req(bob, "/api/notifications")))
      .unreadCount,
    0,
    "Read watch updates coalesce for five minutes",
  );
  await save(alice, "notes", { id: "shared-note", content: "Mention removed" });
  await save(alice, "notes", {
    id: "shared-note",
    content: "Please review @collab.bob again",
  });
  assert.equal(
    (await collaboration.readNotifications(req(bob, "/api/notifications")))
      .unreadCount,
    1,
    "A newly added mention is not suppressed by the watch quiet period",
  );
  await save(alice, "notes", {
    id: "restricted-note",
    content: "Hello @collab.bob and @collab.charlie",
  });
  assert.equal(
    (await collaboration.readNotifications(req(charlie, "/api/notifications")))
      .unreadCount,
    0,
    "Mentions cannot grant project access",
  );
  const bobActivity = await collaboration.readActivity(
    req(bob, "/api/activity?limit=50"),
  );
  assert(!JSON.stringify(bobActivity).includes("Restricted note title"));
  assert(bobActivity.entries.some((entry) => entry.title === "Shared note"));
  const paged = await collaboration.readActivity(
    req(bob, "/api/activity?limit=2"),
  );
  assert.equal(paged.entries.length, 2);
  assert(paged.nextCursor);
  const older = await collaboration.readActivity(
    req(bob, `/api/activity?limit=2&cursor=${paged.nextCursor}`),
  );
  assert(
    !older.entries.some((entry) =>
      paged.entries.some((first) => first.id === entry.id),
    ),
  );
  await assert.rejects(
    () =>
      collaboration.readActivity(req(bob, "/api/activity?project=restricted")),
    (error) => error.status === 404,
  );

  await access.teamAction(ownerAccount, {
    action: "project-access",
    workspaceId: team.id,
    projectId: "public",
    restricted: true,
    members: [{ userId: charlie.id, role: "editor" }],
  });
  inbox = await collaboration.readNotifications(req(bob, "/api/notifications"));
  assert.equal(inbox.unreadCount, 0);
  assert.equal(
    inbox.entries.length,
    0,
    "Revoked project access removes old notifications and titles",
  );
  assert(
    !(await collaboration.readActivity(req(bob, "/api/activity"))).entries.some(
      (entry) => entry.title === "Shared note",
    ),
  );
  await assert.rejects(
    () =>
      collaboration.readWatch(req(bob, "/api/watch?type=note&id=shared-note")),
    (error) => error.status === 404,
  );
  await collaboration.changeWatch(req(bob), {
    type: "note",
    id: "shared-note",
    watching: false,
  });
  await collaboration.changeWatch(req(charlie), {
    type: "note",
    id: "shared-note",
    watching: true,
  });
  const deletion = crypto.randomUUID();
  await store.mutateWorkspace(req(alice), {
    action: "delete",
    entity: "notes",
    id: "shared-note",
    base: (await read(alice)).notes.find((item) => item.id === "shared-note"),
    operationId: deletion,
  });
  const charlieInbox = await collaboration.readNotifications(
    req(charlie, "/api/notifications"),
  );
  assert(
    charlieInbox.entries.some(
      (entry) =>
        entry.activity.action === "deleted" && !entry.activity.reference,
    ),
    "A watcher can see deletion without a dangling Open action",
  );
  assert.equal(
    sql
      .prepare(
        "SELECT COUNT(*) AS count FROM workspace_watchers WHERE workspace_id=? AND entity_type='note' AND entity_id='shared-note'",
      )
      .get(team.id).count,
    0,
    "Deleted items release watch limits",
  );
  await store.mutateWorkspace(req(alice), {
    action: "restore",
    id: deletion,
    operationId: crypto.randomUUID(),
  });
  assert.equal(
    (
      await collaboration.readWatch(
        req(charlie, "/api/watch?type=note&id=shared-note"),
      )
    ).watching,
    false,
  );
  await access.teamAction(ownerAccount, {
    action: "remove",
    workspaceId: team.id,
    userId: bob.id,
  });
  await assert.rejects(
    () => access.resolveWorkspaceMarker(req(bob, "/api/live")),
    (error) => error.status === 404,
    "The cheaper live marker must still reject revoked membership",
  );
  await assert.rejects(
    () => collaboration.readActivity(req(bob, "/api/activity")),
    (error) => error.status === 404,
  );
  await assert.rejects(
    () => collaboration.readNotifications(req(bob, "/api/notifications")),
    (error) => error.status === 404,
  );
  await assert.rejects(
    () => collaboration.changeNotifications(req(bob), { action: "read-all" }),
    (error) => error.status === 404,
  );
  console.log(
    "PASS: trusted activity/mentions, watch deduplication, notification retries/coalescing/read state, viewer preferences, scoped feeds, private project and revoked membership boundaries, deletion notices, and watch quota cleanup.",
  );
};
