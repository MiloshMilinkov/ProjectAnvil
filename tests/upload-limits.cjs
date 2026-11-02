const assert = require("node:assert/strict");

module.exports = async function checkUploadLimits({
  sql,
  store,
  request,
  objects,
  users,
  BUCKET,
}) {
  const accessStore = require("./compiled/app/lib/access-store");
  const policy = require("./compiled/app/lib/upload-policy");
  const { recordUpload } = require("./compiled/app/lib/media-store");
  const { createSeedWorkspace } = require("./compiled/app/lib/seed");
  const mediaRoute = require("./compiled/app/api/media/route");
  const portableRoute = require("./compiled/app/api/portable/route");
  const storageRoute = require("./compiled/app/api/storage/route");
  const { packPortableZip } = require("./compiled/app/lib/portable-markdown");
  const {
    uploadErrorMessage,
  } = require("./compiled/app/lib/workspace-transport");
  const limit = policy.attachmentLimitBytes;
  const old = "2020-01-01T00:00:00.000Z";
  const encoder = new TextEncoder();
  const original = {
    list: BUCKET.list,
    put: BUCKET.put,
    delete: BUCKET.delete,
    now: Date.now,
    error: console.error,
  };
  const ids = [
    "upload_owner",
    "upload_editor",
    "upload_editor_two",
    "upload_editor_three",
    "upload_viewer",
  ];
  for (const id of ids) {
    const user = { id, username: id, name: id, email: `${id}@example.test` };
    users.set(id, user);
    sql
      .prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,username) VALUES(?,?,?,0,?,?,?)",
      )
      .run(id, id, user.email, original.now(), original.now(), id);
  }
  const [owner, editor, editorTwo, editorThree, viewer] = ids;
  const workspaces = [];
  function team(suffix, workspace = createSeedWorkspace()) {
    const id = `upload_limits_${suffix}`;
    sql
      .prepare(
        "INSERT INTO workspaces(id,data,revision,updated_at) VALUES(?,?,?,?)",
      )
      .run(
        id,
        JSON.stringify(workspace),
        workspace.revision,
        new Date().toISOString(),
      );
    sql
      .prepare(
        "INSERT INTO workspace_access(id,kind,owner_user_id) VALUES(?,'team',?)",
      )
      .run(id, owner);
    for (const user of ids) {
      sql
        .prepare(
          "INSERT INTO appmembers(workspace_id,user_id,role) VALUES(?,?,?)",
        )
        .run(id, user, user === owner ? "owner" : "member");
      if (user !== owner)
        sql
          .prepare(
            "INSERT INTO appmember_roles(workspace_id,user_id,role) VALUES(?,?,?)",
          )
          .run(id, user, user === viewer ? "viewer" : "editor");
    }
    workspaces.push(id);
    return id;
  }
  const req = (id, route = "/api/state", user = owner, options = {}) =>
    request(route, user, id, options);
  const resolve = (id, user = owner) =>
    accessStore.resolveWorkspace(req(id, "/api/media", user));
  const used = (id) =>
    sql
      .prepare(
        "SELECT COALESCE(SUM(bytes),0) AS bytes FROM upload_storage_objects WHERE workspace_id=?",
      )
      .get(id).bytes;
  const ready = (id) =>
    sql
      .prepare(
        "INSERT INTO upload_storage_inventory(workspace_id,token,ready,started_at) VALUES(?,'fixture',1,?)",
      )
      .run(id, original.now());
  const key = (id, media) => `media/${id}/${media}`;
  const register = async (id, media, user = owner) => {
    const access = await resolve(id, user);
    await recordUpload(access, media, key(id, media));
    return access;
  };
  const fail = async (action, status) => {
    let failure;
    try {
      await action();
    } catch (error) {
      failure = error;
    }
    assert(failure, `Expected HTTP ${status} failure`);
    assert.equal(failure.status, status, failure.message);
    return failure;
  };
  const upload = (id, size, user = owner) => {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(size)], { type: "text/plain" }),
      "Reference.txt",
    );
    return mediaRoute.POST(
      req(id, "/api/media", user, { method: "POST", body: form }),
    );
  };
  const archive = packPortableZip([
    {
      path: "Plan.md",
      bytes: encoder.encode("# Plan\n\nKeep the existing workspace intact."),
    },
    { path: "files/first.txt", bytes: encoder.encode("first") },
    { path: "files/second.txt", bytes: encoder.encode("second") },
  ]);
  const importRequest = (id, operation, user = owner) =>
    req(id, "/api/portable", user, {
      method: "POST",
      headers: {
        "Content-Type": "application/zip",
        "X-Import-Operation": operation,
      },
      body: new Uint8Array(archive),
    });
  try {
    // The virtual large object's provider size exercises the cap without allocating 500 MiB.
    const quota = team("quota");
    objects.set(key(quota, "untracked"), new Uint8Array([1]));
    objects.set(key(quota, "retained"), new Uint8Array(9));
    sql
      .prepare(
        "INSERT INTO media_objects(workspace_id,media_id,object_key,state,created_at,unreferenced_at) VALUES(?,?,?,'retained',?,?)",
      )
      .run(quota, "retained", key(quota, "retained"), old, old);
    objects.set(key("another_workspace", "private"), new Uint8Array(100));
    BUCKET.list = async (options) => {
      const result = await original.list.call(BUCKET, options);
      return {
        ...result,
        objects: result.objects.map((object) =>
          object.key === key(quota, "untracked")
            ? { ...object, size: limit - 21 }
            : object,
        ),
      };
    };
    const quotaAccess = await register(quota, "pending");
    await policy.reserveUploadBytes(quotaAccess, key(quota, "pending"), 2);
    assert.equal(
      used(quota),
      limit - 10,
      "Untracked, retained, and in-flight bytes all count; other workspaces do not",
    );
    const raced = await Promise.all([upload(quota, 7), upload(quota, 7)]);
    assert.deepEqual(
      raced.map((response) => response.status).sort(),
      [201, 413],
    );
    const accepted = await raced
      .find((response) => response.status === 201)
      .json();
    assert.equal(
      used(quota),
      limit - 3,
      "A competing upload cannot oversubscribe the allowance",
    );
    assert.equal(
      (await store.readWorkspace(req(quota))).media.length,
      1,
      "Only the acknowledged upload becomes a workspace attachment",
    );
    await policy.reserveUploadBytes(
      quotaAccess,
      key(quota, accepted.media.id),
      7,
    );
    const beforeResize = used(quota);
    assert.equal(
      (
        await fail(
          () =>
            policy.reserveUploadBytes(
              quotaAccess,
              key(quota, accepted.media.id),
              8,
            ),
          409,
        )
      ).code,
      "attachment_upload_changed",
    );
    assert.equal(
      used(quota),
      beforeResize,
      "Retry metadata cannot increase or decrease a prior reservation",
    );
    await policy.releaseUploadBytes(quota, key(quota, "pending"));
    assert.equal(
      used(quota),
      beforeResize,
      "Unconfirmed deletion never releases bytes",
    );
    const review = async () => {
      const response = await storageRoute.POST(
        req(quota, "/api/storage", owner, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "preview",
            retentionDays: 30,
            remove: { uploads: true, trash: false, history: false },
          }),
        }),
      );
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    };
    const cleanup = (preview) =>
      storageRoute.POST(
        req(quota, "/api/storage", owner, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "apply", preview, confirmed: true }),
        }),
      );
    BUCKET.delete = async (objectKey) => {
      if (objectKey === key(quota, "retained"))
        throw new Error("Synthetic interrupted bucket delete");
      return original.delete.call(BUCKET, objectKey);
    };
    const interrupted = await cleanup(await review());
    assert.equal(interrupted.status, 200);
    assert.equal((await interrupted.json()).pendingUploads, 1);
    assert.equal(
      used(quota),
      beforeResize,
      "Failed bucket deletion preserves its charge after metadata removal",
    );
    assert.equal(
      sql
        .prepare(
          "SELECT deleted_at FROM storage_media_purges WHERE workspace_id=? AND media_id='retained'",
        )
        .get(quota).deleted_at,
      null,
    );
    BUCKET.delete = original.delete;
    const recovered = await cleanup(await review());
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).pendingUploads, 0);
    assert.equal(
      used(quota),
      beforeResize - 9,
      "A successful retry and durable acknowledgement release exactly the deleted bytes",
    );
    const ownerReport = await storageRoute.GET(req(quota, "/api/storage"));
    assert.equal(ownerReport.status, 200);
    const report = await ownerReport.json();
    assert.equal(report.attachments.usedBytes, used(quota));
    assert.equal(report.attachments.remainingBytes, limit - used(quota));
    assert.equal(report.attachments.status, "ready");
    for (const user of [editor, viewer])
      assert.equal(
        (await storageRoute.GET(req(quota, "/api/storage", user))).status,
        403,
        "Aggregate usage remains owner/admin-only",
      );
    const beforeViewer = used(quota);
    assert.equal((await upload(quota, 1, viewer)).status, 403);
    assert.equal(used(quota), beforeViewer);

    // Flat guest objects are charged only to the legacy guest workspace.
    const guestInventory = sql
      .prepare(
        "SELECT * FROM upload_storage_inventory WHERE workspace_id='main'",
      )
      .get();
    const guestLedger = sql
      .prepare("SELECT * FROM upload_storage_objects WHERE workspace_id='main'")
      .all();
    sql
      .prepare("DELETE FROM upload_storage_inventory WHERE workspace_id='main'")
      .run();
    sql
      .prepare("DELETE FROM upload_storage_objects WHERE workspace_id='main'")
      .run();
    const guest = { id: "main", kind: "guest", role: "owner", user: null };
    try {
      await recordUpload(
        guest,
        "upload_legacy_pending",
        "media/main/upload_legacy_pending",
      );
      BUCKET.list = async () => ({
        objects: [
          { key: "media/upload_legacy_old", size: 11 },
          { key: "media/main/upload_canonical_old", size: 13 },
          { key: key(quota, "private"), size: limit },
        ],
        truncated: false,
      });
      await policy.reserveUploadBytes(
        guest,
        "media/main/upload_legacy_pending",
        1,
      );
      assert.equal(
        used("main"),
        25,
        "Flat legacy and canonical guest files count without charging account files",
      );
    } finally {
      sql
        .prepare(
          "DELETE FROM upload_storage_inventory WHERE workspace_id='main'",
        )
        .run();
      sql
        .prepare("DELETE FROM upload_storage_objects WHERE workspace_id='main'")
        .run();
      if (guestInventory)
        sql
          .prepare(
            "INSERT INTO upload_storage_inventory(workspace_id,token,ready,started_at) VALUES(?,?,?,?)",
          )
          .run(
            guestInventory.workspace_id,
            guestInventory.token,
            guestInventory.ready,
            guestInventory.started_at,
          );
      for (const row of guestLedger)
        sql
          .prepare(
            "INSERT INTO upload_storage_objects(workspace_id,object_key,bytes) VALUES(?,?,?)",
          )
          .run(row.workspace_id, row.object_key, row.bytes);
      sql
        .prepare(
          "DELETE FROM media_objects WHERE workspace_id='main' AND media_id='upload_legacy_pending'",
        )
        .run();
    }

    // Inventory completeness and lease recovery are exercised against actual persisted claims.
    const paged = team("paged");
    let pages = 0;
    BUCKET.list = async ({ prefix, cursor }) => {
      assert.equal(prefix, `media/${paged}/`);
      pages++;
      return cursor
        ? {
            objects: [{ key: key(paged, "second"), size: 3 }],
            truncated: false,
          }
        : {
            objects: [{ key: key(paged, "first"), size: 5 }],
            truncated: true,
            cursor: "next",
          };
    };
    await policy.reserveUploadBytes(
      await register(paged, "new"),
      key(paged, "new"),
      1,
    );
    assert.equal(pages, 2);
    assert.equal(used(paged), 9);
    const incomplete = team("incomplete");
    BUCKET.list = async () => ({
      objects: [{ key: key(incomplete, "old"), size: 8 }],
      truncated: true,
      cursor: "repeated",
    });
    const incompleteAccess = await register(incomplete, "new");
    await fail(
      () =>
        policy.reserveUploadBytes(incompleteAccess, key(incomplete, "new"), 1),
      503,
    );
    assert.deepEqual(
      await policy.readAttachmentStorageUsage(incompleteAccess),
      {
        usedBytes: null,
        remainingBytes: null,
        limitBytes: limit,
        status: "unavailable",
      },
      "An incomplete inventory cannot report a fictitious empty workspace",
    );
    assert.equal(
      sql
        .prepare(
          "SELECT ready FROM upload_storage_inventory WHERE workspace_id=?",
        )
        .get(incomplete).ready,
      0,
    );
    assert.equal(
      sql
        .prepare(
          "SELECT count(*) AS count FROM upload_storage_objects WHERE workspace_id=? AND object_key=?",
        )
        .get(incomplete, key(incomplete, "new")).count,
      0,
    );
    BUCKET.list = async () => ({
      objects: [{ key: key(incomplete, "old"), size: 4 }],
      truncated: false,
    });
    await policy.reserveUploadBytes(
      incompleteAccess,
      key(incomplete, "new"),
      1,
    );
    assert.equal(
      used(incomplete),
      5,
      "Retry discards partial inventory instead of double-counting it",
    );
    const lease = team("lease");
    const leaseAccess = await register(lease, "old_writer");
    await register(lease, "new_writer");
    let releaseListing, firstStarted;
    const started = new Promise((resolve) => {
      firstStarted = resolve;
    });
    let scans = 0;
    BUCKET.list = async () => {
      if (++scans === 1) {
        firstStarted();
        return new Promise((resolve) => {
          releaseListing = resolve;
        });
      }
      return {
        objects: [{ key: key(lease, "present"), size: 2 }],
        truncated: false,
      };
    };
    const staleWriter = policy.reserveUploadBytes(
      leaseAccess,
      key(lease, "old_writer"),
      1,
    );
    const staleOutcome = staleWriter.then(
      () => ({ passed: true }),
      (error) => ({ error }),
    );
    await started;
    const leaseTime = original.now();
    Date.now = () => leaseTime + 120_001;
    await policy.reserveUploadBytes(leaseAccess, key(lease, "new_writer"), 1);
    releaseListing({
      objects: [{ key: key(lease, "stale"), size: 100 }],
      truncated: false,
    });
    assert.equal((await staleOutcome).error.status, 503);
    assert.equal(
      used(lease),
      3,
      "An expired inventory owner cannot insert stale bytes or finish over its successor",
    );
    Date.now = original.now;
    BUCKET.list = original.list;

    const stalePermissions = team("revoked");
    ready(stalePermissions);
    const previouslyAllowed = await register(
      stalePermissions,
      "revoked_file",
      editor,
    );
    sql
      .prepare(
        "UPDATE appmember_roles SET role='viewer' WHERE workspace_id=? AND user_id=?",
      )
      .run(stalePermissions, editor);
    await fail(
      () =>
        policy.reserveUploadBytes(
          previouslyAllowed,
          key(stalePermissions, "revoked_file"),
          4,
        ),
      403,
    );
    await fail(() => policy.admitUploadRequest(previouslyAllowed), 403);
    assert.equal(
      used(stalePermissions),
      0,
      "A stale permission snapshot cannot add a reservation",
    );
    assert.equal(
      sql
        .prepare(
          "SELECT count(*) AS count FROM upload_rate_limits WHERE bucket_key=?",
        )
        .get(`request:workspace:${stalePermissions}`).count,
      0,
    );

    // Native SQL admission persists across module reloads and is shared by all upload routes.
    const throttled = team("throttled"),
      other = team("other");
    let clock = original.now() + 60_001;
    Date.now = () => clock;
    for (const user of [owner, editor, editorTwo]) {
      const access = await resolve(throttled, user);
      for (let index = 0; index < 20; index++)
        await policy.admitUploadRequest(access);
    }
    const blocked = req(throttled, "/api/media", editorThree, {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=fixture" },
      body: "must not be read",
    });
    const limited = await mediaRoute.POST(blocked);
    assert.equal(limited.status, 429);
    assert.equal(
      blocked.bodyUsed,
      false,
      "Throttling happens before multipart bytes are read",
    );
    assert(
      Number(limited.headers.get("Retry-After")) >= 1 &&
        Number(limited.headers.get("Retry-After")) <= 60,
    );
    const limitedBody = await limited.json();
    assert.equal(limitedBody.code, "upload_rate_limited");
    assert.equal(
      limitedBody.retryAfter,
      Number(limited.headers.get("Retry-After")),
    );
    assert.match(
      uploadErrorMessage(limited, limitedBody, "Upload failed."),
      /Try again in \d+ seconds?\./,
    );
    assert.equal(
      uploadErrorMessage(
        new Response(null, { status: 429, headers: { "Retry-After": "1" } }),
        { error: "Uploads are temporarily limited." },
        "Upload failed.",
      ),
      "Uploads are temporarily limited. Try again in 1 second.",
    );
    for (const retryAfter of [
      "-1",
      "0",
      "9999999",
      "NaN",
      "Wed, 21 Oct 2015 07:28:00 GMT",
    ])
      assert.equal(
        uploadErrorMessage(
          new Response(null, {
            status: 429,
            headers: { "Retry-After": retryAfter },
          }),
          {},
          "Upload failed.",
        ),
        "Upload failed. Wait a moment before trying again.",
      );
    assert.equal(
      uploadErrorMessage(
        new Response(null, { status: 413 }),
        { error: "Not enough attachment storage." },
        "Upload failed.",
      ),
      "Not enough attachment storage.",
    );
    const policyPath = require.resolve("./compiled/app/lib/upload-policy");
    delete require.cache[policyPath];
    const reopenedPolicy = require(policyPath);
    const otherOwner = await resolve(other);
    await fail(() => reopenedPolicy.admitUploadRequest(otherOwner), 429);
    assert.equal(
      sql
        .prepare("SELECT count FROM upload_rate_limits WHERE bucket_key=?")
        .get(`request:workspace:${throttled}`).count,
      60,
    );
    for (const user of [owner, editor, editorTwo])
      await policy.admitUploadWrites(await resolve(throttled, user), 500);
    await fail(() => policy.admitUploadWrites(otherOwner, 1), 429);
    const fourthEditor = await resolve(throttled, editorThree);
    await fail(() => policy.admitUploadWrites(fourthEditor, 1), 429);
    assert.equal(
      sql
        .prepare("SELECT count FROM upload_rate_limits WHERE bucket_key=?")
        .get(`write:workspace:${throttled}`).count,
      1500,
    );
    clock += 60_001;
    await reopenedPolicy.admitUploadRequest(await resolve(throttled));
    await reopenedPolicy.admitUploadWrites(await resolve(throttled), 400);
    assert.equal(
      sql
        .prepare("SELECT count FROM upload_rate_limits WHERE bucket_key=?")
        .get(`request:workspace:${throttled}`).count,
      1,
    );
    const readOnly = await resolve(throttled, viewer);
    await fail(() => policy.admitUploadWrites(readOnly, 1), 403);

    const imported = team("import");
    for (let index = 0; index < 19; index++)
      await policy.admitUploadRequest(await resolve(imported));
    const blockedImport = importRequest(imported, "upload_limited_archive");
    assert.equal((await portableRoute.POST(blockedImport)).status, 429);
    assert.equal(
      blockedImport.bodyUsed,
      false,
      "An import cannot bypass the request limit or decompress a denied body",
    );
    clock += 60_001;
    await policy.admitUploadWrites(await resolve(imported), 500);
    const writeDenied = await portableRoute.POST(
      importRequest(imported, "upload_limited_writes"),
    );
    assert.equal(writeDenied.status, 429);
    assert.equal(used(imported), 0);
    assert.equal((await store.readWorkspace(req(imported))).notes.length, 0);
    clock += 60_001;
    ready(imported);
    sql
      .prepare(
        "INSERT INTO upload_storage_objects(workspace_id,object_key,bytes) VALUES(?,?,?)",
      )
      .run(imported, key(imported, "retained_padding"), limit - 1);
    const quotaImport = await portableRoute.POST(
      importRequest(imported, "upload_quota_archive"),
    );
    assert.equal(quotaImport.status, 413);
    assert.equal((await quotaImport.json()).code, "attachment_quota_exceeded");
    assert.equal(used(imported), limit - 1);
    assert.equal(
      (await store.readWorkspace(req(imported))).notes.length,
      0,
      "Quota failure does not partially commit imported notes",
    );

    const uncertain = team("uncertain");
    let puts = 0;
    BUCKET.put = async (...args) => {
      await original.put.apply(BUCKET, args);
      if (++puts === 2)
        throw new Error("Synthetic lost upload acknowledgement");
    };
    console.error = () => {};
    const failedImport = await portableRoute.POST(
      importRequest(uncertain, "upload_uncertain_archive"),
    );
    console.error = original.error;
    assert.equal(failedImport.status, 500);
    assert.equal(
      used(uncertain),
      11,
      "Both uncertain and acknowledged object writes remain charged",
    );
    assert.equal((await store.readWorkspace(req(uncertain))).notes.length, 0);
    assert.equal(
      sql
        .prepare(
          "SELECT count(*) AS count FROM media_objects WHERE workspace_id=? AND state='retained'",
        )
        .get(uncertain).count,
      2,
    );
    BUCKET.put = original.put;
    const retry = await portableRoute.POST(
      importRequest(uncertain, "upload_uncertain_archive"),
    );
    assert.equal(retry.status, 200, await retry.clone().text());
    assert.equal(
      used(uncertain),
      11,
      "Retrying uncertain files reuses their exact-size reservations",
    );
    const recoveredState = await store.readWorkspace(req(uncertain));
    assert.equal(recoveredState.notes.length, 1);
    assert.equal(recoveredState.media.length, 2);
    const revision = recoveredState.revision;
    const receipt = await portableRoute.POST(
      importRequest(uncertain, "upload_uncertain_archive"),
    );
    assert.equal(receipt.status, 200);
    assert.equal((await receipt.json()).alreadyImported, true);
    assert.equal(
      (await store.readWorkspace(req(uncertain))).revision,
      revision,
    );
    assert.equal(used(uncertain), 11);
    console.log(
      "PASS: attachment inventory, retained/in-flight accounting, concurrent quotas, exact-size retries, deletion acknowledgement/recovery, lease takeover, durable actor/workspace throttles, denied-body boundaries, and shared import safeguards.",
    );
  } finally {
    BUCKET.list = original.list;
    BUCKET.put = original.put;
    BUCKET.delete = original.delete;
    Date.now = original.now;
    console.error = original.error;
    for (const objectKey of objects.keys())
      if (workspaces.some((id) => objectKey.startsWith(`media/${id}/`)))
        objects.delete(objectKey);
    objects.delete(key("another_workspace", "private"));
  }
};
