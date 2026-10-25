const assert = require("node:assert/strict");

module.exports = async function checkTeamPermissions({
  sql,
  store,
  request,
  users,
}) {
  const access = require("./compiled/app/lib/access-store");
  const permissions = require("./compiled/app/lib/permissions");
  const journal = require("./compiled/app/lib/workspace-journal");
  const { applyMutation } = require("./compiled/app/lib/workspace-model");
  const ids = [
    "roles_owner",
    "roles_admin",
    "roles_editor",
    "roles_viewer",
    "roles_outside",
    "roles_limited",
  ];
  for (const id of ids) {
    const user = { id, username: id, name: id, email: `${id}@example.test` };
    users.set(id, user);
    sql
      .prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,username) VALUES(?,?,?,0,?,?,?)",
      )
      .run(id, id, user.email, Date.now(), Date.now(), id);
  }
  const [owner, admin, editor, viewer, outside, limited] = ids;
  const req = (id, workspace, route = "/api/state") =>
    request(route, id, workspace);
  const reject = (work, status) =>
    assert.rejects(work, (error) => error.status === status);
  const account = await access.teamAction(req(owner), {
    action: "create",
    name: "Team permissions fixture",
  });
  const team = account.workspaces.find(
    (item) => item.name === "Team permissions fixture",
  );
  assert(team);
  const manage = (id, input) =>
    access.teamAction(req(id, team.id), { ...input, workspaceId: team.id });
  const read = (id) => store.readWorkspace(req(id, team.id));
  const write = async (id, entity, item) => {
    const current = await read(id);
    return store.mutateWorkspace(req(id, team.id), {
      action: "upsert",
      entity,
      item,
      base: current[entity]?.find((value) => value.id === item.id) || null,
      operationId: crypto.randomUUID(),
    });
  };
  for (const [id, role] of [
    [admin, "admin"],
    [editor, "editor"],
    [viewer, "viewer"],
    [limited, "editor"],
  ]) {
    await manage(owner, { action: "invite", username: id, role });
    const invite = (await access.getAccountContext(req(id))).invitations.find(
      (item) => item.workspaceId === team.id,
    );
    assert.equal(invite.role, role);
    await access.teamAction(req(id), {
      action: "accept",
      invitationId: invite.id,
    });
    assert.equal((await access.resolveWorkspace(req(id, team.id))).role, role);
  }
  assert.equal(
    (await access.listTeamMembers(req(editor), team.id)).invitations.length,
    0,
  );
  await reject(
    () => manage(editor, { action: "invite", username: outside }),
    403,
  );
  await reject(
    () => manage(viewer, { action: "invite", username: outside }),
    403,
  );
  await reject(
    () => manage(admin, { action: "invite", username: outside, role: "admin" }),
    403,
  );
  await reject(
    () => manage(admin, { action: "set-role", userId: admin, role: "viewer" }),
    403,
  );
  await reject(
    () => manage(admin, { action: "set-role", userId: editor, role: "admin" }),
    403,
  );
  await reject(
    () => manage(admin, { action: "transfer", userId: editor }),
    403,
  );
  await reject(
    () => manage(owner, { action: "transfer", userId: outside }),
    400,
  );

  await write(owner, "projects", {
    id: "roles_public",
    name: "Public project",
    key: "PUB",
  });
  await write(owner, "projects", {
    id: "roles_private",
    name: "Private project title",
    key: "PRV",
  });
  await write(owner, "notes", {
    id: "roles_secret_note",
    title: "Hidden research title",
    content: "Hidden research content",
    projectId: "roles_private",
    createdAt: new Date().toISOString(),
  });
  await write(owner, "notes", {
    id: "roles_public_note",
    title: "Public research",
    projectId: "roles_public",
  });
  await write(owner, "noteTypes", {
    id: "roles_shared_schema",
    name: "Shared schema",
    fields: [
      {
        id: "retained",
        name: "Retained value",
        type: "text",
        required: false,
        options: [],
      },
    ],
  });
  await write(owner, "notes", {
    id: "roles_secret_note",
    customTypeId: "roles_shared_schema",
    propertyValues: { retained: "Protected value" },
  });
  await write(owner, "tasks", {
    id: "roles_secret_task",
    title: "Hidden task title",
    projectId: "roles_private",
  });
  await write(owner, "tasks", {
    id: "roles_public_task",
    title: "Public task",
    projectId: "roles_public",
    noteIds: ["roles_secret_note"],
  });
  await write(owner, "media", {
    id: "roles_secret_media",
    name: "hidden-reference.txt",
    type: "text/plain",
    size: 4,
    url: "/api/media/roles_secret_media",
    projectId: "roles_private",
    createdAt: new Date().toISOString(),
  });
  await write(owner, "canvases", {
    id: "roles_public_canvas",
    title: "Public canvas",
    projectId: "roles_public",
    cards: [
      {
        id: "private_note_card",
        type: "note",
        entityId: "roles_secret_note",
        text: "",
        x: 0,
        y: 0,
        width: 240,
        height: 180,
        color: "#ffffff",
      },
      {
        id: "private_media_card",
        type: "media",
        entityId: "roles_secret_media",
        text: "",
        x: 260,
        y: 0,
        width: 240,
        height: 180,
        color: "#ffffff",
      },
    ],
    edges: [],
  });
  await write(owner, "brainstorms", {
    id: "roles_board",
    title: "Public brainstorm",
    projectId: "roles_public",
    ideas: [
      {
        id: "roles_idea",
        title: "Public idea",
        noteId: "roles_secret_note",
        taskId: "roles_secret_task",
      },
    ],
  });
  await write(owner, "relationships", {
    id: "roles_connection",
    from: { type: "task", id: "roles_public_task" },
    to: { type: "note", id: "roles_secret_note" },
    kind: "depends-on",
  });
  await manage(owner, {
    action: "project-access",
    projectId: "roles_private",
    restricted: true,
    members: [{ userId: editor, role: "editor" }],
  });
  await reject(() => read(outside), 404);
  const visible = await read(viewer);
  assert(!JSON.stringify(visible).includes("Hidden research"));
  assert(!JSON.stringify(visible).includes("Private project title"));
  assert(!visible.projects.some((item) => item.id === "roles_private"));
  assert(!visible.media.some((item) => item.id === "roles_secret_media"));
  assert.deepEqual(
    visible.tasks.find((item) => item.id === "roles_public_task").noteIds,
    [],
  );
  assert.equal(visible.canvases[0].cards.length, 0);
  assert.equal(visible.brainstorms[0].ideas[0].noteId, "");
  assert.equal(visible.brainstorms[0].ideas[0].taskId, "");
  assert(!visible.relationships.some((item) => item.id === "roles_connection"));
  const limitedAccess = await access.resolveWorkspace(req(limited, team.id));
  const fullBeforeSchemaEdit = await read(owner);
  assert.throws(
    () =>
      permissions.assertMutationInputAccess(
        limitedAccess,
        fullBeforeSchemaEdit,
        {
          action: "upsert",
          entity: "noteTypes",
          item: { id: "roles_shared_schema", fields: [] },
        },
      ),
    (error) =>
      error.status === 403 && !error.message.includes("Hidden research"),
  );
  await assert.rejects(
    () =>
      write(limited, "noteTypes", { id: "roles_shared_schema", fields: [] }),
    (error) =>
      error.status === 403 && !error.message.includes("Hidden research"),
  );
  await reject(
    () =>
      write(limited, "notes", {
        id: "roles_secret_note",
        propertyValues: { invalid_field: "Malformed protected edit" },
      }),
    403,
  );
  await reject(
    () =>
      write(limited, "tasks", {
        id: "forged_hidden_link",
        title: "Forged linked task",
        noteIds: ["roles_secret_note"],
      }),
    403,
  );
  assert.doesNotThrow(
    () =>
      permissions.assertMutationInputAccess(
        limitedAccess,
        fullBeforeSchemaEdit,
        {
          action: "upsert",
          entity: "tasks",
          item: {
            id: "malformed",
            cards: [null],
            ideas: [null],
            blockedBy: {},
            noteIds: {},
          },
        },
      ),
    "Malformed structures remain model-validation errors rather than crashing permission inspection",
  );
  const legacyMediaWorkspace = structuredClone(await read(owner));
  const legacyMediaIds = [
    "legacy_property",
    "legacy_decision",
    "legacy_comment",
    "legacy_board",
    "legacy_project",
    "legacy_history",
  ];
  for (const id of legacyMediaIds)
    legacyMediaWorkspace.media.push({
      id,
      name: `${id}.txt`,
      url: `/api/media/${id}`,
      projectId: "",
      size: 1,
      type: "text/plain",
      createdAt: new Date().toISOString(),
    });
  const privateNote = legacyMediaWorkspace.notes.find(
    (note) => note.id === "roles_secret_note",
  );
  legacyMediaWorkspace.noteTypes.push({
    id: "legacy_file_type",
    name: "Legacy file reference",
    description: "",
    archived: false,
    fields: [
      {
        id: "reference",
        name: "Reference",
        type: "text",
        required: false,
        options: [],
      },
    ],
  });
  privateNote.customTypeId = "legacy_file_type";
  privateNote.propertyValues = { reference: "/api/media/legacy_property" };
  privateNote.kind = "decision";
  privateNote.decision = {
    status: "proposed",
    context: "/api/media/legacy_decision",
    options: "",
    outcome: "",
    consequences: "",
    ownerId: "",
    decidedOn: "",
    supersededById: "",
  };
  privateNote.snapshots.push({
    id: "legacy_snapshot",
    content: "/api/media/legacy_history",
    savedAt: new Date().toISOString(),
  });
  legacyMediaWorkspace.tasks
    .find((task) => task.id === "roles_secret_task")
    .comments.push({
      id: "legacy_comment",
      body: "/api/media/legacy_comment",
      personId: "",
      createdAt: new Date().toISOString(),
    });
  legacyMediaWorkspace.brainstorms.push({
    ...legacyMediaWorkspace.brainstorms[0],
    id: "legacy_private_board",
    projectId: "roles_private",
    description: "/api/media/legacy_board",
    ideas: [],
  });
  legacyMediaWorkspace.projects.find(
    (project) => project.id === "roles_private",
  ).goal = "/api/media/legacy_project";
  const restrictedViewer = await access.resolveWorkspace(req(viewer, team.id));
  for (const id of legacyMediaIds)
    assert.equal(
      permissions.canReadMedia(restrictedViewer, legacyMediaWorkspace, id),
      false,
      `${id} is referenced only by private project material`,
    );
  assert(
    (await read(admin)).notes.some((item) => item.id === "roles_secret_note"),
  );
  assert(
    (await read(editor)).notes.some((item) => item.id === "roles_secret_note"),
  );
  await reject(
    () =>
      write(viewer, "notes", { id: "viewer_attempt", title: "Cannot create" }),
    403,
  );
  await reject(
    () =>
      write(viewer, "tasks", {
        id: "roles_public_task",
        title: "Cannot modify",
      }),
    403,
  );

  // A project-specific editor grant never raises a workspace viewer's rights.
  await manage(owner, {
    action: "project-access",
    projectId: "roles_private",
    restricted: true,
    members: [
      { userId: editor, role: "editor" },
      { userId: viewer, role: "editor" },
    ],
  });
  assert(
    (await read(viewer)).notes.some((item) => item.id === "roles_secret_note"),
  );
  const viewerAccess = await access.resolveWorkspace(req(viewer, team.id));
  assert(permissions.canReadProject(viewerAccess, "roles_private"));
  assert(!permissions.canEditProject(viewerAccess, "roles_private"));
  await reject(
    () =>
      write(viewer, "notes", { id: "roles_secret_note", content: "Forbidden" }),
    403,
  );

  // An inherited project can restrict one otherwise-editing member to viewing.
  await manage(owner, {
    action: "project-access",
    projectId: "roles_public",
    restricted: false,
    members: [{ userId: editor, role: "viewer" }],
  });
  await reject(
    () =>
      write(editor, "notes", { id: "roles_public_note", content: "Forbidden" }),
    403,
  );
  await write(editor, "notes", {
    id: "roles_secret_note",
    content: "Accepted private edit",
  });
  await reject(
    () =>
      manage(editor, {
        action: "project-access",
        projectId: "roles_public",
        restricted: false,
        members: [],
      }),
    403,
  );
  await reject(
    () =>
      manage(owner, {
        action: "project-access",
        projectId: "roles_private",
        restricted: true,
        members: [{ userId: outside, role: "editor" }],
      }),
    400,
  );
  const details = await access.listTeamMembers(req(owner), team.id);
  await reject(
    () =>
      manage(owner, {
        action: "project-access",
        projectId: "roles_private",
        restricted: false,
        members: [],
        expectedRevision: details.securityRevision - 1,
      }),
    409,
  );

  // Revoked and downgraded grants are checked again inside the commit transaction.
  const staleAccess = await access.resolveWorkspace(req(editor, team.id));
  const staleState = await read(owner);
  const changedState = applyMutation(staleState, {
    action: "upsert",
    entity: "notes",
    item: { id: "roles_secret_note", content: "Stale edit" },
    base: staleState.notes.find((note) => note.id === "roles_secret_note"),
  });
  await manage(owner, {
    action: "set-role",
    userId: editor,
    role: "viewer",
    expectedRole: "editor",
  });
  assert.equal(
    await journal.commitWorkspace(
      staleAccess,
      staleState,
      changedState,
      crypto.randomUUID(),
      "stale-permission-save",
    ),
    false,
  );
  await reject(
    () =>
      write(editor, "notes", {
        id: "roles_secret_note",
        content: "Denied after downgrade",
      }),
    403,
  );
  await reject(
    () =>
      manage(owner, {
        action: "set-role",
        userId: editor,
        role: "editor",
        expectedRole: "editor",
      }),
    409,
  );
  await manage(owner, {
    action: "set-role",
    userId: editor,
    role: "editor",
    expectedRole: "viewer",
  });

  // An admin can lose access after request validation but before its transaction.
  // A guessed next revision is not sufficient: the transaction must acquire its
  // own authorization token before removing a member or invitation.
  const database = access.database();
  const originalBatch = database.batch;
  let revokeBeforeManagementWrite = true;
  database.batch = async function (statements) {
    if (
      revokeBeforeManagementWrite &&
      statements[0]?.query?.includes("workspace_security_guards")
    ) {
      revokeBeforeManagementWrite = false;
      sql
        .prepare(
          "UPDATE appmember_roles SET role='viewer' WHERE workspace_id=? AND user_id=?",
        )
        .run(team.id, admin);
      sql
        .prepare(
          "UPDATE workspace_security SET revision=revision+1 WHERE workspace_id=?",
        )
        .run(team.id);
    }
    return originalBatch.call(this, statements);
  };
  try {
    await reject(
      () => manage(admin, { action: "remove", userId: editor }),
      409,
    );
  } finally {
    database.batch = originalBatch;
  }
  assert(
    sql
      .prepare(
        "SELECT user_id FROM appmembers WHERE workspace_id=? AND user_id=?",
      )
      .get(team.id, editor),
  );
  await manage(owner, {
    action: "set-role",
    userId: admin,
    role: "admin",
    expectedRole: "viewer",
  });

  // The old member CHECK schema remains unchanged and defaults older rows to editor.
  sql
    .prepare("DELETE FROM appmember_roles WHERE workspace_id=? AND user_id=?")
    .run(team.id, editor);
  assert.equal(
    (await access.resolveWorkspace(req(editor, team.id))).role,
    "editor",
  );
  const beforeSecurity = (await access.resolveWorkspace(req(admin, team.id)))
    .securityRevision;
  const guardCount = sql
    .prepare("SELECT COUNT(*) AS count FROM workspace_security_guards")
    .get().count;
  assert.equal(
    guardCount,
    0,
    "Completed team actions leave no management lock behind",
  );

  // Exactly one owner is installed by a concurrent transfer, and old owners become admins.
  const transfers = await Promise.allSettled([
    manage(owner, {
      action: "transfer",
      userId: admin,
      expectedOwnerId: owner,
    }),
    manage(owner, {
      action: "transfer",
      userId: editor,
      expectedOwnerId: owner,
    }),
  ]);
  assert.equal(
    transfers.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const newOwner = sql
    .prepare("SELECT owner_user_id FROM workspace_access WHERE id=?")
    .get(team.id).owner_user_id;
  assert([admin, editor].includes(newOwner));
  const ownerRows = sql
    .prepare(
      "SELECT user_id FROM appmembers WHERE workspace_id=? AND role='owner'",
    )
    .all(team.id);
  assert.deepEqual(
    ownerRows.map((row) => row.user_id),
    [newOwner],
  );
  assert.equal(
    (await access.resolveWorkspace(req(owner, team.id))).role,
    "admin",
  );
  assert.equal(
    (await access.resolveWorkspace(req(newOwner, team.id))).role,
    "owner",
  );
  assert(
    (await access.resolveWorkspace(req(newOwner, team.id))).securityRevision >
      beforeSecurity,
  );
  await reject(
    () =>
      manage(owner, { action: "set-role", userId: newOwner, role: "viewer" }),
    400,
  );

  await manage(newOwner, { action: "remove", userId: viewer });
  await reject(() => read(viewer), 404);
  const viewerAccount = await access.getAccountContext(req(viewer));
  assert(!viewerAccount.workspaces.some((item) => item.id === team.id));
  await access.teamAction(req(owner, team.id), {
    action: "leave",
    workspaceId: team.id,
  });
  await reject(() => read(owner), 404);
  const activity = sql
    .prepare(
      "SELECT action,fields_json FROM workspace_activity WHERE workspace_id=? AND action='access-changed'",
    )
    .all(team.id);
  assert(
    activity.some((item) => JSON.parse(item.fields_json).includes("Ownership")),
  );
  assert.equal(
    sql.prepare("SELECT COUNT(*) AS count FROM workspace_security_guards").get()
      .count,
    0,
  );
  console.log(
    "PASS: legacy-safe viewer/editor/admin roles, scoped projects and hidden links/media, viewer ceilings, optimistic access changes, atomic revocation guards, ownership transfer races, and access activity.",
  );
};
