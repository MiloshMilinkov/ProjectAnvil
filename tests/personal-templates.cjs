const assert = require("node:assert/strict");

module.exports = async function checkPersonalTemplates({
  sql,
  store,
  request,
}) {
  const route = require("./compiled/app/api/templates/route");
  const templates = require("./compiled/app/lib/personal-templates");
  const access = require("./compiled/app/lib/access-store");
  const req = (user = "", body, workspace = "", headers = {}) =>
    request(
      "/api/templates",
      user,
      workspace,
      body === undefined
        ? { headers }
        : {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify(body),
          },
    );
  const post = async (user, body, workspace, expected = 200, headers) => {
    const response = await route.POST(req(user, body, workspace, headers));
    const json = await response.json();
    assert.equal(response.status, expected, JSON.stringify(json));
    return json.templates;
  };
  const read = async (user = "", workspace = "") => {
    const response = await route.GET(req(user, undefined, workspace));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    return (await response.json()).templates;
  };
  const input = {
    id: "routine-template",
    name: "Weekly routine",
    kind: "task",
    content: {
      title: "Review work",
      description: "Review progress",
      type: "task",
      priority: "high",
      estimate: 2,
      tags: ["weekly"],
      subtasks: ["Review", "Plan"],
    },
  };
  const save = { action: "save", template: input, base: null };
  let library = await post("alice", save);
  assert.equal(library.length, 1);
  assert.equal(library[0].revision, 1);
  assert.equal(library[0].deletedAt, null);
  assert.equal(
    (await post("alice", save))[0].revision,
    1,
    "Lost create response is safely retryable",
  );
  assert.deepEqual(
    await read("bob"),
    [],
    "Personal libraries never leak to another account",
  );
  assert.deepEqual(await read(), [], "The local guest library is separate");
  await post("bob", { action: "delete", id: input.id, base: 1 }, "", 404);
  await post("alice", save, "", 403, { origin: "https://elsewhere.example" });
  await post("alice", save, "", 409, { "x-account-id": "bob" });
  await post("", { ...save, template: { ...input, name: "Guest routine" } });
  assert.equal((await read())[0].name, "Guest routine");
  assert.equal((await read("alice"))[0].name, "Weekly routine");

  // Own this fixture instead of selecting a team created by another suite;
  // access tests deliberately retain rows whose memberships were revoked.
  const teamRequest = (user) =>
    request("/api/teams", user, "", { method: "POST" });
  const previousIds = new Set(
    (await access.getAccountContext(teamRequest("alice"))).workspaces.map(
      (workspace) => workspace.id,
    ),
  );
  const created = await access.teamAction(teamRequest("alice"), {
    action: "create",
    name: "Personal template test workspace",
  });
  const team = created.workspaces.find(
    (workspace) => workspace.kind === "team" && !previousIds.has(workspace.id),
  );
  assert.ok(team);
  assert.equal(
    (await read("alice", team.id))[0].id,
    input.id,
    "One account library is available in its different workspaces",
  );
  await access.teamAction(teamRequest("alice"), {
    action: "invite",
    workspaceId: team.id,
    username: "bob",
  });
  const invitation = (
    await access.getAccountContext(teamRequest("bob"))
  ).invitations.find((entry) => entry.workspaceId === team.id);
  assert.ok(invitation);
  await access.teamAction(teamRequest("bob"), {
    action: "accept",
    invitationId: invitation.id,
  });
  assert.deepEqual(
    await read("bob", team.id),
    [],
    "Sharing a workspace does not share personal templates",
  );
  await access.teamAction(teamRequest("alice"), {
    action: "remove",
    workspaceId: team.id,
    userId: "bob",
  });
  assert.equal(
    (await route.GET(req("bob", undefined, team.id))).status,
    404,
    "A revoked team context is rejected",
  );
  assert.equal(
    (await store.readWorkspace(request("/api/state", "alice")))
      .personalTemplates,
    undefined,
    "Template storage is outside workspace exports",
  );

  const renamed = { ...input, name: "Routine renamed" };
  const rename = { action: "save", template: renamed, base: 1 };
  library = await post("alice", rename);
  assert.equal(library[0].revision, 2);
  assert.equal(
    (await post("alice", rename))[0].revision,
    2,
    "Lost rename response is safely retryable",
  );
  await post(
    "alice",
    { ...rename, template: { ...renamed, name: "Stale edit" } },
    "",
    409,
  );
  const deletion = { action: "delete", id: input.id, base: 2 };
  library = await post("alice", deletion);
  assert.equal(library[0].revision, 3);
  assert.ok(library[0].deletedAt);
  assert.equal((await post("alice", deletion))[0].revision, 3);
  await post("alice", { ...rename, base: 3 }, "", 409);
  const restoration = { action: "restore", id: input.id, base: 3 };
  library = await post("alice", restoration);
  assert.equal(library[0].deletedAt, null);
  assert.equal(library[0].revision, 4);
  assert.equal((await post("alice", restoration))[0].revision, 4);
  await post("alice", deletion, "", 409, undefined);
  assert.equal(
    (await read("alice"))[0].deletedAt,
    null,
    "An old Delete retry cannot remove a restored template",
  );

  for (const content of [
    { ...input.content, projectId: "someone-elses-project" },
    { ...input.content, subtasks: Array(201).fill("Too many") },
    { ...input.content, estimate: -1 },
    { ...input.content, tags: Array(41).fill("tag") },
  ])
    await post(
      "alice",
      {
        action: "save",
        template: { ...input, id: "invalid-template", content },
        base: null,
      },
      "",
      400,
    );
  await post(
    "alice",
    {
      action: "save",
      template: { ...input, id: "invalid-template", revision: 900 },
      base: null,
    },
    "",
    400,
  );
  assert.equal(
    (
      await route.POST(
        new Request("http://127.0.0.1:5173/api/templates", {
          method: "POST",
          body: "{",
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await route.POST(
        new Request("http://127.0.0.1:5173/api/templates", {
          method: "POST",
          body: " ".repeat(180001),
        }),
      )
    ).status,
    413,
  );

  const original = {
    ...input.content,
    id: "task-before",
    key: "OLD-1",
    status: "done",
    projectId: "old-project",
    assigneeId: "old-person",
    startDate: "2026-10-01",
    dueDate: "2026-10-05",
    blockedBy: ["other"],
    noteIds: ["note-old"],
    source: { noteId: "note-old", excerpt: "source" },
    comments: [
      {
        id: "comment-old",
        personId: "old-person",
        body: "Private discussion",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ],
    subtasks: [{ id: "old-subtask", title: "Check", done: true }],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
  const content = templates.taskTemplateContent(original);
  assert.deepEqual(
    Object.keys(content).sort(),
    [
      "title",
      "description",
      "type",
      "priority",
      "estimate",
      "tags",
      "subtasks",
    ].sort(),
  );
  const first = templates.instantiateTaskTemplate(content);
  const second = templates.instantiateTaskTemplate(content);
  assert.notEqual(first.id, second.id);
  assert.equal(first.key, "");
  assert.equal(first.status, "todo");
  assert.equal(first.assigneeId, "");
  assert.equal(first.projectId, "");
  assert.equal(first.startDate, "");
  assert.equal(first.dueDate, "");
  assert.deepEqual(first.comments, []);
  assert.deepEqual(first.blockedBy, []);
  assert.deepEqual(first.noteIds, []);
  assert.equal(first.source, undefined);
  assert.equal(first.subtasks[0].done, false);
  assert.notEqual(first.subtasks[0].id, original.subtasks[0].id);
  assert.notEqual(first.subtasks[0].id, second.subtasks[0].id);
  first.tags.push("different");
  assert.equal(
    content.tags.length,
    1,
    "Instances do not mutate their template",
  );

  const noteContent = {
    title: "Research",
    content:
      "![Private image](/api/media/private-file?workspace=team_old)\n[Document](http://127.0.0.1:5173/api/media/private-pdf?workspace=old)\nhttps://example.com/public.pdf",
    kind: "research",
    folder: "Reference",
    tags: ["research"],
    properties: {
      source: "/api/media/private-file?workspace=old",
      topic: "Planning",
    },
  };
  library = await post("alice", {
    action: "save",
    template: {
      id: "note-template",
      name: "Research",
      kind: "note",
      content: noteContent,
    },
    base: null,
  });
  const savedNote = library.find((item) => item.id === "note-template");
  assert.equal(
    savedNote.content.content.includes("/api/media/"),
    false,
    "Server strips private attachment endpoints even for direct API requests",
  );
  assert.ok(
    savedNote.content.content.includes("https://example.com/public.pdf"),
  );
  assert.ok(savedNote.content.content.includes("[Attachment omitted]"));
  const note = templates.instantiateNoteTemplate(savedNote.content, {
    projectId: "current-project",
  });
  assert.equal(note.projectId, "current-project");
  assert.deepEqual(note.snapshots, []);
  assert.equal(note.bookmarked, false);
  note.properties.topic = "Changed";
  assert.equal(savedNote.content.properties.topic, "Planning");

  const concurrentCreate = {
    ...save,
    template: { ...input, id: "concurrent-template", name: "Concurrent" },
  };
  await Promise.all([
    post("alice", concurrentCreate),
    post("alice", concurrentCreate),
  ]);
  assert.equal(
    (await read("alice")).filter((item) => item.id === "concurrent-template")
      .length,
    1,
  );
  const concurrentDelete = {
    action: "delete",
    id: "concurrent-template",
    base: 1,
  };
  await Promise.all([
    post("alice", concurrentDelete),
    post("alice", concurrentDelete),
  ]);
  const concurrentRestore = {
    action: "restore",
    id: "concurrent-template",
    base: 2,
  };
  await Promise.all([
    post("alice", concurrentRestore),
    post("alice", concurrentRestore),
  ]);
  assert.equal(
    (await read("alice")).find((item) => item.id === "concurrent-template")
      .revision,
    3,
  );

  // A guarded single INSERT enforces caps even if two tabs read the same count.
  const quotaRow = sql
    .prepare("SELECT data FROM personal_templates WHERE owner_key = 'guest'")
    .get();
  const insert = sql.prepare(
    "INSERT INTO personal_templates (owner_key,id,data,revision,deleted_at,updated_at,last_action) VALUES ('quota-test',?,?,1,NULL,?,'save')",
  );
  for (let index = 0; index < 200; index++)
    insert.run(`quota-${index}`, quotaRow.data, new Date().toISOString());
  // Check capacity on the actual guest owner without touching persisted app data.
  sql.prepare("DELETE FROM personal_templates WHERE owner_key = 'guest'").run();
  sql
    .prepare(
      "UPDATE personal_templates SET owner_key = 'guest' WHERE owner_key = 'quota-test'",
    )
    .run();
  await post(
    "",
    { ...save, template: { ...input, id: "over-quota" } },
    "",
    409,
  );
  sql.prepare("DELETE FROM personal_templates WHERE owner_key = 'guest'").run();
  console.log(
    "PASS: personal task/note templates, cross-account/guest/team isolation, clean instances, attachment omission, revision conflicts, retry-safe delete/restore and library quotas.",
  );
};
