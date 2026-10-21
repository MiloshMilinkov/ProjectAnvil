const assert = require("node:assert/strict");

module.exports = async function checkReliability({
  sql,
  store,
  request,
  objects,
}) {
  const access = require("./compiled/app/lib/access-store");
  const stateRoute = require("./compiled/app/api/state/route");
  const historyRoute = require("./compiled/app/api/history/route");
  const storageRoute = require("./compiled/app/api/storage/route");
  const uploadRoute = require("./compiled/app/api/media/route");
  const read = () => store.readWorkspace(request("/api/state", "alice"));
  const write = (input) =>
    store.mutateWorkspace(request("/api/state", "alice"), {
      operationId: crypto.randomUUID(),
      ...input,
    });
  const create = (entity, item) =>
    write({ action: "upsert", entity, item, base: null });
  const rejected = (callback) =>
    assert.rejects(callback, (error) => error.status === 409);
  const originalName = (await read()).name;
  await write({
    action: "rename",
    name: "Reliable workspace",
    base: { name: originalName },
  });
  await rejected(() =>
    write({
      action: "rename",
      name: "Stale workspace name",
      base: { name: originalName },
    }),
  );
  await write({
    action: "rename",
    name: "Reliable workspace",
    base: { name: originalName },
  });

  await create("notes", {
    id: "reliable-note",
    title: "Reliability note",
    content: "Original content",
  });
  const original = (await read()).notes.find(
    (note) => note.id === "reliable-note",
  );
  await assert.rejects(
    () =>
      write({
        action: "upsert",
        entity: "notes",
        item: { id: original.id, content: "Unguarded" },
      }),
    (error) => error.status === 400,
  );
  const simultaneous = await Promise.allSettled([
    write({
      action: "upsert",
      entity: "notes",
      item: { id: original.id, content: "First writer" },
      base: original,
    }),
    write({
      action: "upsert",
      entity: "notes",
      item: { id: original.id, content: "Second writer" },
      base: original,
    }),
  ]);
  assert.equal(
    simultaneous.filter((result) => result.status === "fulfilled").length,
    1,
    "Conflicting fields must never silently replace a concurrent edit",
  );
  assert.equal(
    simultaneous.find((result) => result.status === "rejected").reason.status,
    409,
  );
  await write({
    action: "upsert",
    entity: "notes",
    item: { id: original.id, title: "Independent title" },
    base: original,
  });
  const current = (await read()).notes.find((note) => note.id === original.id);
  assert.notEqual(current.content, original.content);
  assert.equal(current.title, "Independent title");
  await rejected(() =>
    write({
      action: "delete",
      entity: "notes",
      id: original.id,
      base: original,
    }),
  );
  await write({
    action: "delete",
    entity: "notes",
    id: original.id,
    base: current,
  });
  await rejected(() =>
    write({
      action: "upsert",
      entity: "notes",
      item: { id: original.id, title: "Stale resurrection" },
      base: current,
    }),
  );
  await rejected(() =>
    create("notes", { id: original.id, title: "Reused deleted identifier" }),
  );

  const replay = {
    action: "upsert",
    entity: "tasks",
    item: { id: "retry-task", title: "Retry-safe task" },
    base: null,
    operationId: "reliable-lost-response",
  };
  const first = await write(replay);
  assert.equal(
    (await write(replay)).revision,
    first.revision,
    "An exact retry after a lost response is not a second mutation",
  );
  await rejected(() =>
    write({ ...replay, item: { ...replay.item, title: "Different payload" } }),
  );
  const retryTask = first.tasks.find((task) => task.id === "retry-task");
  await write({
    action: "upsert",
    entity: "tasks",
    item: { id: retryTask.id, priority: "high" },
    base: retryTask,
  });
  assert.equal(
    (await write(replay)).tasks.find((task) => task.id === retryTask.id)
      .priority,
    "high",
    "Receipt recovery returns current work without reapplying old data",
  );
  const commentBase = (await read()).tasks.find(
    (task) => task.id === retryTask.id,
  );
  const comment = (id) => ({
    id,
    personId: "account_bob",
    body: id,
    createdAt: "2000-01-01T00:00:00Z",
  });
  await Promise.all([
    write({
      action: "upsert",
      entity: "tasks",
      item: { id: retryTask.id, comments: [comment("parallel-one")] },
      base: commentBase,
    }),
    write({
      action: "upsert",
      entity: "tasks",
      item: { id: retryTask.id, comments: [comment("parallel-two")] },
      base: commentBase,
    }),
  ]);
  const comments = (await read()).tasks.find(
    (task) => task.id === retryTask.id,
  ).comments;
  assert.deepEqual(comments.map((item) => item.id).sort(), [
    "parallel-one",
    "parallel-two",
  ]);
  assert(
    comments.every(
      (item) =>
        item.personId === "account_alice" &&
        item.createdAt !== "2000-01-01T00:00:00Z",
    ),
  );

  await create("notes", {
    id: "quote-note",
    title: "Source whitespace",
    content: "Review the plan",
  });
  await create("tasks", {
    id: "quote-task",
    title: "Original source quote",
    source: { noteId: "quote-note", excerpt: "Review\n  the plan" },
  });
  assert.equal(
    (await read()).tasks.find((task) => task.id === "quote-task").source
      .excerpt,
    "Review\n  the plan",
  );
  await rejected(() =>
    create("tasks", {
      id: "quote-copy",
      title: "Whitespace-only duplicate",
      source: { noteId: "quote-note", excerpt: "Review the   plan" },
    }),
  );

  await create("notes", {
    id: "legacy-history",
    title: "Legacy long note",
    content: "L".repeat(100_000),
  });
  const workspaceRow = sql
    .prepare("SELECT data FROM workspaces WHERE id = ?")
    .get("personal_alice");
  const legacy = JSON.parse(workspaceRow.data);
  const legacyNote = legacy.notes.find((note) => note.id === "legacy-history");
  legacyNote.snapshots = Array.from({ length: 12 }, (_, index) => ({
    id: `legacy-version-${index}`,
    content: String(index % 10).repeat(100_000),
    savedAt: new Date(Date.UTC(2020, 0, index + 1)).toISOString(),
  }));
  sql
    .prepare("UPDATE workspaces SET data = ? WHERE id = ?")
    .run(JSON.stringify(legacy), "personal_alice");
  await write({
    action: "upsert",
    entity: "notes",
    item: { id: legacyNote.id, title: "Archived long note" },
    base: legacyNote,
  });
  assert.equal(
    (await read()).notes.find((note) => note.id === legacyNote.id).snapshots
      .length,
    0,
    "Active JSON no longer carries archived history",
  );
  assert.equal(
    sql
      .prepare(
        "SELECT COUNT(*) AS count FROM note_history WHERE workspace_id = ? AND note_id = ?",
      )
      .get("personal_alice", legacyNote.id).count,
    12,
  );
  await create("notes", {
    id: "second-long-note",
    title: "Second long note",
    content: "S".repeat(100_000),
  });
  for (let index = 0; index < 16; index++) {
    const base = (await read()).notes.find((note) => note.id === legacyNote.id);
    const snapshot = legacyNote.snapshots[index % 2];
    await write({
      action: "upsert",
      entity: "notes",
      item: { id: base.id, content: snapshot.content },
      base,
      restoreSnapshotId: snapshot.id,
    });
  }
  const archiveCount = sql
    .prepare(
      "SELECT COUNT(*) AS count FROM note_history WHERE workspace_id = ? AND note_id = ?",
    )
    .get("personal_alice", legacyNote.id).count;
  assert(
    archiveCount > 20,
    "Archived versions survive beyond the old twelve-version window",
  );
  const firstPage = await historyRoute.GET(
    request(`/api/history?note=${legacyNote.id}`, "alice"),
  );
  const page = await firstPage.json();
  assert.equal(firstPage.status, 200);
  assert.equal(page.snapshots.length, 20);
  assert(page.nextCursor);
  const secondPage = await (
    await historyRoute.GET(
      request(
        `/api/history?note=${legacyNote.id}&cursor=${page.nextCursor}`,
        "alice",
      ),
    )
  ).json();
  assert(
    secondPage.snapshots.every(
      (snapshot) =>
        !page.snapshots.some((previous) => previous.id === snapshot.id),
    ),
  );
  assert.equal(
    (
      await historyRoute.GET(
        request(
          `/api/history?note=${legacyNote.id}&workspace=personal_alice`,
          "bob",
        ),
      )
    ).status,
    404,
  );
  const beforeFailure = await read();
  const restoreBase = beforeFailure.notes.find(
    (note) => note.id === legacyNote.id,
  );
  await rejected(() =>
    write({
      action: "upsert",
      entity: "notes",
      item: { id: restoreBase.id, content: "Forged snapshot" },
      base: restoreBase,
      restoreSnapshotId: "legacy-version-0",
    }),
  );
  sql.exec(
    "CREATE TRIGGER reject_history_write BEFORE INSERT ON note_history WHEN NEW.note_id = 'legacy-history' BEGIN SELECT RAISE(ABORT, 'injected history failure'); END",
  );
  try {
    await assert.rejects(() =>
      write({
        action: "upsert",
        entity: "notes",
        item: { id: restoreBase.id, content: legacyNote.snapshots[0].content },
        base: restoreBase,
        restoreSnapshotId: "legacy-version-0",
        operationId: "atomic-history-failure",
      }),
    );
    assert.equal(
      (await read()).revision,
      beforeFailure.revision,
      "An archive failure rolls back its workspace write",
    );
    assert.equal(
      sql.prepare("SELECT COUNT(*) AS count FROM workspace_write_guards").get()
        .count,
      0,
    );
    assert.equal(
      sql
        .prepare(
          "SELECT COUNT(*) AS count FROM workspace_receipts WHERE operation_id = ?",
        )
        .get("atomic-history-failure").count,
      0,
    );
  } finally {
    sql.exec("DROP TRIGGER reject_history_write");
  }

  const largeCanvas = {
    id: "large-guarded-canvas",
    title: "Large guarded canvas",
    cards: Array.from({ length: 110 }, (_, index) => ({
      id: `large-card-${index}`,
      type: "text",
      text: "C".repeat(10_000),
      x: index,
      y: 0,
      width: 200,
      height: 100,
      color: "#ffffff",
    })),
    edges: [],
  };
  await create("canvases", largeCanvas);
  const canvasBase = (await read()).canvases.find(
    (canvas) => canvas.id === largeCanvas.id,
  );
  const canvasChange = { ...canvasBase, title: "Large canvas changed" };
  const guardedBody = JSON.stringify({
    action: "upsert",
    entity: "canvases",
    item: canvasChange,
    base: canvasBase,
    operationId: crypto.randomUUID(),
  });
  assert(Buffer.byteLength(guardedBody) > 2_000_000);
  assert.equal(
    (
      await stateRoute.POST(
        request("/api/state", "alice", "", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: guardedBody,
        }),
      )
    ).status,
    200,
    "A valid large canvas plus its baseline fits the bounded mutation envelope",
  );
  await write({
    action: "delete",
    entity: "canvases",
    id: largeCanvas.id,
    base: canvasChange,
  });
  await assert.rejects(
    () =>
      store.readMutationRequest(
        new Request("https://projectanvil.example/api/state", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "import",
            padding: "x".repeat(2_000_000),
          }),
        }),
      ),
    (error) => error.status === 413,
  );

  const form = new FormData();
  form.append(
    "file",
    new File(["retained file data"], "retained.txt", { type: "text/plain" }),
  );
  const uploaded = await uploadRoute.POST(
    request("/api/media", "alice", "", { method: "POST", body: form }),
  );
  assert.equal(uploaded.status, 201);
  const file = (await uploaded.json()).media;
  const clientBase = store
    .workspaceForClient(await read(), "personal_alice")
    .media.find((item) => item.id === file.id);
  await write({
    action: "delete",
    entity: "media",
    id: file.id,
    base: clientBase,
  });
  assert(
    objects.has(`media/personal_alice/${file.id}`),
    "Unreferenced bytes are deliberately retained for recovery",
  );
  assert.equal(
    sql
      .prepare(
        "SELECT state FROM media_objects WHERE workspace_id = ? AND media_id = ?",
      )
      .get("personal_alice", file.id).state,
    "retained",
  );
  objects.set(
    "media/personal_alice/untracked-recovery",
    new TextEncoder().encode("orphan bytes"),
  );
  objects.set(
    "media/personal_bob/hidden-bob-file",
    new TextEncoder().encode("private other account bytes"),
  );
  const health = await (
    await storageRoute.GET(request("/api/storage", "alice"))
  ).json();
  assert.equal(health.media.retained, 2);
  assert.equal(health.media.untracked, 1);
  assert(
    health.history.bytes > 1_500_000,
    "Archived history does not exhaust the active text allowance",
  );
  assert(health.activeBytes < health.limitBytes);
  const beforeUploadFailure = await read();
  sql.exec(
    "CREATE TRIGGER reject_media_commit BEFORE UPDATE ON workspaces WHEN NEW.id = 'personal_alice' BEGIN SELECT RAISE(ABORT, 'injected upload failure'); END",
  );
  const previousError = console.error;
  try {
    console.error = () => {};
    const failedForm = new FormData();
    failedForm.append(
      "file",
      new File(["recover this upload"], "failed.txt", { type: "text/plain" }),
    );
    const failed = await uploadRoute.POST(
      request("/api/media", "alice", "", { method: "POST", body: failedForm }),
    );
    assert.equal(failed.status, 500);
    assert.equal((await read()).revision, beforeUploadFailure.revision);
    const retainedUpload = sql
      .prepare(
        "SELECT media_id, object_key FROM media_objects WHERE workspace_id = ? AND state = 'retained' ORDER BY created_at DESC LIMIT 1",
      )
      .get("personal_alice");
    assert(
      objects.has(retainedUpload.object_key),
      "A metadata failure never destroys the retained uploaded bytes",
    );
    assert(
      !(await read()).media.some((item) => item.id === retainedUpload.media_id),
    );
  } finally {
    console.error = previousError;
    sql.exec("DROP TRIGGER reject_media_commit");
  }

  const unchanged = await stateRoute.GET(request("/api/state", "alice"));
  const etag = unchanged.headers.get("etag");
  assert.match(etag, /^"[a-f0-9]{64}"$/);
  assert.equal(
    (
      await stateRoute.GET(
        request("/api/state", "alice", "", {
          headers: { "if-none-match": etag },
        }),
      )
    ).status,
    304,
  );
  await access.teamAction(request("/api/teams", "alice"), {
    action: "create",
    name: "ETag membership fixture",
  });
  const team = (
    await access.getAccountContext(request("/api/account", "alice"))
  ).workspaces.find(
    (item) => item.kind === "team" && item.name === "ETag membership fixture",
  );
  const beforeMember = await stateRoute.GET(
    request("/api/state", "alice", team.id),
  );
  const memberEtag = beforeMember.headers.get("etag");
  const initialRevision = (await beforeMember.json()).workspace.revision;
  await access.teamAction(request("/api/teams", "alice"), {
    action: "invite",
    workspaceId: team.id,
    username: "bob",
  });
  const invite = (
    await access.getAccountContext(request("/api/account", "bob"))
  ).invitations.find((item) => item.workspaceId === team.id);
  await access.teamAction(request("/api/teams", "bob"), {
    action: "accept",
    invitationId: invite.id,
  });
  const afterMember = await stateRoute.GET(
    request("/api/state", "alice", team.id, {
      headers: { "if-none-match": memberEtag },
    }),
  );
  assert.equal(
    afterMember.status,
    200,
    "Membership projections invalidate ETags without a workspace revision change",
  );
  assert.equal((await afterMember.json()).workspace.revision, initialRevision);

  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1_000_001));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    () =>
      store.readMutationRequest(
        new Request("https://projectanvil.example/api/state", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: stream,
          duplex: "half",
        }),
      ),
    (error) => error.status === 413,
  );
  assert(
    cancelled,
    "An oversized body without Content-Length is cancelled during reading",
  );
  const oversizedMedia = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(5_000_000));
    },
  });
  assert.equal(
    (
      await uploadRoute.POST(
        request("/api/media", "alice", "", {
          method: "POST",
          headers: { "content-type": "multipart/form-data; boundary=audit" },
          body: oversizedMedia,
          duplex: "half",
        }),
      )
    ).status,
    413,
  );
  console.log(
    "PASS: conflicting-field guards, unrelated merges, deletion tombstones, idempotent lost-response recovery, authenticated concurrent discussions, quote deduplication, durable paged history, atomic rollback, scoped media retention/reconciliation, membership-aware ETags and bounded streamed bodies.",
  );
};
