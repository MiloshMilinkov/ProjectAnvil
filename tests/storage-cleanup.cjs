const assert = require("node:assert/strict");

module.exports = async function checkStorageCleanup({
  sql,
  store,
  request,
  objects,
  BUCKET,
  DB,
}) {
  const { createSeedWorkspace } = require("./compiled/app/lib/seed");
  const { applyMutation } = require("./compiled/app/lib/workspace-model");
  const accessStore = require("./compiled/app/lib/access-store");
  const route = require("./compiled/app/api/storage/route");
  const {
    previewStorageCleanup,
    applyStorageCleanup,
  } = require("./compiled/app/lib/storage-cleanup");
  const id = "storage-cleanup-fixture";
  const old = "2020-01-01T00:00:00.000Z";
  const current = new Date().toISOString();
  let workspace = createSeedWorkspace();
  workspace = applyMutation(workspace, {
    action: "upsert",
    entity: "notes",
    base: null,
    item: {
      id: "storage-note",
      title: "Keep current work",
      content: "Current link /api/media/live-link",
    },
  });
  workspace = applyMutation(workspace, {
    action: "upsert",
    entity: "media",
    base: null,
    item: {
      id: "active-file",
      name: "Active attachment",
      type: "text/plain",
      size: 4,
      url: "/api/media/active-file",
      createdAt: old,
      projectId: "",
    },
  });
  sql
    .prepare(
      "INSERT INTO workspaces(id,data,revision,updated_at) VALUES(?,?,?,?)",
    )
    .run(id, JSON.stringify(workspace), workspace.revision, current);
  sql
    .prepare(
      "INSERT INTO workspace_access(id,kind,owner_user_id) VALUES(?,'team','alice')",
    )
    .run(id);
  sql
    .prepare(
      "INSERT INTO appmembers(workspace_id,user_id,role) VALUES(?,'alice','owner')",
    )
    .run(id);
  sql
    .prepare(
      "INSERT INTO appmembers(workspace_id,user_id,role) VALUES(?,'bob','member')",
    )
    .run(id);
  sql
    .prepare(
      "INSERT INTO appmember_roles(workspace_id,user_id,role) VALUES(?,'bob','viewer')",
    )
    .run(id);
  const req = () => request("/api/storage", "alice", id);
  const resolve = () => accessStore.resolveWorkspace(req());
  const read = () => store.readWorkspace(req());
  const write = (input) =>
    store.mutateWorkspace(req(), {
      operationId: crypto.randomUUID(),
      ...input,
    });
  const post = async (body, user = "alice", headers = {}) =>
    route.POST(
      request("/api/storage", user, id, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );
  const settings = (remove) => ({
    retentionDays: 30,
    remove: { uploads: false, trash: false, history: false, ...remove },
  });
  const preview = async (remove) => {
    const response = await post({ action: "preview", ...settings(remove) });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const apply = (value) =>
    post({ action: "apply", preview: value, confirmed: true });
  const key = (mediaId) => `media/${id}/${mediaId}`;
  const seedFile = (
    mediaId,
    state = "retained",
    date = old,
    objectKey = key(mediaId),
  ) => {
    objects.set(
      objectKey,
      new TextEncoder().encode(`Private fixture ${mediaId}`),
    );
    sql
      .prepare(
        "INSERT INTO media_objects(workspace_id,media_id,object_key,state,created_at,unreferenced_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        id,
        mediaId,
        objectKey,
        state,
        date,
        state === "retained" ? date : null,
      );
  };
  const archive = (trashId, value, date = old) =>
    sql
      .prepare(
        `INSERT INTO workspace_trash
    (workspace_id,trash_id,entity,entity_id,title,payload,deleted_at) VALUES(?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        trashId,
        "notes",
        trashId,
        `Archived ${trashId}`,
        JSON.stringify(value),
        date,
      );
  try {
    for (const mediaId of [
      "unused",
      "trash-link",
      "canvas-link",
      "history-old",
      "history-latest",
      "live-link",
      "room-link",
      "template-link",
    ])
      seedFile(mediaId);
    seedFile("active-file", "active");
    seedFile("recent", "retained", current);
    seedFile("uploading", "uploading");
    seedFile("invalid-age", "retained", "");
    seedFile(
      "foreign-key",
      "retained",
      old,
      "media/personal_bob/do-not-delete",
    );
    objects.set(key("unknown-age"), new Uint8Array([1, 2]));
    archive("old-trash", {
      primary: {
        entity: "notes",
        item: { id: "deleted-note", content: "/api/media/trash-link" },
      },
    });
    archive(
      "recent-trash",
      {
        primary: {
          entity: "canvases",
          item: {
            id: "canvas",
            cards: [{ type: "media", entityId: "canvas-link" }],
          },
        },
      },
      current,
    );
    sql
      .prepare(
        "INSERT INTO workrooms(workspace_id,user_key,id,data,updated_at) VALUES(?,?,?,?,?)",
      )
      .run(
        id,
        "user:alice",
        "room",
        JSON.stringify({ checkpoint: { summary: "/api/media/room-link" } }),
        current,
      );
    sql
      .prepare(
        "INSERT INTO personal_templates(owner_key,id,data,updated_at) VALUES(?,?,?,?)",
      )
      .run(
        "user:alice",
        "storage-template",
        JSON.stringify({ content: "/api/media/template-link" }),
        current,
      );
    for (const [snapshot, content, savedAt] of [
      ["old", "/api/media/history-old", "2020-01-01T00:00:00.000Z"],
      ["middle", "Intermediate content", "2020-02-01T00:00:00.000Z"],
      ["latest", "/api/media/history-latest", "2020-03-01T00:00:00.000Z"],
    ])
      sql
        .prepare(
          "INSERT INTO note_history(workspace_id,note_id,snapshot_id,content,saved_at) VALUES(?,?,?,?,?)",
        )
        .run(id, "storage-note", snapshot, content, savedAt);

    const report = await route.GET(req());
    assert.equal(report.status, 200);
    assert.equal((await report.json()).canCleanup, true);
    assert.equal(
      (await post({ action: "preview", ...settings({ uploads: true }) }, "bob"))
        .status,
      403,
    );
    assert.equal(
      (
        await post(
          { action: "preview", ...settings({ uploads: true }) },
          "alice",
          { origin: "https://outside.example.test" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await post({ action: "preview", ...settings({}) })).status,
      400,
    );
    assert.equal(
      (
        await post({
          action: "preview",
          ...settings({ uploads: true }),
          retentionDays: 0,
        })
      ).status,
      400,
    );
    assert.equal(
      (await post({ action: "apply", preview: {}, confirmed: false })).status,
      400,
    );
    const uploadsOnly = await preview({ uploads: true });
    assert.deepEqual(
      uploadsOnly.items.uploads.map((row) => row.id),
      ["unused"],
      "All kept references and active uploads must be protected",
    );
    assert.equal(
      objects.has(key("unused")),
      true,
      "Preview never deletes bytes",
    );
    const all = await preview({ uploads: true, trash: true, history: true });
    assert.deepEqual(
      new Set(all.items.uploads.map((row) => row.id)),
      new Set(["unused", "trash-link", "history-old"]),
    );
    assert.equal(all.counts.trash, 1);
    assert.equal(all.counts.history, 2);

    await write({
      action: "upsert",
      entity: "tasks",
      base: null,
      item: { id: "storage-new-task", title: "Concurrent work" },
    });
    assert.equal(
      (await apply(all)).status,
      409,
      "Changed workspace invalidates the review",
    );
    assert.equal(objects.has(key("unused")), true);
    const beforeMetadataChange = await preview({ uploads: true });
    sql
      .prepare(
        "UPDATE media_objects SET unreferenced_at=? WHERE workspace_id=? AND media_id='unused'",
      )
      .run(current, id);
    assert.equal(
      (await apply(beforeMetadataChange)).status,
      409,
      "Freshly reused metadata cannot be deleted under an old review",
    );
    sql
      .prepare(
        "UPDATE media_objects SET unreferenced_at=? WHERE workspace_id=? AND media_id='unused'",
      )
      .run(old, id);

    const beforeAtomicFailure = await preview({
      uploads: true,
      trash: true,
      history: true,
    });
    sql.exec(`CREATE TRIGGER reject_storage_cleanup BEFORE INSERT ON storage_media_purges
      WHEN NEW.workspace_id = '${id}' BEGIN SELECT RAISE(ABORT, 'injected cleanup failure'); END`);
    const previousError = console.error;
    console.error = () => {};
    try {
      assert.equal((await apply(beforeAtomicFailure)).status, 500);
    } finally {
      console.error = previousError;
      sql.exec("DROP TRIGGER reject_storage_cleanup");
    }
    assert.equal(objects.has(key("unused")), true);
    assert.equal(
      sql
        .prepare(
          "SELECT COUNT(*) AS count FROM workspace_trash WHERE workspace_id=?",
        )
        .get(id).count,
      2,
    );
    assert.equal(
      sql
        .prepare(
          "SELECT COUNT(*) AS count FROM note_history WHERE workspace_id=?",
        )
        .get(id).count,
      3,
    );
    assert.equal(
      sql
        .prepare(
          "SELECT COUNT(*) AS count FROM storage_media_purges WHERE workspace_id=?",
        )
        .get(id).count,
      0,
    );

    // Membership can change after the preview's async reads but before its batch.
    const beforeRevocation = await preview({ uploads: true });
    const resolvedBeforeRevocation = await resolve();
    const workspaceBeforeRevocation = await read();
    const originalBatch = DB.batch;
    DB.batch = async (statements) => {
      if (
        statements[0].query.includes(
          "INSERT OR IGNORE INTO workspace_write_guards",
        )
      ) {
        sql
          .prepare(
            "UPDATE appmembers SET role='member' WHERE workspace_id=? AND user_id='alice'",
          )
          .run(id);
        sql
          .prepare(
            "INSERT INTO appmember_roles(workspace_id,user_id,role) VALUES(?,'alice','viewer')",
          )
          .run(id);
      }
      return originalBatch(statements);
    };
    try {
      await assert.rejects(
        () =>
          applyStorageCleanup(
            resolvedBeforeRevocation,
            workspaceBeforeRevocation,
            beforeRevocation,
          ),
        (error) => error.status === 409,
      );
    } finally {
      DB.batch = originalBatch;
      sql
        .prepare(
          "UPDATE appmembers SET role='owner' WHERE workspace_id=? AND user_id='alice'",
        )
        .run(id);
      sql
        .prepare(
          "DELETE FROM appmember_roles WHERE workspace_id=? AND user_id='alice'",
        )
        .run(id);
    }
    assert.equal(objects.has(key("unused")), true);

    const ready = await preview({ uploads: true, trash: true, history: true });
    const originalDelete = BUCKET.delete;
    let attemptedRestore = false;
    BUCKET.delete = async (objectKey) => {
      if (objectKey === key("unused"))
        throw new Error("Injected interrupted file deletion");
      if (!attemptedRestore) {
        attemptedRestore = true;
        const state = await read();
        await assert.rejects(
          () =>
            write({
              action: "import",
              workspace: {
                ...state,
                media: [
                  ...state.media,
                  {
                    id: "history-old",
                    name: "Old file",
                    type: "text/plain",
                    size: 1,
                    url: "/api/media/history-old",
                    createdAt: old,
                    projectId: "",
                  },
                ],
              },
            }),
          (error) =>
            error.status === 409 &&
            /permanently deleted attachment/.test(error.message),
          "A bucket deletion claim blocks imports/restores of purged files",
        );
      }
      return originalDelete(objectKey);
    };
    let result;
    try {
      const response = await apply(ready);
      assert.equal(response.status, 200, await response.clone().text());
      result = await response.json();
    } finally {
      BUCKET.delete = originalDelete;
    }
    assert.deepEqual(result.removed, { uploads: 2, trash: 1, history: 2 });
    assert.equal(result.pendingUploads, 1);
    assert.equal(attemptedRestore, true);
    assert.equal(objects.has(key("unused")), true);
    assert.equal(objects.has(key("history-old")), false);
    assert.equal(objects.has(key("trash-link")), false);
    assert.equal(
      sql
        .prepare("SELECT snapshot_id FROM note_history WHERE workspace_id=?")
        .get(id).snapshot_id,
      "latest",
    );
    assert.equal(
      sql
        .prepare("SELECT trash_id FROM workspace_trash WHERE workspace_id=?")
        .get(id).trash_id,
      "recent-trash",
    );
    for (const mediaId of [
      "active-file",
      "history-latest",
      "canvas-link",
      "live-link",
      "room-link",
      "template-link",
      "recent",
      "uploading",
      "unknown-age",
      "invalid-age",
    ])
      assert.equal(
        objects.has(key(mediaId)),
        true,
        `${mediaId} must survive cleanup`,
      );
    assert.equal(
      objects.has("media/personal_bob/do-not-delete"),
      true,
      "Metadata cannot authorize another workspace's key",
    );
    const health = await (await route.GET(req())).json();
    assert.equal(health.media.pendingCleanup, 1);

    const retry = await preview({ uploads: true });
    assert.deepEqual(
      retry.items.uploads.map((row) => row.id),
      ["unused"],
    );
    const retried = await (await apply(retry)).json();
    assert.equal(retried.removed.uploads, 1);
    assert.equal(retried.pendingUploads, 0);
    assert.equal(objects.has(key("unused")), false);
    assert.equal(
      (await apply(retry)).status,
      409,
      "An applied review cannot be replayed",
    );
    const valid = await preview({ history: true });
    assert.equal(
      (await apply({ ...valid, token: "0".repeat(64) })).status,
      409,
    );
    await assert.rejects(
      async () =>
        applyStorageCleanup(await resolve(), await read(), {
          ...valid,
          expiresAt: old,
        }),
      (error) => error.status === 409,
    );
    // Managers retain access to restricted projects; an editor never receives a
    // preview even if they can edit every project in the workspace.
    sql
      .prepare(
        "UPDATE appmember_roles SET role='editor' WHERE workspace_id=? AND user_id='bob'",
      )
      .run(id);
    assert.equal(
      (await post({ action: "preview", ...settings({ trash: true }) }, "bob"))
        .status,
      403,
    );
    assert.equal(
      (await route.GET(request("/api/storage", "bob", id))).status,
      403,
    );
    assert.equal(
      (
        await previewStorageCleanup(
          await resolve(),
          await read(),
          settings({ history: true }),
        )
      ).counts.history,
      0,
    );
    const { referencedMediaIds } = require("./compiled/app/lib/media-store");
    assert.deepEqual(
      referencedMediaIds({
        properties: {
          image: "/api/media/%65ncoded-live",
          nested: "%zz before %2Fapi%2F%6Dedia%2Fencoded-prefix",
        },
        content:
          "[relative](api/media/relative-live) [dot](/api/x/../media/dot-live) api\\media\\slash-live",
      }),
      new Set([
        "encoded-live",
        "encoded-prefix",
        "relative-live",
        "slash-live",
        "dot-live",
      ]),
    );
    for (const mediaId of [
      "encoded-live",
      "relative-live",
      "dot-live",
      "slash-live",
      "late-encoded",
    ])
      seedFile(mediaId);
    let note = (await read()).notes.find((item) => item.id === "storage-note");
    await write({
      action: "upsert",
      entity: "notes",
      item: {
        id: note.id,
        content: `${note.content}\n[relative](api/media/relative-live) [dot](/api/x/../media/dot-live) api\\media\\slash-live`,
        properties: { image: "/api/media/%65ncoded-live" },
      },
      base: note,
    });
    const beforeEncodedLink = await preview({ uploads: true });
    assert.deepEqual(
      beforeEncodedLink.items.uploads.map((item) => item.id),
      ["late-encoded"],
      "Nested and relative/encoded links protect their actual media identifier",
    );
    note = (await read()).notes.find((item) => item.id === "storage-note");
    await write({
      action: "upsert",
      entity: "notes",
      item: {
        id: note.id,
        content: `${note.content}\n[late](/api/%6dedia/%6cate-encoded)`,
      },
      base: note,
    });
    assert.equal(
      (await apply(beforeEncodedLink)).status,
      409,
      "A normalized link added after review invalidates deletion",
    );
    assert.equal(objects.has(key("late-encoded")), true);
    // The late link also has a newly saved recovery version. Remove only this
    // fixture version so subsequent cases can isolate each reference source.
    note = (await read()).notes.find((item) => item.id === "storage-note");
    await write({
      action: "upsert",
      entity: "notes",
      item: {
        id: note.id,
        content:
          "Current /api/media/live-link\napi/media/relative-live /api/x/../media/dot-live api\\media\\slash-live",
      },
      base: note,
    });
    sql
      .prepare(
        "DELETE FROM note_history WHERE workspace_id=? AND content LIKE '%late-encoded%'",
      )
      .run(id);
    sql
      .prepare(
        "DELETE FROM note_history WHERE workspace_id=? AND content LIKE '%6cate-encoded%'",
      )
      .run(id);
    sql
      .prepare(
        "DELETE FROM note_history WHERE workspace_id=? AND content LIKE '%dot-live%'",
      )
      .run(id);
    const assertEncodedRecovery = async () => {
      const review = await preview({ uploads: true });
      assert.equal(review.counts.uploads, 0);
      assert.equal(
        review.warnings.some((warning) =>
          warning.includes("encoded file paths"),
        ),
        true,
      );
    };
    archive(
      "encoded-trash",
      {
        primary: {
          entity: "notes",
          item: {
            id: "encoded-deleted",
            properties: { file: "/api/%6dedia/%6cate-encoded" },
          },
        },
      },
      current,
    );
    await assertEncodedRecovery();
    sql
      .prepare(
        "DELETE FROM workspace_trash WHERE workspace_id=? AND trash_id='encoded-trash'",
      )
      .run(id);
    for (const path of [
      "/api/x/../media/late-encoded",
      "api\\media\\late-encoded",
    ]) {
      archive(
        "nonstandard-path",
        {
          primary: {
            entity: "notes",
            item: { id: "nonstandard-note", content: path },
          },
        },
        current,
      );
      await assertEncodedRecovery();
      sql
        .prepare(
          "DELETE FROM workspace_trash WHERE workspace_id=? AND trash_id='nonstandard-path'",
        )
        .run(id);
    }
    sql
      .prepare(
        "INSERT INTO note_history(workspace_id,note_id,snapshot_id,content,saved_at) VALUES(?,?,?,?,?)",
      )
      .run(
        id,
        "encoded-note",
        "encoded-latest",
        "[image](api%2Fmedia%2Flate-encoded)",
        current,
      );
    await assertEncodedRecovery();
    sql
      .prepare(
        "DELETE FROM note_history WHERE workspace_id=? AND note_id='encoded-note'",
      )
      .run(id);
    sql
      .prepare(
        "UPDATE personal_templates SET data=? WHERE owner_key=? AND id=?",
      )
      .run(
        JSON.stringify({ content: "%2Fapi%2Fmedia%2Flate-encoded" }),
        "user:alice",
        "storage-template",
      );
    await assertEncodedRecovery();
    sql
      .prepare(
        "UPDATE personal_templates SET data=? WHERE owner_key=? AND id=?",
      )
      .run(
        JSON.stringify({
          content: "/api/media/template-link\n50% complete / next steps",
        }),
        "user:alice",
        "storage-template",
      );
    const beforeRoomRace = await preview({ uploads: true });
    assert.deepEqual(
      beforeRoomRace.items.uploads.map((item) => item.id),
      ["late-encoded"],
      "Ordinary percentage prose does not block cleanup",
    );
    const realBatch = DB.batch;
    DB.batch = async (statements) => {
      if (
        statements[0].query.includes(
          "INSERT OR IGNORE INTO workspace_write_guards",
        )
      )
        sql
          .prepare(
            "UPDATE workrooms SET data=? WHERE workspace_id=? AND id='room'",
          )
          .run(
            JSON.stringify({
              checkpoint: { summary: "/api/media/%6cate-encoded" },
            }),
            id,
          );
      return realBatch(statements);
    };
    try {
      assert.equal(
        (await apply(beforeRoomRace)).status,
        409,
        "A checkpoint reference saved just before the cleanup claim is protected atomically",
      );
    } finally {
      DB.batch = realBatch;
    }
    await assertEncodedRecovery();
    assert.equal(objects.has(key("late-encoded")), true);
    sql
      .prepare("UPDATE workrooms SET data=? WHERE workspace_id=? AND id='room'")
      .run(
        JSON.stringify({ checkpoint: { summary: "/api/media/room-link" } }),
        id,
      );
    seedFile("relative");
    const prefixReview = await preview({ uploads: true });
    assert.equal(
      prefixReview.items.uploads.some((item) => item.id === "relative"),
      true,
      "An unrelated identifier prefix remains eligible",
    );
    const prefixApplied = await apply(prefixReview);
    assert.equal(prefixApplied.status, 200, await prefixApplied.clone().text());
    assert.equal(
      objects.has(key("relative")),
      false,
      "Preview and apply agree when another attachment ID starts with this one",
    );
    for (const kept of [
      "live-link",
      "encoded-live",
      "relative-live",
      "dot-live",
      "slash-live",
    ])
      assert.equal(
        objects.has(key(kept)),
        true,
        "Normalized active references remain intact during unrelated cleanup",
      );
    // Protected leading rows must not consume the upload review limit forever.
    // Exercise current, history and personal-template links together with invalid
    // metadata before a later, genuinely unused file.
    const leading = { current: [], history: [], template: [] };
    for (const source of Object.keys(leading)) {
      for (let index = 0; index < 400; index++) {
        const mediaId = `limit-${source}-${String(index).padStart(4, "0")}`;
        seedFile(mediaId, "retained", "2010-01-01T00:00:00.000Z");
        leading[source].push(mediaId);
      }
    }
    const links = (ids) =>
      ids.map((mediaId) => `/api/media/${mediaId}`).join("\n");
    const populated = await read();
    populated.notes.find((item) => item.id === "storage-note").content +=
      `\n${links(leading.current)}`;
    sql
      .prepare("UPDATE workspaces SET data=? WHERE id=?")
      .run(JSON.stringify(populated), id);
    sql
      .prepare(
        "INSERT INTO note_history(workspace_id,note_id,snapshot_id,content,saved_at) VALUES(?,?,?,?,?)",
      )
      .run(id, "limit-history", "latest", links(leading.history), current);
    sql
      .prepare(
        "UPDATE personal_templates SET data=? WHERE owner_key=? AND id=?",
      )
      .run(
        JSON.stringify({
          content: `/api/media/template-link\n${links(leading.template)}`,
        }),
        "user:alice",
        "storage-template",
      );
    seedFile(
      "limit-invalid-key",
      "retained",
      "2010-01-01T00:00:00.000Z",
      "foreign/limit-invalid-key",
    );
    seedFile("limit-invalid-age", "retained", "0000-not-a-date");
    seedFile("zz-limit-eligible");
    const boundedReview = await preview({ uploads: true });
    assert.deepEqual(
      boundedReview.items.uploads.map((item) => item.id),
      ["zz-limit-eligible"],
      "More than 1,001 protected leading uploads cannot hide a later eligible file",
    );
    const boundedApplied = await apply(boundedReview);
    assert.equal(
      boundedApplied.status,
      200,
      await boundedApplied.clone().text(),
    );
    assert.equal(objects.has(key("zz-limit-eligible")), false);
    for (const mediaId of Object.values(leading).flat())
      assert.equal(
        objects.has(key(mediaId)),
        true,
        "Protected leading files are retained",
      );
    assert.equal(objects.has("foreign/limit-invalid-key"), true);
    assert.equal(objects.has(key("limit-invalid-age")), true);
    console.log(
      "Storage cleanup checks passed (review, retention, permissions, encoded/relative links, bounded eligible scans, concurrent claims, rollback, interrupted deletion and retry).",
    );
  } finally {
    sql.prepare("DELETE FROM workspaces WHERE id=?").run(id);
    sql
      .prepare("DELETE FROM personal_templates WHERE owner_key=? AND id=?")
      .run("user:alice", "storage-template");
    for (const objectKey of [...objects.keys()])
      if (
        objectKey.startsWith(`media/${id}/`) ||
        objectKey === "media/personal_bob/do-not-delete" ||
        objectKey === "foreign/limit-invalid-key"
      )
        objects.delete(objectKey);
  }
};
