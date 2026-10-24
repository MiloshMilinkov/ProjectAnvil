const assert = require("node:assert/strict");
module.exports = async function checkPhase1Trash({ sql, store, request }) {
  const { createSeedWorkspace } = require("./compiled/app/lib/seed");
  const journal = require("./compiled/app/lib/workspace-journal");
  const recovery = require("./compiled/app/lib/workspace-trash");
  const access = require("./compiled/app/lib/access-store");
  const route = require("./compiled/app/api/trash/route");
  const stateRoute = require("./compiled/app/api/state/route");
  const req = request();
  const read = () => store.readWorkspace(req);
  const write = (input) =>
    store.mutateWorkspace(req, {
      operationId: crypto.randomUUID(),
      ...input,
    });
  const upsert = async (entity, item) =>
    write({
      action: "upsert",
      entity,
      item,
      base:
        (await read())[entity].find((value) => value.id === item.id) || null,
    });
  const remove = async (entity, id, operationId = crypto.randomUUID()) => {
    await write({
      action: "delete",
      entity,
      id,
      base: (await read())[entity].find((value) => value.id === id),
      operationId,
    });
    return operationId;
  };
  const restore = (id, operationId = crypto.randomUUID()) =>
    store.mutateWorkspaceResult(req, {
      action: "restore",
      id,
      operationId,
    });
  const conflict = (callback) =>
    assert.rejects(callback, (error) => error.status === 409);
  const current = await read();
  await write({
    action: "import",
    workspace: {
      ...createSeedWorkspace(),
      revision: current.revision,
    },
  });
  await upsert("projects", {
    id: "trash-project",
    name: "Recovery project",
    key: "RCV",
  });
  await upsert("people", {
    id: "trash-person",
    name: "Assignment label",
  });
  await upsert("notes", {
    id: "trash-note",
    title: "Recoverable note",
    content: "Preserve this content",
    projectId: "trash-project",
  });
  await upsert("notes", {
    id: "trash-related",
    title: "Related note",
  });
  await upsert("tasks", {
    id: "trash-task",
    title: "Linked task",
    projectId: "trash-project",
    assigneeId: "trash-person",
    source: {
      noteId: "trash-note",
      excerpt: "Preserve this content",
    },
    noteIds: ["trash-note"],
    dueDate: "2026-11-10",
    startDate: "2026-11-01",
  });
  await upsert("tasks", {
    id: "trash-dependent",
    title: "Dependent task",
    blockedBy: ["trash-task"],
  });
  await upsert("savedViews", {
    id: "trash-view",
    name: "Planned work",
    project: "trash-project",
    assignee: "trash-person",
    layout: "timeline",
    dateFilter: "due-next-7-days",
    sort: "due-date",
  });
  await upsert("canvases", {
    id: "trash-canvas",
    title: "Recovery canvas",
    cards: [
      {
        id: "trash-card",
        type: "note",
        entityId: "trash-note",
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        text: "",
        color: "#ffffff",
      },
      {
        id: "trash-text",
        type: "text",
        x: 240,
        y: 0,
        width: 200,
        height: 100,
        text: "Unrelated card",
        color: "#ffffff",
      },
    ],
    edges: [
      {
        id: "trash-edge",
        from: "trash-card",
        to: "trash-text",
        label: "Connection",
      },
    ],
  });
  const noteDelete = await remove("notes", "trash-note");
  const archived = sql
    .prepare(
      "SELECT * FROM workspace_trash WHERE workspace_id = 'main' AND trash_id = ?",
    )
    .get(noteDelete);
  assert.equal(archived.entity_id, "trash-note");
  assert.equal(
    (await read()).tasks.find((task) => task.id === "trash-task").source,
    undefined,
  );
  assert.equal((await read()).canvases[0].cards.length, 1);
  assert.equal((await read()).relationships.length, 0);
  assert.equal(
    sql
      .prepare(
        "SELECT COUNT(*) AS count FROM note_history WHERE workspace_id = 'main' AND note_id = 'trash-note'",
      )
      .get().count,
    1,
  );
  await upsert("tasks", {
    id: "trash-task",
    title: "A newer unrelated title",
  });
  await upsert("canvases", {
    id: "trash-canvas",
    title: "A newer canvas title",
  });
  const result = await restore(noteDelete);
  assert.deepEqual(result.warnings, []);
  assert.equal(
    result.workspace.notes.find((note) => note.id === "trash-note").content,
    "Preserve this content",
  );
  const linked = result.workspace.tasks.find(
    (task) => task.id === "trash-task",
  );
  assert.equal(linked.title, "A newer unrelated title");
  assert.deepEqual(linked.noteIds, ["trash-note"]);
  assert.equal(linked.source.noteId, "trash-note");
  assert.equal(result.workspace.canvases[0].title, "A newer canvas title");
  assert.equal(result.workspace.canvases[0].cards.length, 2);
  assert.equal(result.workspace.canvases[0].edges.length, 1);
  assert.equal(result.workspace.relationships.length, 1);
  assert.equal(
    sql
      .prepare(
        "SELECT COUNT(*) AS count FROM entity_tombstones WHERE workspace_id = 'main' AND entity = 'notes' AND entity_id = 'trash-note'",
      )
      .get().count,
    0,
  );
  assert.equal(
    (await journal.historyPage("main", result.workspace, "trash-note", null))
      .snapshots.length,
    1,
  );

  // Deletes and restores are idempotent even when the response is lost.
  const secondDelete = await remove("notes", "trash-note");
  const restoreInput = {
    action: "restore",
    id: secondDelete,
    operationId: "trash-double-click",
  };
  const double = await Promise.all([
    store.mutateWorkspaceResult(req, restoreInput),
    store.mutateWorkspaceResult(req, restoreInput),
  ]);
  assert.equal(double[0].workspace.revision, double[1].workspace.revision);
  const thirdDelete = await remove("notes", "trash-note");
  sql
    .prepare("DELETE FROM workspace_receipts WHERE operation_id = ?")
    .run("trash-double-click");
  await conflict(() => store.mutateWorkspaceResult(req, restoreInput));
  assert.equal(
    (await read()).notes.some((note) => note.id === "trash-note"),
    false,
    "Old Undo must not resurrect a later deletion",
  );

  // Missing parent/reference records never discard the primary note content.
  const missingTaskDelete = await remove("tasks", "trash-task");
  await remove("projects", "trash-project");
  const missing = await restore(thirdDelete);
  assert.equal(
    missing.workspace.notes.find((note) => note.id === "trash-note").projectId,
    "",
  );
  assert(missing.warnings.length);
  assert.equal(
    missing.workspace.notes.find((note) => note.id === "trash-note").content,
    "Preserve this content",
  );
  const restoredTask = (await restore(missingTaskDelete)).workspace.tasks.find(
    (task) => task.id === "trash-task",
  );
  assert.equal(restoredTask.projectId, "");
  assert.equal(restoredTask.startDate, "2026-11-01");
  assert.equal(restoredTask.dueDate, "2026-11-10");

  // Restore references conservatively while preserving a newer selection.
  await upsert("people", {
    id: "trash-other-person",
    name: "New assignment",
  });
  const personDelete = await remove("people", "trash-person");
  await upsert("savedViews", {
    id: "trash-view",
    assignee: "trash-other-person",
    name: "Renamed view",
    layout: "list",
  });
  const personRestored = await restore(personDelete);
  assert.equal(
    personRestored.workspace.savedViews[0].assignee,
    "trash-other-person",
  );
  assert.equal(personRestored.workspace.savedViews[0].layout, "list");
  assert.equal(
    personRestored.workspace.savedViews[0].dateFilter,
    "due-next-7-days",
  );
  assert(
    personRestored.warnings.some((warning) =>
      warning.includes("changed after deletion"),
    ),
  );
  await upsert("tasks", {
    id: "trash-key",
    title: "Original task",
    key: "REUSED-1",
    status: "done",
  });
  const taskDelete = await remove("tasks", "trash-key");
  await upsert("tasks", {
    id: "trash-key-new",
    title: "New task",
    key: "REUSED-1",
  });
  const keyResult = await restore(taskDelete);
  const keyTask = keyResult.workspace.tasks.find(
    (task) => task.id === "trash-key",
  );
  assert.notEqual(keyTask.key, "REUSED-1");
  assert.equal(
    keyTask.status,
    "done",
    "Restoring retains completion; duplication resets completion separately",
  );
  assert(keyResult.warnings.some((warning) => warning.includes("task key")));
  const dependencyDelete = await remove("tasks", "trash-key");
  const simultaneous = await Promise.allSettled([
    restore(dependencyDelete),
    restore(dependencyDelete),
  ]);
  assert.equal(
    simultaneous.filter((item) => item.status === "fulfilled").length,
    1,
  );

  // Restoring an incoming dependency skips only the link that now forms a cycle.
  await upsert("tasks", { id: "trash-key", blockedBy: ["trash-key-new"] });
  await upsert("tasks", { id: "trash-dependent", blockedBy: ["trash-key"] });
  await upsert("tasks", {
    id: "trash-valid-dependent",
    title: "Valid incoming link",
    blockedBy: ["trash-key"],
  });
  const cycleDelete = await remove("tasks", "trash-key");
  await upsert("tasks", {
    id: "trash-key-new",
    blockedBy: ["trash-dependent"],
  });
  const cycleResult = await restore(cycleDelete);
  assert.deepEqual(
    cycleResult.workspace.tasks.find((task) => task.id === "trash-dependent")
      .blockedBy,
    [],
  );
  assert.deepEqual(
    cycleResult.workspace.tasks.find(
      (task) => task.id === "trash-valid-dependent",
    ).blockedBy,
    ["trash-key"],
  );
  assert(cycleResult.warnings.some((warning) => warning.includes("cycle")));

  // Reusing a deleted card ID must never reconnect an old edge to the new card.
  const cardDelete = await remove("notes", "trash-note");
  const liveCanvas = (await read()).canvases.find(
    (canvas) => canvas.id === "trash-canvas",
  );
  await upsert("canvases", {
    id: liveCanvas.id,
    cards: [
      ...liveCanvas.cards,
      {
        id: "trash-card",
        type: "text",
        text: "New card",
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        color: "#ffffff",
      },
    ],
  });
  const cardResult = await restore(cardDelete);
  assert.equal(
    cardResult.workspace.canvases[0].cards.find(
      (card) => card.id === "trash-card",
    ).text,
    "New card",
  );
  assert.equal(cardResult.workspace.canvases[0].edges.length, 0);
  assert(cardResult.warnings.length);

  // The same durable path covers every explicitly deletable collection.
  const viewDelete = await remove("savedViews", "trash-view");
  const recoveredView = (await restore(viewDelete)).workspace.savedViews.find(
    (view) => view.id === "trash-view",
  );
  assert.equal(recoveredView.layout, "list");
  assert.equal(recoveredView.dateFilter, "due-next-7-days");
  const canvasDelete = await remove("canvases", "trash-canvas");
  assert.equal(
    (await restore(canvasDelete)).workspace.canvases.find(
      (canvas) => canvas.id === "trash-canvas",
    ).cards.length,
    2,
  );
  await upsert("relationships", {
    id: "trash-explicit-relation",
    from: { type: "task", id: "trash-key" },
    to: { type: "note", id: "trash-note" },
    kind: "supports",
  });
  const relationshipDelete = await remove(
    "relationships",
    "trash-explicit-relation",
  );
  assert(
    (await restore(relationshipDelete)).workspace.relationships.some(
      (relationship) => relationship.id === "trash-explicit-relation",
    ),
  );
  await upsert("media", {
    id: "trash-media",
    name: "Archived attachment",
    url: "/api/media/trash-media",
    type: "text/plain",
    size: 3,
    createdAt: new Date().toISOString(),
  });
  const mediaDelete = await remove("media", "trash-media");
  assert.equal(
    sql
      .prepare(
        "SELECT state FROM media_objects WHERE workspace_id = 'main' AND media_id = 'trash-media'",
      )
      .get().state,
    "retained",
  );
  assert(
    (await restore(mediaDelete)).workspace.media.some(
      (file) => file.id === "trash-media",
    ),
  );
  assert.equal(
    sql
      .prepare(
        "SELECT state FROM media_objects WHERE workspace_id = 'main' AND media_id = 'trash-media'",
      )
      .get().state,
    "active",
  );

  // The list is scoped, metadata-only, paginated, and remains durable on expiry.
  const listIds = [];
  for (let index = 0; index < 3; index++) {
    await upsert("notes", {
      id: `trash-page-${index}`,
      title: `Page note ${index}`,
    });
    listIds.push(await remove("notes", `trash-page-${index}`));
  }
  let cursor = null;
  const seen = new Set();
  do {
    const page = await recovery.trashPage("main", cursor, "2");
    assert(page.entries.length <= 2);
    for (const entry of page.entries) {
      assert(!Object.hasOwn(entry, "payload"));
      assert(!Object.hasOwn(entry, "snapshot"));
      assert(!seen.has(entry.id));
      seen.add(entry.id);
    }
    cursor = page.nextCursor;
  } while (cursor);
  assert(listIds.every((id) => seen.has(id)));
  assert.equal((await route.GET(request("/api/trash?limit=0"))).status, 400);
  assert.equal(
    (await route.GET(request("/api/trash?cursor=not-this-workspace", "alice")))
      .status,
    409,
  );
  await assert.rejects(
    () =>
      store.mutateWorkspace(request("/api/state", "alice"), {
        action: "restore",
        id: listIds[0],
        operationId: crypto.randomUUID(),
      }),
    (error) => error.status === 404,
  );
  const post = await stateRoute.POST(
    request("/api/state", "", "", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "restore",
        id: listIds[0],
        operationId: crypto.randomUUID(),
      }),
    }),
  );
  assert.equal(post.status, 200);
  assert(Array.isArray((await post.json()).warnings));

  // The archive and active change must commit together or not at all.
  await upsert("notes", {
    id: "trash-atomic",
    title: "Atomic archive",
  });
  const beforeFailure = await read();
  sql.exec(
    "CREATE TRIGGER reject_trash BEFORE INSERT ON workspace_trash WHEN NEW.entity_id = 'trash-atomic' BEGIN SELECT RAISE(ABORT, 'injected trash failure'); END",
  );
  try {
    await assert.rejects(() =>
      remove("notes", "trash-atomic", "trash-atomic-op"),
    );
  } finally {
    sql.exec("DROP TRIGGER reject_trash");
  }
  assert.equal((await read()).revision, beforeFailure.revision);
  assert((await read()).notes.some((note) => note.id === "trash-atomic"));
  assert.equal(
    sql
      .prepare(
        "SELECT COUNT(*) AS count FROM workspace_receipts WHERE operation_id = 'trash-atomic-op'",
      )
      .get().count,
    0,
  );
  assert.equal(
    sql.prepare("SELECT COUNT(*) AS count FROM workspace_write_guards").get()
      .count,
    0,
  );

  const atomicDelete = await remove("notes", "trash-atomic");
  const beforeRestoreFailure = await read();
  sql.exec(
    "CREATE TRIGGER reject_trash_restore BEFORE UPDATE ON workspace_trash WHEN NEW.entity_id = 'trash-atomic' AND NEW.restored_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'injected restore failure'); END",
  );
  try {
    await assert.rejects(() => restore(atomicDelete, "trash-restore-atomic"));
  } finally {
    sql.exec("DROP TRIGGER reject_trash_restore");
  }
  assert.equal((await read()).revision, beforeRestoreFailure.revision);
  assert.equal(
    (await read()).notes.some((note) => note.id === "trash-atomic"),
    false,
  );
  assert.equal(
    sql
      .prepare(
        "SELECT restored_at FROM workspace_trash WHERE workspace_id = 'main' AND trash_id = ?",
      )
      .get(atomicDelete).restored_at,
    null,
  );
  assert.equal(
    sql
      .prepare(
        "SELECT COUNT(*) AS count FROM entity_tombstones WHERE workspace_id = 'main' AND entity = 'notes' AND entity_id = 'trash-atomic'",
      )
      .get().count,
    1,
  );
  await restore(atomicDelete);

  // Archived content does not count toward the active workspace text budget.
  const largeCanvas = (id) => ({
    id,
    title: id,
    cards: Array.from({ length: 100 }, (_, index) => ({
      id: `${id}-${index}`,
      type: "text",
      text: "x".repeat(10000),
      x: index,
      y: 0,
      width: 200,
      height: 100,
      color: "#ffffff",
    })),
    edges: [],
  });
  await upsert("canvases", largeCanvas("trash-large-one"));
  const largeDelete = await remove("canvases", "trash-large-one");
  await upsert("canvases", largeCanvas("trash-large-two"));
  assert(
    sql
      .prepare(
        "SELECT length(payload) AS bytes FROM workspace_trash WHERE workspace_id = 'main' AND trash_id = ?",
      )
      .get(largeDelete).bytes > 1_000_000,
  );
  assert(
    (await read()).canvases.some((canvas) => canvas.id === "trash-large-two"),
  );

  // Legacy callers without operation IDs still receive durable recovery data.
  await upsert("notes", { id: "trash-fallback", title: "Fallback identifier" });
  const fallbackBase = (await read()).notes.find(
    (note) => note.id === "trash-fallback",
  );
  await store.mutateWorkspace(req, {
    action: "delete",
    entity: "notes",
    id: fallbackBase.id,
    base: fallbackBase,
  });
  const fallbackArchive = sql
    .prepare(
      "SELECT trash_id FROM workspace_trash WHERE workspace_id = 'main' AND entity_id = 'trash-fallback'",
    )
    .get();
  assert.match(fallbackArchive.trash_id, /^[a-zA-Z0-9_-]+$/);
  await restore(fallbackArchive.trash_id);
  sql
    .prepare("DELETE FROM workspace_receipts WHERE operation_id = ?")
    .run(atomicDelete);
  await conflict(() => remove("notes", "trash-fallback", atomicDelete));

  // Membership revocation blocks a restore at its final atomic write guard.
  const context = await access.teamAction(request("/api/teams", "alice"), {
    action: "create",
    name: "Trash access fixture",
  });
  const team = context.workspaces.find(
    (item) => item.name === "Trash access fixture",
  );
  const teamReq = request("/api/state", "alice", team.id);
  let teamState = await store.mutateWorkspace(teamReq, {
    action: "upsert",
    entity: "notes",
    item: {
      id: "trash-private",
      title: "Private recovery",
    },
    base: null,
    operationId: crypto.randomUUID(),
  });
  const privateId = crypto.randomUUID();
  teamState = await store.mutateWorkspace(teamReq, {
    action: "delete",
    entity: "notes",
    id: "trash-private",
    base: teamState.notes[0],
    operationId: privateId,
  });
  const prepared = await recovery.prepareTrashRestore(
    team.id,
    teamState,
    privateId,
  );
  const resolved = await access.resolveWorkspace(teamReq);
  sql
    .prepare(
      "DELETE FROM appmembers WHERE workspace_id = ? AND user_id = 'alice'",
    )
    .run(team.id);
  assert.equal(
    await journal.commitWorkspace(
      resolved,
      teamState,
      prepared.workspace,
      "revoked-restore",
      "test-hash",
      false,
      {
        restore: prepared.restore,
      },
    ),
    false,
  );
  assert.equal(
    sql
      .prepare(
        "SELECT restored_at FROM workspace_trash WHERE workspace_id = ? AND trash_id = ?",
      )
      .get(team.id, privateId).restored_at,
    null,
  );
  assert.equal(
    (await route.GET(request("/api/trash", "alice", team.id))).status,
    404,
  );
  await assert.rejects(
    () =>
      store.mutateWorkspace(teamReq, {
        action: "restore",
        id: privateId,
        operationId: crypto.randomUUID(),
      }),
    (error) => error.status === 404,
  );

  // Replacing a workspace invalidates older Undo, while retaining its archive.
  const beforeImport = await read();
  await write({
    action: "import",
    workspace: {
      ...createSeedWorkspace(),
      revision: beforeImport.revision,
    },
  });
  await conflict(() => restore(listIds[1]));
  const oldEntry = (await recovery.trashPage("main", null, "50")).entries.find(
    (entry) => entry.id === listIds[1],
  );
  assert.equal(oldEntry.restorable, false);
  assert(
    sql
      .prepare(
        "SELECT payload FROM workspace_trash WHERE workspace_id = 'main' AND trash_id = ?",
      )
      .get(listIds[1]).payload,
  );

  // Legacy views normalize the layout without rewriting storage on a read.
  const legacy = createSeedWorkspace();
  legacy.savedViews = [
    {
      id: "legacy-layout",
      name: "Old view",
      query: "",
      assignee: "",
      project: "",
      priority: "",
      status: "",
    },
  ];
  sql
    .prepare("UPDATE workspaces SET data = ? WHERE id = 'main'")
    .run(JSON.stringify(legacy));
  const oldData = sql
    .prepare("SELECT data FROM workspaces WHERE id = 'main'")
    .get().data;
  const normalized = await read();
  assert.equal(normalized.savedViews[0].layout, "board");
  assert.equal(
    sql.prepare("SELECT data FROM workspaces WHERE id = 'main'").get().data,
    oldData,
  );
  await upsert("savedViews", {
    id: "legacy-layout",
    layout: "timeline",
    name: "Updated view",
  });
  assert.equal((await read()).savedViews[0].layout, "timeline");
  console.log(
    "PASS: durable workspace Trash, atomic restore/Undo retries, links and history recovery, conflict warnings, safe task keys, scoped metadata pagination, superseded imports, revoked membership, and legacy saved-view layouts.",
  );
};
