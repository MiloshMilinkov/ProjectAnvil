const assert = require("node:assert/strict");

module.exports = async function checkPortability({
  sql,
  store,
  request,
  users,
}) {
  const access = require("./compiled/app/lib/access-store");
  const route = require("./compiled/app/api/portable/route");
  const uploadRoute = require("./compiled/app/api/media/route");
  const {
    packPortableZip,
    unpackPortableZip,
    readPortableBundle,
  } = require("./compiled/app/lib/portable-markdown");
  const { env } = require("cloudflare:workers");
  const encoder = new TextEncoder();
  const identities = ["portable_owner", "portable_editor", "portable_viewer"];
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
  const context = await access.teamAction(request("/api/teams", owner), {
    action: "create",
    name: "Portable fixture",
  });
  const team = context.workspaces.find(
    (item) => item.name === "Portable fixture",
  );
  const req = (id, path = "/api/state", options = {}) =>
    request(path, id, team.id, options);
  const manage = (body) =>
    access.teamAction(req(owner, "/api/teams"), {
      ...body,
      workspaceId: team.id,
    });
  for (const [id, role] of [
    [editor, "editor"],
    [viewer, "viewer"],
  ]) {
    await manage({ action: "invite", username: id, role });
    const invite = (
      await access.getAccountContext(request("/api/account", id))
    ).invitations.find((item) => item.workspaceId === team.id);
    await access.teamAction(request("/api/teams", id), {
      action: "accept",
      invitationId: invite.id,
    });
  }
  const read = (id) => store.readWorkspace(req(id));
  const write = async (entity, item) =>
    store.mutateWorkspace(req(owner), {
      action: "upsert",
      entity,
      item,
      base:
        (await read(owner))[entity]?.find((record) => record.id === item.id) ||
        null,
      operationId: crypto.randomUUID(),
    });
  await write("projects", {
    id: "portable_public",
    name: "Public project",
    key: "PUB",
  });
  await write("projects", {
    id: "portable_private",
    name: "Secret project",
    key: "PRIV",
  });
  await manage({
    action: "project-access",
    projectId: "portable_private",
    restricted: true,
    members: [],
  });
  await write("notes", {
    id: "portable_secret",
    title: "Secret note",
    content: "Never export this private text to a viewer.",
    projectId: "portable_private",
  });
  const form = new FormData();
  form.append(
    "file",
    new Blob(["Reference bytes"], { type: "text/plain" }),
    "Reference.txt",
  );
  form.append("projectId", "portable_public");
  const upload = await uploadRoute.POST(
    req(owner, "/api/media", { method: "POST", body: form }),
  );
  assert.equal(upload.status, 201);
  const media = (await upload.json()).media;
  await write("notes", {
    id: "portable_visible",
    title: "Visible note",
    content: `# Visible\n\n[Reference](/api/media/${media.id})`,
    folder: "Planning",
    projectId: "portable_public",
  });
  const response = await route.GET(req(viewer, "/api/portable"));
  assert.equal(response.status, 200);
  const exported = unpackPortableZip(
    new Uint8Array(await response.arrayBuffer()),
  );
  assert(exported.some((file) => file.path.endsWith("Visible note.md")));
  assert(
    !exported.some((file) =>
      new TextDecoder()
        .decode(file.bytes)
        .includes("Never export this private text"),
    ),
  );
  assert(exported.some((file) => file.path.includes("Reference.txt")));
  assert.equal(
    (await route.GET(req(viewer, "/api/portable?project=portable_private")))
      .status,
    404,
  );
  const bundle = readPortableBundle(exported);
  assert.equal(bundle.notes.length, 1);
  assert.equal(bundle.attachments.length, 1);

  const legacyForm = new FormData();
  legacyForm.append(
    "file",
    new Blob(["Legacy property attachment bytes"], { type: "text/plain" }),
    "Property-only.txt",
  );
  const legacyUpload = await uploadRoute.POST(
    req(owner, "/api/media", { method: "POST", body: legacyForm }),
  );
  assert.equal(legacyUpload.status, 201);
  const legacyMedia = (await legacyUpload.json()).media;
  assert.equal(legacyMedia.projectId || "", "");
  await write("notes", {
    id: "portable_visible",
    properties: { reference: `/api/media/${legacyMedia.id}` },
  });
  const projectExport = await route.GET(
    req(viewer, "/api/portable?project=portable_public"),
  );
  assert.equal(projectExport.status, 200);
  const projectFiles = unpackPortableZip(
    new Uint8Array(await projectExport.arrayBuffer()),
  );
  const propertyAttachment = projectFiles.find((file) =>
    file.path.includes("Property-only.txt"),
  );
  assert(
    propertyAttachment,
    "Project export includes legacy attachments referenced only by current note properties",
  );
  assert.equal(
    new TextDecoder().decode(propertyAttachment.bytes),
    "Legacy property attachment bytes",
  );
  const projectBundle = readPortableBundle(projectFiles);
  assert.equal(projectBundle.attachments.length, 2);
  assert(
    !projectBundle.notes[0].body.includes(legacyMedia.id),
    "This fixture's legacy attachment is absent from note content",
  );
  assert(
    projectBundle.notes[0].metadata.properties.reference.includes(
      "Property-only.txt",
    ),
  );

  const archive = packPortableZip([
    {
      path: "Imported/Plan.md",
      bytes: encoder.encode(
        "# Plan\n\n![Reference](../files/reference.txt)\n\n@portable_viewer please review.",
      ),
    },
    {
      path: "files/reference.txt",
      bytes: encoder.encode("Portable attachment bytes"),
    },
  ]);
  const importRequest = (
    id,
    bytes = archive,
    operation = "portable_import_1",
    project = "portable_public",
  ) =>
    req(id, "/api/portable", {
      method: "POST",
      headers: {
        "Content-Type": "application/zip",
        "X-Import-Project": project,
        "X-Import-Operation": operation,
      },
      body: new Uint8Array(bytes),
    });
  const before = await read(owner);
  const uploadsBefore = sql
    .prepare("SELECT COUNT(*) AS count FROM media_objects WHERE workspace_id=?")
    .get(team.id).count;
  assert.equal((await route.POST(importRequest(viewer))).status, 403);
  assert.equal(
    (
      await route.POST(
        importRequest(editor, archive, "portable_denied", "portable_private"),
      )
    ).status,
    403,
  );
  assert.equal(
    sql
      .prepare(
        "SELECT COUNT(*) AS count FROM media_objects WHERE workspace_id=?",
      )
      .get(team.id).count,
    uploadsBefore,
  );
  const notificationsBefore = sql
    .prepare(
      "SELECT COUNT(*) AS count FROM workspace_notifications WHERE workspace_id=?",
    )
    .get(team.id).count;
  const saved = await route.POST(importRequest(editor));
  assert.equal(saved.status, 200, await saved.clone().text());
  const imported = await saved.json();
  assert.deepEqual(imported.imported, { notes: 1, attachments: 1 });
  const after = await read(owner);
  assert.equal(after.notes.length, before.notes.length + 1);
  assert.equal(after.media.length, before.media.length + 1);
  const note = after.notes.find(
    (item) => !before.notes.some((old) => old.id === item.id),
  );
  assert.equal(note.projectId, "portable_public");
  const attached = after.media.find(
    (item) => !before.media.some((old) => old.id === item.id),
  );
  assert.equal(attached.projectId, "portable_public");
  assert(note.content.includes(`/api/media/${attached.id}`));
  assert.equal(
    sql
      .prepare(
        "SELECT COUNT(*) AS count FROM workspace_notifications WHERE workspace_id=?",
      )
      .get(team.id).count,
    notificationsBefore,
    "Portable imports do not send mass mention notifications",
  );
  const retried = await route.POST(importRequest(editor));
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).alreadyImported, true);
  assert.equal((await read(owner)).notes.length, after.notes.length);
  const changed = packPortableZip([
    { path: "Other.md", bytes: encoder.encode("Different content") },
  ]);
  assert.equal(
    (await route.POST(importRequest(editor, changed))).status,
    409,
    "A receipt cannot be reused for another archive",
  );

  // Independent imports merge safely and receive distinct, readable note names.
  const concurrent = await Promise.all([
    route.POST(importRequest(editor, archive, "portable_concurrent_a")),
    route.POST(importRequest(editor, archive, "portable_concurrent_b")),
  ]);
  for (const item of concurrent)
    assert.equal(item.status, 200, await item.clone().text());
  const concurrentState = await read(owner);
  assert.equal(
    new Set(concurrentState.notes.map((item) => item.title.toLowerCase())).size,
    concurrentState.notes.length,
  );

  const failureArchive = packPortableZip([
    { path: "Fail.md", bytes: encoder.encode("No partial notes may appear.") },
    { path: "files/first.txt", bytes: encoder.encode("First") },
    { path: "files/second.txt", bytes: encoder.encode("Second") },
  ]);
  const originalPut = env.BUCKET.put;
  let writes = 0;
  env.BUCKET.put = async (...args) => {
    if (++writes === 2) throw new Error("Synthetic upload failure");
    return originalPut.apply(env.BUCKET, args);
  };
  const countBeforeFailure = (await read(owner)).notes.length;
  const originalError = console.error;
  console.error = (...args) => {
    if (
      args.some(
        (value) =>
          value instanceof Error &&
          value.message === "Synthetic upload failure",
      )
    )
      return;
    originalError(...args);
  };
  try {
    assert.equal(
      (
        await route.POST(
          importRequest(editor, failureArchive, "portable_failure"),
        )
      ).status,
      500,
    );
  } finally {
    env.BUCKET.put = originalPut;
    console.error = originalError;
  }
  assert.equal(
    (await read(owner)).notes.length,
    countBeforeFailure,
    "Attachment failures never partially commit notes",
  );
  assert(
    sql
      .prepare(
        "SELECT COUNT(*) AS count FROM media_objects WHERE workspace_id=? AND state='retained'",
      )
      .get(team.id).count >= 1,
  );
  assert.equal(
    (
      await route.POST(
        importRequest(editor, failureArchive, "portable_failure"),
      )
    ).status,
    200,
    "The same uncertain import can recover its staged files",
  );

  env.BUCKET.put = async (...args) => {
    await originalPut.apply(env.BUCKET, args);
    await manage({ action: "set-role", userId: editor, role: "viewer" });
  };
  const beforeRevocation = (await read(owner)).notes.length;
  try {
    assert.equal(
      (await route.POST(importRequest(editor, archive, "portable_revoked")))
        .status,
      403,
    );
  } finally {
    env.BUCKET.put = originalPut;
  }
  assert.equal(
    (await read(owner)).notes.length,
    beforeRevocation,
    "Revoked access prevents the whole batch commit",
  );
  console.log(
    "PASS: authorized Markdown exports with attachments, additive atomic imports, retry receipts, concurrent naming, suppressed import alerts, retained upload failures, and mid-upload access revocation.",
  );
};
