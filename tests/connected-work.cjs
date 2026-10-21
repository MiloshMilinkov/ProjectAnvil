const assert = require("node:assert/strict");
const { createSeedWorkspace } = require("./compiled/app/lib/seed");
const {
  applyMutation: guardedMutation,
  validateWorkspace,
} = require("./compiled/app/lib/workspace-model");
const applyMutation = (state, mutation) =>
  guardedMutation(
    state,
    ["upsert", "delete"].includes(mutation.action) &&
      !Object.hasOwn(mutation, "base")
      ? {
          ...mutation,
          base:
            state[mutation.entity].find(
              (item) => item.id === (mutation.item?.id || mutation.id),
            ) || null,
        }
      : mutation,
  );
const {
  entitySignature,
  relationshipImpact,
} = require("./compiled/app/lib/relationships");

function checkModel() {
  let state = createSeedWorkspace();
  const mutate = (mutation) => {
    state = applyMutation(state, mutation);
    return state;
  };
  const add = (entity, item) => mutate({ action: "upsert", entity, item });
  const legacy = { ...state };
  delete legacy.relationships;
  assert.deepEqual(validateWorkspace(legacy).relationships, []);
  assert.deepEqual(
    applyMutation(state, { action: "import", workspace: legacy }).relationships,
    [],
  );

  add("notes", {
    id: "source",
    title: "Project requirement",
    content: "The plan must include an accessibility review.",
  });
  add("tasks", {
    id: "first",
    title: "Review accessibility",
    source: { noteId: "source", excerpt: "accessibility review" },
  });
  assert.deepEqual(state.tasks[0].noteIds, ["source"]);
  assert.equal(state.tasks[0].key, "TASK-1");
  assert.equal(
    state.relationships.length,
    1,
    "A source task gets a meaningful relationship automatically",
  );
  const connection = state.relationships[0];
  assert.deepEqual(connection.from, { type: "task", id: "first" });
  assert.deepEqual(connection.to, { type: "note", id: "source" });
  assert.equal(relationshipImpact(state).affected.size, 0);
  assert.throws(
    () =>
      add("tasks", {
        id: "duplicate",
        title: "Duplicate source",
        source: { noteId: "source", excerpt: "accessibility review" },
      }),
    (error) => error.status === 409,
  );
  assert.throws(
    () =>
      add("tasks", {
        id: "missing-source",
        title: "Missing source",
        source: { noteId: "another-workspace", excerpt: "hidden note" },
      }),
    /missing note/,
  );

  add("tasks", {
    id: "second",
    title: "Publish the plan",
    blockedBy: ["first"],
  });
  const previousNoteSignature = entitySignature(state, {
    type: "note",
    id: "source",
  });
  add("notes", {
    id: "source",
    content: "The plan must include two independent accessibility reviews.",
  });
  let impact = relationshipImpact(state);
  assert(impact.changed.has("note:source"));
  assert(impact.direct.has("task:first"));
  assert(
    impact.affected.has("task:second"),
    "Existing task dependencies propagate upstream note changes",
  );
  assert.deepEqual([...impact.relationshipIds], [connection.id]);
  assert.throws(
    () =>
      mutate({
        action: "review-relationship",
        id: connection.id,
        expectedToSignature: previousNoteSignature,
      }),
    (error) => error.status === 409,
  );
  add("relationships", {
    id: connection.id,
    label: "Updated label",
    toSignature: entitySignature(state, connection.to),
    reviewedAt: new Date().toISOString(),
  });
  assert(
    relationshipImpact(state).relationshipIds.has(connection.id),
    "Ordinary edits cannot forge review baselines",
  );
  mutate({
    action: "review-relationship",
    id: connection.id,
    expectedToSignature: entitySignature(state, connection.to),
    expectedFromSignature: entitySignature(state, connection.from),
  });
  assert.equal(relationshipImpact(state).affected.size, 0);
  assert.equal(relationshipImpact(state).relationshipIds.size, 0);
  add("tasks", {
    id: "third",
    title: "Separate review",
    source: { noteId: "source", excerpt: "independent accessibility reviews" },
  });
  add("notes", {
    id: "source",
    content: "The plan now needs an external review too.",
  });
  mutate({ action: "review-relationship", id: connection.id });
  const remainingImpact = relationshipImpact(state);
  assert(
    !remainingImpact.affected.has("task:first"),
    "Reviewing one source relationship clears that branch while another remains pending",
  );
  assert(!remainingImpact.affected.has("task:second"));
  assert(remainingImpact.affected.has("task:third"));
  for (const relationship of state.relationships)
    mutate({ action: "review-relationship", id: relationship.id });
  add("tasks", { id: "first", status: "done" });
  assert.equal(
    relationshipImpact(state).relationshipIds.size,
    0,
    "Changing a dependent task does not flag its source note",
  );
  assert.equal(
    state.relationships.length,
    2,
    "Saving a task does not recreate its source relationship",
  );
  mutate({ action: "delete", entity: "relationships", id: connection.id });
  add("tasks", { id: "first", priority: "high" });
  assert.equal(
    state.relationships.length,
    1,
    "A deliberately removed source relationship stays removed",
  );
  mutate({ action: "delete", entity: "tasks", id: "third" });

  add("notes", {
    id: "other",
    title: "Decision",
    content: "An alternate approach.",
  });
  add("relationships", {
    id: "supports",
    from: { type: "note", id: "source" },
    to: { type: "note", id: "other" },
    kind: "supports",
  });
  add("relationships", {
    id: "contradicts",
    from: { type: "note", id: "other" },
    to: { type: "task", id: "second" },
    kind: "contradicts",
  });
  assert.throws(
    () =>
      add("relationships", {
        id: "duplicate-relation",
        from: { type: "task", id: "second" },
        to: { type: "note", id: "other" },
        kind: "contradicts",
      }),
    /already exists/,
  );
  assert.throws(
    () =>
      add("relationships", {
        id: "self",
        from: { type: "note", id: "other" },
        to: { type: "note", id: "other" },
        kind: "supports",
      }),
    /different items/,
  );
  assert.throws(
    () =>
      add("relationships", {
        id: "outside",
        from: { type: "note", id: "other" },
        to: { type: "note", id: "private-outside" },
        kind: "supports",
      }),
    /missing note/,
  );
  add("notes", { id: "source", bookmarked: true, folder: "Archive" });
  assert.equal(
    relationshipImpact(state).affected.size,
    0,
    "Organizing a note does not create a content-change warning",
  );
  add("notes", {
    id: "source",
    content: "The review is optional for the prototype.",
  });
  impact = relationshipImpact(state);
  assert(impact.direct.has("note:other"));
  assert(impact.affected.has("task:second"));
  assert(impact.relationshipIds.has("supports"));
  assert(
    !impact.relationshipIds.has("contradicts"),
    "Indirect unchanged relationships need no separate acknowledgment",
  );
  const imported = applyMutation(state, { action: "import", workspace: state });
  assert.equal(
    relationshipImpact(imported).affected.size,
    0,
    "An explicit import establishes new reviewed baselines",
  );

  add("relationships", {
    id: "cycle",
    from: { type: "task", id: "second" },
    to: { type: "note", id: "source" },
    kind: "supports",
  });
  assert.doesNotThrow(
    () => relationshipImpact(state),
    "Semantic relationship cycles terminate safely",
  );
  const deleted = mutate({ action: "delete", entity: "notes", id: "source" });
  assert.equal(deleted.tasks[0].source, undefined);
  assert(!deleted.tasks[0].noteIds.includes("source"));
  assert(
    !deleted.relationships.some(
      (item) => item.from.id === "source" || item.to.id === "source",
    ),
  );
}

async function checkRooms({ store, access, request }) {
  const route = require("./compiled/app/api/rooms/route");
  const req = (user = "", workspace = "", options = {}) =>
    request("/api/rooms", user, workspace, options);
  const post = (user, workspace, body, headers = {}) =>
    route.POST(
      req(user, workspace, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );
  const rooms = async (user, workspace = "") => {
    const response = await route.GET(req(user, workspace));
    assert.equal(response.status, 200);
    return (await response.json()).rooms;
  };
  await access.teamAction(request("/api/teams", "alice"), {
    action: "create",
    name: "Work room test team",
  });
  const team = (
    await access.getAccountContext(request("/api/account", "alice"))
  ).workspaces.find((item) => item.name === "Work room test team");
  await access.teamAction(request("/api/teams", "alice"), {
    action: "invite",
    workspaceId: team.id,
    username: "bob",
  });
  const invitation = (
    await access.getAccountContext(request("/api/account", "bob"))
  ).invitations.find((item) => item.workspaceId === team.id);
  await access.teamAction(request("/api/teams", "bob"), {
    action: "accept",
    invitationId: invitation.id,
  });
  await store.mutateWorkspace(request("/api/state", "alice", team.id), {
    action: "upsert",
    entity: "notes",
    item: { id: "room-note", title: "Room reference", content: "Team context" },
  });
  await store.mutateWorkspace(request("/api/state", "alice", team.id), {
    action: "upsert",
    entity: "canvases",
    item: { id: "room-canvas", title: "Room canvas" },
  });
  const room = {
    id: "same-id",
    name: "Alice checkpoint",
    projectId: "",
    taskId: "",
    noteIds: ["room-note"],
    canvasId: "room-canvas",
    revision: 0,
    location: {
      page: "canvas",
      projectFilter: "",
      noteId: "room-note",
      canvasId: "room-canvas",
      canvasViewport: { x: 120, y: -50, zoom: 1.25 },
    },
    checkpoint: {
      summary: "Reviewed references",
      nextStep: "Draft the next section",
      question: "Which option?",
      savedAt: "",
    },
  };
  assert.equal(
    (await post("alice", team.id, { action: "upsert", room })).status,
    200,
  );
  const [saved] = await rooms("alice", team.id);
  assert.equal(saved.revision, 1);
  assert(saved.checkpoint.savedAt);
  assert.deepEqual(saved.location.canvasViewport, room.location.canvasViewport);
  assert.deepEqual(
    await rooms("bob", team.id),
    [],
    "Team membership does not expose another person’s work rooms",
  );
  assert.equal(
    (await post("bob", team.id, { action: "delete", id: room.id })).status,
    404,
  );
  assert.equal(
    (
      await post("bob", team.id, {
        action: "upsert",
        room: { ...room, name: "Bob checkpoint" },
      })
    ).status,
    200,
  );
  assert.equal((await rooms("alice", team.id))[0].name, "Alice checkpoint");
  assert.equal((await rooms("bob", team.id))[0].name, "Bob checkpoint");
  assert.deepEqual(
    await rooms("alice"),
    [],
    "A work room is also isolated from the same user’s other workspaces",
  );
  assert.equal((await route.GET(req("charlie", team.id))).status, 404);
  assert.equal((await route.GET(req("", team.id))).status, 401);
  assert.equal(
    (
      await post("alice", team.id, {
        action: "upsert",
        room: { id: room.id, name: "Stale" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post("alice", team.id, {
        action: "upsert",
        room: { id: room.id, revision: saved.revision, name: "Resuming" },
      })
    ).status,
    200,
  );
  const [updated] = await rooms("alice", team.id);
  assert.equal(
    updated.checkpoint.nextStep,
    room.checkpoint.nextStep,
    "Partial metadata saves preserve the checkpoint",
  );
  assert.equal(updated.location.canvasViewport.zoom, 1.25);
  assert.equal(
    (
      await post("alice", team.id, {
        action: "upsert",
        room: { ...room, revision: saved.revision, name: "Old overwrite" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post("alice", team.id, {
        action: "upsert",
        room: { id: "bad-ref", name: "Outside", noteIds: ["bob-private"] },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post("alice", team.id, {
        action: "upsert",
        room: { id: "forged-owner", name: "Forged", owner: "bob" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(
        "alice",
        team.id,
        { action: "delete", id: room.id },
        { origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        "alice",
        team.id,
        { action: "delete", id: room.id },
        { "x-account-id": "bob" },
      )
    ).status,
    409,
  );
  await store.mutateWorkspace(request("/api/state", "alice", team.id), {
    action: "delete",
    entity: "notes",
    id: "room-note",
  });
  await store.mutateWorkspace(request("/api/state", "alice", team.id), {
    action: "delete",
    entity: "canvases",
    id: "room-canvas",
  });
  const [pruned] = await rooms("alice", team.id);
  assert.deepEqual(pruned.noteIds, []);
  assert.equal(pruned.location.noteId, "");
  assert.equal(pruned.location.canvasId, "");
  assert.equal(pruned.location.canvasViewport, undefined);
  assert.equal(
    pruned.checkpoint.nextStep,
    room.checkpoint.nextStep,
    "Deleting a pin never loses the written checkpoint",
  );
  await access.teamAction(request("/api/teams", "alice"), {
    action: "remove",
    workspaceId: team.id,
    userId: "bob",
  });
  assert.equal((await route.GET(req("bob", team.id))).status, 404);
  assert.equal(
    (await post("bob", team.id, { action: "delete", id: room.id })).status,
    404,
  );
  assert.equal(
    (await post("alice", team.id, { action: "delete", id: room.id })).status,
    200,
  );
  assert.deepEqual(await rooms("alice", team.id), []);

  assert.equal(
    (
      await post("", "", {
        action: "upsert",
        room: { id: "guest-room", name: "Guest checkpoint" },
      })
    ).status,
    200,
  );
  assert.equal((await rooms(""))[0].name, "Guest checkpoint");
  assert.deepEqual(await rooms("alice"), []);
  console.log(
    "PASS: linked task sources, automatic relationships, directional and transitive impacts, guarded review, legacy imports, private work rooms, checkpoints, viewport restore, stale writes, deleted pins and membership revocation.",
  );
}

module.exports = async (context) => {
  checkModel();
  await checkRooms(context);
};
