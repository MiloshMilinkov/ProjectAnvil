const assert = require("node:assert/strict");

module.exports = async function checkConnectedThinking({
  sql,
  store,
  request,
}) {
  const {
    applyMutation,
    validateMutation,
    validateWorkspace,
  } = require("./compiled/app/lib/workspace-model");
  const { createSeedWorkspace } = require("./compiled/app/lib/seed");
  const {
    relationshipImpact,
    entitySignature,
  } = require("./compiled/app/lib/relationships");
  const access = require("./compiled/app/lib/access-store");
  const journal = require("./compiled/app/lib/workspace-journal");
  const now = "2026-10-24T12:00:00.000Z";
  let state = createSeedWorkspace();
  const write = (input, actor) => {
    const mutation = ["upsert", "delete"].includes(input.action)
      ? {
          ...input,
          base:
            state[input.entity]?.find(
              (item) => item.id === (input.item?.id || input.id),
            ) || null,
        }
      : input;
    state = applyMutation(state, mutation, now, actor);
    return state;
  };
  const put = (entity, item) => write({ action: "upsert", entity, item });
  const field = (id, type, extra = {}) => ({
    id,
    name: id,
    type,
    required: false,
    options: [],
    ...extra,
  });
  const schema = {
    id: "reference-type",
    name: "Reference",
    fields: [
      field("weight", "number", { required: true }),
      field("date", "date"),
      field("ready", "checkbox"),
      field("stage", "select", { options: ["Draft", "Final"] }),
    ],
  };
  put("noteTypes", schema);
  put("notes", {
    id: "reference",
    title: "Reference",
    customTypeId: schema.id,
  });
  assert.deepEqual(
    state.notes[0].propertyValues,
    {},
    "Required blanks remain autosave-safe drafts",
  );
  const invalid = (entity, item, pattern) =>
    assert.throws(() => put(entity, item), pattern);
  invalid(
    "notes",
    { id: "reference", propertyValues: { weight: "Infinity" } },
    /number/,
  );
  invalid(
    "notes",
    { id: "reference", propertyValues: { date: "2027-02-29" } },
    /valid date/,
  );
  invalid(
    "notes",
    { id: "reference", propertyValues: { ready: "yes" } },
    /checkbox/,
  );
  invalid(
    "notes",
    { id: "reference", propertyValues: { stage: "Unknown" } },
    /current choices/,
  );
  invalid(
    "notes",
    { id: "reference", propertyValues: { hidden: "value" } },
    /outside its custom/,
  );
  put("notes", {
    id: "reference",
    propertyValues: {
      weight: "1.5",
      date: "2028-02-29",
      ready: "false",
      stage: "Draft",
    },
  });
  invalid(
    "noteTypes",
    { ...schema, fields: schema.fields.slice(1) },
    /Keep the field|outside/,
  );
  invalid(
    "noteTypes",
    {
      ...schema,
      fields: schema.fields.map((value) =>
        value.id === "weight" ? { ...value, type: "date" } : value,
      ),
    },
    /valid date/,
  );
  invalid(
    "noteTypes",
    {
      ...schema,
      fields: schema.fields.map((value) =>
        value.id === "stage" ? { ...value, options: ["Final"] } : value,
      ),
    },
    /current choices/,
  );
  invalid(
    "noteTypes",
    { id: "other-type", name: "reference", fields: [] },
    /name already exists/,
  );
  invalid(
    "noteTypes",
    {
      id: "bad-type",
      name: "Bad",
      fields: [field("selection", "select", { options: ["One", "one"] })],
    },
    /unique/,
  );
  invalid(
    "noteTypes",
    {
      id: "bad-type",
      name: "Bad",
      fields: Array.from({ length: 31 }, (_, i) => field(`f${i}`, "text")),
    },
    /30/,
  );
  put("tasks", { id: "dependent", title: "Dependent task" });
  put("relationships", {
    id: "support",
    from: { type: "note", id: "reference" },
    to: { type: "task", id: "dependent" },
    kind: "supports",
  });
  put("notes", {
    id: "reference",
    propertyValues: { ...state.notes[0].propertyValues, weight: "2" },
  });
  assert(relationshipImpact(state).affected.has("task:dependent"));
  write({
    action: "review-relationship",
    id: "support",
    expectedFromSignature: entitySignature(state, {
      type: "note",
      id: "reference",
    }),
  });
  put("noteTypes", { id: schema.id, name: "Renamed reference" });
  assert(
    relationshipImpact(state).affected.has("task:dependent"),
    "Field/type meaning changes must flag connected work",
  );
  put("noteTypes", { id: schema.id, archived: true });
  invalid(
    "notes",
    {
      id: "archived-new",
      title: "No new archived assignment",
      customTypeId: schema.id,
    },
    /archived/,
  );
  put("notes", { id: "reference", title: "Updated reference" });
  assert.throws(
    () => write({ action: "delete", entity: "noteTypes", id: schema.id }),
    /still in use/,
  );

  put("notes", { id: "decision", title: "Decision", kind: "decision" });
  const proposed = state.notes.find((note) => note.id === "decision").decision;
  assert.equal(proposed.status, "proposed");
  invalid(
    "notes",
    { id: "decision", decision: { ...proposed, status: "accepted" } },
    /outcome and decision date/,
  );
  put("notes", {
    id: "decision",
    decision: {
      ...proposed,
      status: "accepted",
      outcome: "Use the accessible option",
      decidedOn: "2026-10-24",
    },
  });
  put("relationships", {
    id: "decision-link",
    from: { type: "task", id: "dependent" },
    to: { type: "note", id: "decision" },
    kind: "decided-because",
  });
  const record = state.notes.find((note) => note.id === "decision").decision;
  put("notes", {
    id: "decision",
    decision: { ...record, outcome: "Use an improved accessible option" },
  });
  assert(relationshipImpact(state).relationshipIds.has("decision-link"));
  put("notes", {
    id: "replacement",
    title: "Replacement decision",
    kind: "decision",
  });
  put("notes", {
    id: "decision",
    decision: {
      ...record,
      status: "superseded",
      supersededById: "replacement",
    },
  });
  invalid(
    "notes",
    {
      id: "replacement",
      decision: {
        ...proposed,
        status: "superseded",
        supersededById: "decision",
      },
    },
    /cycle/,
  );
  invalid("notes", { id: "decision", kind: "note" }, /Clear the decision/);
  put("relationshipPresets", {
    id: "evidence",
    name: "Evidence",
    kind: "decided-because",
    fromType: "note",
    toType: "any",
  });
  put("brainstorms", {
    id: "ideas",
    title: "Ideas",
    groups: [{ id: "group", title: "Explore" }],
    ideas: [
      {
        id: "idea",
        title: "First idea",
        groupId: "group",
        noteId: "reference",
        taskId: "dependent",
        votes: ["forged"],
      },
    ],
  });
  assert.deepEqual(state.brainstorms[0].ideas[0].votes, []);
  const staleBoard = structuredClone(state.brainstorms[0]);
  write(
    { action: "vote-idea", id: "ideas", ideaId: "idea", vote: true },
    "guest",
  );
  write(
    { action: "vote-idea", id: "ideas", ideaId: "idea", vote: true },
    "guest",
  );
  assert.deepEqual(state.brainstorms[0].ideas[0].votes, ["guest"]);
  state = applyMutation(
    state,
    {
      action: "upsert",
      entity: "brainstorms",
      item: {
        id: "ideas",
        ideas: staleBoard.ideas.map((idea) => ({
          ...idea,
          title: "Edited after vote",
        })),
      },
      base: staleBoard,
    },
    now,
  );
  assert.deepEqual(
    state.brainstorms[0].ideas[0].votes,
    ["guest"],
    "Editing idea text must preserve concurrent votes",
  );
  assert.throws(
    () =>
      applyMutation(
        state,
        {
          action: "upsert",
          entity: "brainstorms",
          item: { id: "ideas", ideas: staleBoard.ideas },
          base: staleBoard,
        },
        now,
      ),
    /changed since you opened/,
  );
  invalid("brainstorms", { id: "ideas", groups: [] }, /group is missing/);
  invalid(
    "brainstorms",
    {
      id: "ideas",
      ideas: [{ id: "missing", title: "Missing link", noteId: "private-note" }],
    },
    /missing note/,
  );
  assert.throws(
    () =>
      validateMutation({
        action: "vote-idea",
        id: "ideas",
        ideaId: "idea",
        vote: true,
        actorId: "another-user",
      }),
    /Unrecognized/,
  );
  put("brainstorms", { id: "ideas", votingOpen: false });
  assert.throws(
    () =>
      write(
        { action: "vote-idea", id: "ideas", ideaId: "idea", vote: false },
        "guest",
      ),
    /closed/,
  );
  const exported = JSON.parse(JSON.stringify(state));
  exported.brainstorms[0].ideas[0].votes = ["forged"];
  exported.brainstorms.push({ ...exported.brainstorms[0], id: "fresh-import" });
  write({ action: "import", workspace: exported });
  assert.deepEqual(state.brainstorms[0].ideas[0].votes, ["guest"]);
  assert.deepEqual(state.brainstorms[1].ideas[0].votes, []);
  assert.equal(
    relationshipImpact(state).relationshipIds.size,
    0,
    "Imported relationships review against imported structured data",
  );
  const legacy = createSeedWorkspace();
  delete legacy.noteTypes;
  delete legacy.relationshipPresets;
  delete legacy.brainstorms;
  assert.deepEqual(validateWorkspace(legacy).noteTypes, []);

  // Actual storage, Trash, membership and authenticated identity—not mocked mutations.
  const req = request();
  const read = () => store.readWorkspace(req);
  const legacyStored = JSON.parse(
    sql.prepare("SELECT data FROM workspaces WHERE id = 'main'").get().data,
  );
  delete legacyStored.noteTypes;
  delete legacyStored.relationshipPresets;
  delete legacyStored.brainstorms;
  const legacyJSON = JSON.stringify(legacyStored);
  sql
    .prepare("UPDATE workspaces SET data = ? WHERE id = 'main'")
    .run(legacyJSON);
  assert.deepEqual((await read()).brainstorms, []);
  assert.equal(
    sql.prepare("SELECT data FROM workspaces WHERE id = 'main'").get().data,
    legacyJSON,
    "Reading legacy connected-thinking defaults must not rewrite saved JSON",
  );
  const save = (input) =>
    store.mutateWorkspace(req, { ...input, operationId: crypto.randomUUID() });
  await save({
    action: "import",
    workspace: { ...createSeedWorkspace(), revision: (await read()).revision },
  });
  const upsert = async (entity, item) =>
    save({
      action: "upsert",
      entity,
      item,
      base:
        (await read())[entity]?.find((value) => value.id === item.id) || null,
    });
  const remove = async (entity, id) => {
    const operationId = crypto.randomUUID();
    await store.mutateWorkspace(req, {
      action: "delete",
      entity,
      id,
      base: (await read())[entity]?.find((value) => value.id === id),
      operationId,
    });
    return operationId;
  };
  await upsert("noteTypes", {
    id: "stored-type",
    name: "Stored type",
    fields: [field("scope", "text")],
  });
  await upsert("notes", {
    id: "stored-note",
    title: "Stored note",
    customTypeId: "stored-type",
    propertyValues: { scope: "Preserve me" },
  });
  await upsert("tasks", { id: "stored-task", title: "Stored task" });
  await upsert("brainstorms", {
    id: "stored-board",
    title: "Stored board",
    ideas: [
      {
        id: "stored-idea",
        title: "Stored idea",
        noteId: "stored-note",
        taskId: "stored-task",
      },
    ],
  });
  const deleted = await remove("notes", "stored-note");
  assert.equal((await read()).brainstorms[0].ideas[0].noteId, "");
  await save({ action: "restore", id: deleted });
  assert.equal((await read()).brainstorms[0].ideas[0].noteId, "stored-note");
  const boardDeletion = await remove("brainstorms", "stored-board");
  await remove("tasks", "stored-task");
  const restored = await store.mutateWorkspaceResult(req, {
    action: "restore",
    id: boardDeletion,
    operationId: crypto.randomUUID(),
  });
  assert.equal(restored.workspace.brainstorms[0].ideas[0].taskId, "");
  assert(restored.warnings.some((warning) => warning.includes("tasks")));
  await remove("brainstorms", "stored-board");
  await assert.rejects(
    () =>
      upsert("brainstorms", {
        id: "stored-board",
        title: "Cannot recreate deleted ID",
      }),
    /deleted earlier/,
  );
  const noteDeletion = await remove("notes", "stored-note");
  const typeDeletion = await remove("noteTypes", "stored-type");
  await assert.rejects(
    () => save({ action: "restore", id: noteDeletion }),
    /custom type before restoring/,
  );
  await save({ action: "restore", id: typeDeletion });
  await save({ action: "restore", id: noteDeletion });
  assert.equal((await read()).notes[0].propertyValues.scope, "Preserve me");
  const ownerBackup = await read();
  ownerBackup.people.push({
    id: "account_foreign",
    userId: "foreign",
    name: "Imported owner",
    role: "",
    color: "#8a78fa",
  });
  ownerBackup.notes.push({
    ...ownerBackup.notes[0],
    id: "imported-decision",
    title: "Imported decision",
    kind: "decision",
    customTypeId: "",
    propertyValues: {},
    decision: {
      status: "proposed",
      context: "",
      options: "",
      outcome: "",
      consequences: "",
      decidedOn: "",
      ownerId: "account_foreign",
      supersededById: "",
    },
  });
  await save({ action: "import", workspace: ownerBackup });
  const importedOwners = await read();
  const ownerId = importedOwners.notes.find(
    (note) => note.id === "imported-decision",
  ).decision.ownerId;
  assert(ownerId.startsWith("label_"));
  assert(
    importedOwners.people.some(
      (person) => person.id === ownerId && !person.userId,
    ),
  );

  const ownerReq = request("/api/state", "alice");
  const known = new Set(
    (await access.getAccountContext(ownerReq)).workspaces.map(
      (item) => item.id,
    ),
  );
  const created = await access.teamAction(ownerReq, {
    action: "create",
    name: "Connected thinking access fixture",
  });
  const team = created.workspaces.find((item) => !known.has(item.id));
  const aliceReq = request("/api/state", "alice", team.id);
  const bobReq = request("/api/state", "bob", team.id);
  const teamSave = (client, input) =>
    store.mutateWorkspace(client, {
      ...input,
      operationId: crypto.randomUUID(),
    });
  await teamSave(aliceReq, {
    action: "upsert",
    entity: "brainstorms",
    item: {
      id: "team-board",
      title: "Team board",
      ideas: [{ id: "team-idea", title: "Team idea" }],
    },
    base: null,
  });
  await assert.rejects(
    () => store.readWorkspace(bobReq),
    (error) => error.status === 404,
  );
  await access.teamAction(ownerReq, {
    action: "invite",
    workspaceId: team.id,
    username: "bob",
  });
  await assert.rejects(
    () =>
      teamSave(bobReq, {
        action: "vote-idea",
        id: "team-board",
        ideaId: "team-idea",
        vote: true,
      }),
    (error) => error.status === 404,
  );
  const invitation = (
    await access.getAccountContext(request("/api/account", "bob"))
  ).invitations.find((item) => item.workspaceId === team.id);
  await access.teamAction(request("/api/teams", "bob"), {
    action: "accept",
    invitationId: invitation.id,
  });
  const aliceMutation = {
    action: "vote-idea",
    id: "team-board",
    ideaId: "team-idea",
    vote: true,
    operationId: crypto.randomUUID(),
  };
  await Promise.all([
    store.mutateWorkspace(aliceReq, aliceMutation),
    store.mutateWorkspace(aliceReq, aliceMutation),
    teamSave(bobReq, {
      action: "vote-idea",
      id: "team-board",
      ideaId: "team-idea",
      vote: true,
    }),
  ]);
  const teamState = await store.readWorkspace(aliceReq);
  assert.deepEqual(
    new Set(teamState.brainstorms[0].ideas[0].votes),
    new Set(["account_alice", "account_bob"]),
  );
  assert(
    !(await store.readWorkspace(request("/api/state", "bob"))).brainstorms.some(
      (board) => board.id === "team-board",
    ),
  );
  const prepared = applyMutation(
    teamState,
    { action: "vote-idea", id: "team-board", ideaId: "team-idea", vote: false },
    now,
    "account_bob",
  );
  const resolved = await access.resolveWorkspace(bobReq);
  await access.teamAction(ownerReq, {
    action: "remove",
    workspaceId: team.id,
    userId: "bob",
  });
  assert.equal(
    await journal.commitWorkspace(
      resolved,
      teamState,
      prepared,
      crypto.randomUUID(),
      "revoked-vote",
    ),
    false,
  );
  await assert.rejects(
    () =>
      teamSave(bobReq, {
        action: "vote-idea",
        id: "team-board",
        ideaId: "team-idea",
        vote: false,
      }),
    (error) => error.status === 404,
  );
  const stored = JSON.parse(
    sql.prepare("SELECT data FROM workspaces WHERE id = ?").get(team.id).data,
  );
  assert(
    stored.brainstorms[0].ideas[0].votes.includes("account_bob"),
    "Revoked member cannot commit a prepared vote",
  );
  console.log(
    "PASS: custom note schema validation/archive, decision records/replacements, structured change impacts, honest import voting, concurrent vote identity, brainstorm link/Trash recovery, team membership and revoked writes.",
  );
};
