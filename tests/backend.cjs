const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const { createSeedWorkspace } = require("./compiled/app/lib/seed");
const {
  applyMutation: applyGuardedMutation,
  validateWorkspace,
} = require("./compiled/app/lib/workspace-model");
const { entitySignature } = require("./compiled/app/lib/relationships");

function mutationBase(state, mutation) {
  if (mutation.action === "rename" && !Object.hasOwn(mutation, "base"))
    return { ...mutation, base: { name: state.name } };
  if (
    !["upsert", "delete"].includes(mutation.action) ||
    Object.hasOwn(mutation, "base")
  )
    return mutation;
  const itemId = mutation.action === "upsert" ? mutation.item.id : mutation.id;
  return {
    ...mutation,
    base: state[mutation.entity].find((item) => item.id === itemId) || null,
  };
}
const applyMutation = (state, mutation, now) =>
  applyGuardedMutation(state, mutationBase(state, mutation), now);

const now = "2026-10-19T12:00:00Z";
const collections = [
  "people",
  "projects",
  "tasks",
  "notes",
  "media",
  "canvases",
  "savedViews",
  "relationships",
];

// Explicit test data belongs here rather than in a new user's workspace.
function fixtureWorkspace() {
  let state = createSeedWorkspace();
  const add = (entity, item) => {
    state = applyMutation(state, { action: "upsert", entity, item }, now);
  };
  add("people", {
    id: "person-alex",
    name: "Test director",
    role: "",
    color: "#8a78fa",
  });
  add("people", {
    id: "person-jamie",
    name: "Test engineer",
    role: "",
    color: "#54b5cc",
  });
  add("projects", { id: "test-project", name: "Test project", key: "TST" });
  add("notes", {
    id: "note-vision",
    title: "Test vision",
    content: "# Test vision",
    projectId: "test-project",
  });
  add("notes", {
    id: "note-city",
    title: "Test place",
    content: "# Test place",
    projectId: "test-project",
  });
  add("tasks", {
    id: "task-1",
    title: "Test interaction",
    key: "TST-1",
    priority: "high",
    projectId: "test-project",
    assigneeId: "person-jamie",
    noteIds: ["note-city"],
    comments: [
      {
        id: "comment-1",
        personId: "person-alex",
        body: "Test comment",
        createdAt: now,
      },
    ],
  });
  add("tasks", {
    id: "task-2",
    title: "Test environment",
    key: "TST-2",
    projectId: "test-project",
  });
  add("tasks", {
    id: "task-7",
    title: "Test playtest",
    key: "TST-7",
    projectId: "test-project",
    blockedBy: ["task-1"],
  });
  add("canvases", {
    id: "canvas-world",
    title: "Test canvas",
    cards: [
      {
        id: "card-vision",
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        type: "note",
        entityId: "note-vision",
        text: "",
        color: "#8a78fa",
      },
      {
        id: "card-city",
        x: 240,
        y: 0,
        width: 200,
        height: 100,
        type: "note",
        entityId: "note-city",
        text: "",
        color: "#54b5cc",
      },
    ],
    edges: [
      {
        id: "test-edge",
        from: "card-vision",
        to: "card-city",
        label: "Test connection",
      },
    ],
  });
  return { ...state, revision: 0 };
}

function checkSchedulingModel() {
  let state = applyMutation(
    createSeedWorkspace(),
    {
      action: "upsert",
      entity: "tasks",
      item: { id: "schedule-task", title: "Scheduled work" },
    },
    now,
  );
  const update = (item) => {
    state = applyMutation(
      state,
      {
        action: "upsert",
        entity: "tasks",
        item: { id: "schedule-task", ...item },
      },
      now,
    );
    return state.tasks[0];
  };
  assert.equal(state.tasks[0].startDate, "");
  update({ startDate: "2026-10-20" });
  assert.equal(state.tasks[0].dueDate, "", "A planned start can stand alone");
  update({ dueDate: "2026-10-25" });
  assert.equal(
    update({ startDate: "2026-10-25" }).startDate,
    "2026-10-25",
    "Same-day tasks are valid",
  );
  assert.throws(
    () => update({ startDate: "2026-10-26" }),
    /on or before the due date/,
  );
  assert.throws(() => update({ startDate: "2026-02-30" }), /valid date/);
  assert.throws(() => update({ startDate: "tomorrow" }), /startDate/);
  assert.equal(
    update({ startDate: "" }).dueDate,
    "2026-10-25",
    "A due date can stand alone",
  );
  assert.equal(
    update({ dueDate: "" }).startDate,
    "",
    "Both schedule fields can be cleared",
  );

  const reference = { type: "task", id: "schedule-task" };
  const emptySignature = entitySignature(state, reference);
  const oldWorkspace = structuredClone(state);
  delete oldWorkspace.tasks[0].startDate;
  assert.equal(
    entitySignature(oldWorkspace, reference),
    emptySignature,
    "Introducing an empty start date must not mark legacy relationships changed",
  );
  const normalized = validateWorkspace(oldWorkspace);
  assert.equal(normalized.tasks[0].startDate, "");
  assert.equal(
    oldWorkspace.tasks[0].startDate,
    undefined,
    "Legacy normalization does not mutate supplied records",
  );
  const imported = applyMutation(state, {
    action: "import",
    workspace: oldWorkspace,
  });
  assert.equal(imported.tasks[0].startDate, "");
  const scheduleSignature = entitySignature(
    { ...state, tasks: [{ ...state.tasks[0], startDate: "2026-10-20" }] },
    reference,
  );
  assert.notEqual(
    scheduleSignature,
    emptySignature,
    "Actual scheduling changes affect relationship review",
  );

  update({ startDate: "2026-10-20", dueDate: "2026-10-25" });
  const base = structuredClone(state.tasks[0]);
  const revisedDue = applyMutation(
    state,
    {
      action: "upsert",
      entity: "tasks",
      item: { id: base.id, dueDate: "2026-10-22" },
      base,
    },
    now,
  );
  assert.throws(
    () =>
      applyGuardedMutation(
        revisedDue,
        {
          action: "upsert",
          entity: "tasks",
          item: { id: base.id, startDate: "2026-10-24" },
          base,
        },
        now,
      ),
    (error) => error.status === 409 && /schedule changed/.test(error.message),
    "Independent edits cannot merge into an inverted schedule",
  );
  const revisedStart = applyMutation(
    state,
    {
      action: "upsert",
      entity: "tasks",
      item: { id: base.id, startDate: "2026-10-24" },
      base,
    },
    now,
  );
  assert.throws(
    () =>
      applyGuardedMutation(
        revisedStart,
        {
          action: "upsert",
          entity: "tasks",
          item: { id: base.id, dueDate: "2026-10-22" },
          base,
        },
        now,
      ),
    (error) => error.status === 409 && /schedule changed/.test(error.message),
  );
  const compatible = applyGuardedMutation(
    revisedDue,
    {
      action: "upsert",
      entity: "tasks",
      item: { id: base.id, startDate: "2026-10-21" },
      base,
    },
    now,
  );
  assert.equal(compatible.tasks[0].startDate, "2026-10-21");
  assert.equal(compatible.tasks[0].dueDate, "2026-10-22");

  const defaultedTask = validateWorkspace(oldWorkspace).tasks[0];
  const deletedLegacyTask = applyGuardedMutation(
    { ...oldWorkspace, tasks: [defaultedTask] },
    {
      action: "delete",
      entity: "tasks",
      id: defaultedTask.id,
      base: oldWorkspace.tasks[0],
    },
    now,
  );
  assert.equal(
    deletedLegacyTask.tasks.length,
    0,
    "An old empty baseline can still delete an unchanged normalized task",
  );

  state = applyMutation(
    state,
    {
      action: "upsert",
      entity: "savedViews",
      item: {
        id: "schedule-view",
        name: "Due soon",
        dateFilter: "due-next-7-days",
        sort: "due-date",
      },
    },
    now,
  );
  assert.equal(state.savedViews[0].dateFilter, "due-next-7-days");
  assert.equal(state.savedViews[0].sort, "due-date");
  const legacyViews = structuredClone(state);
  delete legacyViews.savedViews[0].dateFilter;
  delete legacyViews.savedViews[0].sort;
  const normalizedViews = validateWorkspace(legacyViews);
  assert.equal(normalizedViews.savedViews[0].dateFilter, "all");
  assert.equal(normalizedViews.savedViews[0].sort, "priority");
  assert.equal(
    applyMutation(state, { action: "import", workspace: legacyViews })
      .savedViews[0].sort,
    "priority",
  );
  const deletedLegacyView = applyGuardedMutation(
    normalizedViews,
    {
      action: "delete",
      entity: "savedViews",
      id: "schedule-view",
      base: legacyViews.savedViews[0],
    },
    now,
  );
  assert.equal(deletedLegacyView.savedViews.length, 0);
  for (const item of [{ dateFilter: "invalid" }, { sort: "invalid" }])
    assert.throws(
      () =>
        applyMutation(state, {
          action: "upsert",
          entity: "savedViews",
          item: { id: "schedule-view", ...item },
        }),
      /dateFilter|sort/,
    );
}

/** Exercise injection payloads through real SQLite stores and HTTP handlers. */
async function checkSqlInjectionBoundaries({ sql, DB, store, users, request }) {
  const owner = {
    id: "sql-audit-owner",
    username: "sql_audit_owner",
    email: "sql-owner@example.test",
    name: "SQL audit owner",
  };
  const reader = {
    id: "sql-audit-reader",
    username: "sql_audit_reader",
    email: "sql-reader@example.test",
    name: "SQL audit reader",
  };
  for (const user of [owner, reader]) {
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
  const access = require("./compiled/app/lib/access-store");
  const stateRoute = require("./compiled/app/api/state/route");
  const teamRoute = require("./compiled/app/api/teams/route");
  const activityRoute = require("./compiled/app/api/activity/route");
  const historyRoute = require("./compiled/app/api/history/route");
  const trashRoute = require("./compiled/app/api/trash/route");
  const templateRoute = require("./compiled/app/api/templates/route");
  const roomsRoute = require("./compiled/app/api/rooms/route");
  const watchRoute = require("./compiled/app/api/watch/route");
  const personal = await access.resolveWorkspace(
    request("/api/state", owner.id),
  );
  const peer = await access.resolveWorkspace(request("/api/state", reader.id));
  const ownRequest = (route, options = {}) =>
    request(route, owner.id, personal.id, options);
  const post = (route, input) =>
    ownRequest(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  const payloads = [
    "SQL_AUDIT_0' OR 1=1 --",
    "SQL_AUDIT_1'); DROP TABLE workspaces; --",
    'SQL_AUDIT_2" UNION SELECT email FROM user --',
    "SQL_AUDIT_3'; UPDATE appmembers SET role='owner'; --",
    "SQL_AUDIT_4%_[]' /* comment */; SELECT 1; --",
    "SQL_AUDIT_5 – Unicode 'quoted' text; --",
  ];
  const schema = () =>
    sql
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all();
  const tablesBefore = schema();
  const queries = [],
    bindings = [];
  const originalPrepare = DB.prepare;
  DB.prepare = function (query) {
    queries.push(query);
    const wrap = (statement) => ({
      ...statement,
      bind(...values) {
        bindings.push(...values);
        return wrap(statement.bind(...values));
      },
    });
    return wrap(originalPrepare.call(this, query));
  };
  try {
    for (const [index, literal] of payloads.entries()) {
      await store.mutateWorkspace(ownRequest("/api/state"), {
        action: "upsert",
        entity: "notes",
        item: {
          id: `sql-note-${index}`,
          title: literal,
          content: literal,
          properties: { "quote'key": literal },
        },
      });
      await store.mutateWorkspace(ownRequest("/api/state"), {
        action: "upsert",
        entity: "tasks",
        item: { id: `sql-task-${index}`, title: literal, description: literal },
      });
      const template = await templateRoute.POST(
        post("/api/templates", {
          action: "save",
          base: null,
          template: {
            id: `sql-template-${index}`,
            name: literal,
            kind: "note",
            content: {
              title: literal,
              content: literal,
              kind: "note",
              folder: "",
              tags: [],
              properties: { "quote'key": literal },
            },
          },
        }),
      );
      assert.equal(template.status, 200);
      assert.equal(
        (await template.json()).templates.find(
          (item) => item.id === `sql-template-${index}`,
        ).content.content,
        literal,
      );
      const room = await roomsRoute.POST(
        post("/api/rooms", {
          action: "upsert",
          room: {
            id: `sql-room-${index}`,
            name: literal,
            checkpoint: {
              summary: literal,
              nextStep: literal,
              question: literal,
            },
          },
        }),
      );
      assert.equal(room.status, 200);
      assert.equal(
        (await room.json()).rooms.find(
          (item) => item.id === `sql-room-${index}`,
        ).checkpoint.summary,
        literal,
      );
    }
    await access.teamAction(request("/api/teams", owner.id), {
      action: "create",
      name: payloads[1],
    });
    assert.equal(
      (
        await access.getAccountContext(request("/api/account", owner.id))
      ).workspaces.find((item) => item.kind === "team").name,
      payloads[1],
    );
    const saved = await store.readWorkspace(ownRequest("/api/state"));
    for (const [index, literal] of payloads.entries()) {
      assert.equal(
        saved.notes.find((item) => item.id === `sql-note-${index}`).content,
        literal,
      );
      assert.equal(
        saved.tasks.find((item) => item.id === `sql-task-${index}`).description,
        literal,
      );
      assert.equal(
        saved.notes.find((item) => item.id === `sql-note-${index}`).properties[
          "quote'key"
        ],
        literal,
      );
    }
    const peerBefore = sql
      .prepare("SELECT data,revision FROM workspaces WHERE id=?")
      .get(peer.id);
    const memberships = () =>
      sql
        .prepare(
          "SELECT workspace_id,user_id,role FROM appmembers ORDER BY workspace_id,user_id",
        )
        .all();
    const membershipsBefore = memberships();
    for (const literal of payloads) {
      const encoded = encodeURIComponent(literal);
      const invalidLookups = [
        [stateRoute, request(`/api/state?workspace=${encoded}`, owner.id), 400],
        [teamRoute, ownRequest(`/api/teams?workspaceId=${encoded}`), 400],
        [activityRoute, ownRequest(`/api/activity?cursor=${encoded}`), 400],
        [activityRoute, ownRequest(`/api/activity?limit=${encoded}`), 400],
        [
          historyRoute,
          ownRequest(`/api/history?note=sql-note-0&cursor=${encoded}`),
          400,
        ],
        [trashRoute, ownRequest(`/api/trash?cursor=${encoded}`), 400],
        [trashRoute, ownRequest(`/api/trash?limit=${encoded}`), 400],
        [stateRoute, request("/api/state", reader.id, personal.id), 404],
      ];
      for (const [route, input, status] of invalidLookups) {
        const response = await route.GET(input);
        assert.equal(
          response.status,
          status,
          `Hostile lookup must be rejected: ${input.url}`,
        );
        assert.doesNotMatch(
          await response.text(),
          /SQLITE_|syntax error|no such table|SQL_AUDIT_/i,
        );
      }
      // This trusted-recipient helper accepts an arbitrary lookup value. Its
      // SQL must remain safe independently of HTTP identifier validation.
      await assert.rejects(
        () => access.resolveWorkspaceForUser(owner, literal),
        (error) => error.status === 404,
      );
      const rejectedWrites = [
        [
          stateRoute,
          "/api/state",
          {
            action: "upsert",
            entity: literal,
            item: { id: "sql-note-0" },
            base: null,
          },
        ],
        [
          stateRoute,
          "/api/state",
          { action: "delete", entity: "notes", id: literal, base: null },
        ],
        [
          stateRoute,
          "/api/state",
          {
            action: "rename",
            name: "Uncommitted",
            base: { name: saved.name },
            operationId: literal,
          },
        ],
        [
          teamRoute,
          "/api/teams",
          { action: "invite", workspaceId: personal.id, username: literal },
        ],
        [
          watchRoute,
          "/api/watch",
          { type: "note", id: literal, watching: true },
        ],
      ];
      for (const [route, url, input] of rejectedWrites) {
        const response = await route.POST(post(url, input));
        assert.equal(response.status, 400);
      }
    }
    assert.deepEqual(
      schema(),
      tablesBefore,
      "Injected text must not change the database schema",
    );
    assert.deepEqual(
      memberships(),
      membershipsBefore,
      "Injected identifiers must not elevate membership roles",
    );
    assert.deepEqual(
      sql
        .prepare("SELECT data,revision FROM workspaces WHERE id=?")
        .get(peer.id),
      peerBefore,
    );
    assert.equal(
      (await store.readWorkspace(request("/api/state", reader.id))).notes
        .length,
      0,
    );
    for (let index = 0; index < payloads.length; index++) {
      const marker = `SQL_AUDIT_${index}`;
      assert(
        queries.every((query) => !query.includes(marker)),
        "User text must never become executable SQL",
      );
      assert(
        bindings.some(
          (value) => typeof value === "string" && value.includes(marker),
        ),
        "Allowed SQL-like content must be passed as bound data",
      );
    }
  } finally {
    DB.prepare = originalPrepare;
  }
  console.log(
    "PASS: real-SQL injection payloads stay literal across tasks, notes, properties, templates, rooms, and team names; hostile IDs/cursors/limits/actions are rejected without schema changes, membership escalation, or cross-account disclosure.",
  );
}

async function main() {
  checkSchedulingModel();
  const empty = createSeedWorkspace();
  assert.equal(empty.name, "My workspace");
  assert.equal(empty.revision, 0);
  for (const key of collections)
    assert.deepEqual(empty[key], [], `New workspace must not contain ${key}`);
  validateWorkspace(empty);
  let guest = applyMutation(empty, {
    action: "upsert",
    entity: "tasks",
    item: { id: "first-task", title: "First task" },
  });
  assert.equal(guest.tasks[0].projectId, "");
  assert.equal(guest.tasks[0].assigneeId, "");
  assert.equal(guest.tasks[0].key, "TASK-1");
  guest = applyMutation(guest, {
    action: "upsert",
    entity: "tasks",
    item: {
      id: "first-task",
      comments: [
        {
          id: "guest-comment",
          personId: "",
          body: "Created as a guest",
          createdAt: now,
        },
      ],
    },
  });
  guest = applyMutation(guest, {
    action: "upsert",
    entity: "notes",
    item: {
      id: "first-note",
      title: "First note",
      content: "A guest can write without creating a project.",
    },
  });
  guest = applyMutation(guest, {
    action: "upsert",
    entity: "canvases",
    item: {
      id: "first-canvas",
      title: "First canvas",
      cards: [
        {
          id: "guest-note-card",
          x: 0,
          y: 0,
          width: 200,
          height: 100,
          type: "note",
          entityId: "first-note",
          text: "",
          color: "#8a78fa",
        },
        {
          id: "guest-task-card",
          x: 240,
          y: 0,
          width: 200,
          height: 100,
          type: "task",
          entityId: "first-task",
          text: "",
          color: "#54b5cc",
        },
      ],
      edges: [
        {
          id: "guest-edge",
          from: "guest-note-card",
          to: "guest-task-card",
          label: "Plan",
        },
      ],
    },
  });
  assert.equal(guest.people.length, 0);
  assert.equal(guest.projects.length, 0);
  assert.equal(guest.notes[0].projectId, "");
  assert.equal(guest.tasks[0].comments[0].personId, "");
  assert.equal(guest.canvases[0].cards.length, 2);
  const guestImport = applyMutation(guest, {
    action: "import",
    workspace: JSON.parse(JSON.stringify(guest)),
  });
  assert.equal(guestImport.tasks[0].comments[0].body, "Created as a guest");
  assert.equal(guestImport.people.length, 0);

  const seed = fixtureWorkspace();
  const updated = applyMutation(seed, {
    action: "upsert",
    entity: "tasks",
    item: { id: "task-1", priority: "urgent" },
  });
  assert.equal(updated.tasks[0].title, seed.tasks[0].title);
  assert.equal(updated.tasks[0].priority, "urgent");
  assert.equal(
    seed.tasks[0].priority,
    "high",
    "Mutations must not alter their input",
  );
  assert.equal(updated.revision, 1);
  assert.throws(
    () =>
      applyMutation(seed, {
        action: "upsert",
        entity: "tasks",
        item: { id: "task-1", assigneeId: "missing" },
      }),
    /missing person/,
  );
  assert.throws(
    () =>
      applyMutation(seed, {
        action: "upsert",
        entity: "tasks",
        item: {
          id: "task-1",
          comments: [
            {
              id: "missing-author",
              personId: "missing",
              body: "Bad reference",
              createdAt: now,
            },
          ],
        },
      }),
    /missing person/,
  );
  assert.throws(
    () =>
      applyMutation(seed, {
        action: "upsert",
        entity: "tasks",
        item: { id: "task-1", blockedBy: ["task-7"] },
      }),
    /cycle/,
  );
  assert.throws(
    () =>
      applyMutation(seed, {
        action: "upsert",
        entity: "tasks",
        item: { id: "task-1", status: "invalid" },
      }),
    /status/,
  );
  assert.throws(
    () =>
      applyMutation(seed, {
        action: "upsert",
        entity: "tasks",
        item: { id: "task-1", dueDate: "2026-02-31" },
      }),
    /valid date/,
  );
  assert.throws(
    () =>
      applyMutation(seed, {
        action: "delete",
        entity: "projects",
        id: "test-project",
      }),
    /Move or delete/,
  );
  assert.throws(
    () =>
      applyMutation(seed, {
        action: "import",
        workspace: { ...seed, revision: 7 },
      }),
    /changed/,
  );
  const note = applyMutation(seed, {
    action: "upsert",
    entity: "notes",
    item: { id: "note-vision", content: "# New content" },
  });
  assert.equal(note.notes[0].snapshots[0].content, seed.notes[0].content);
  assert.equal(note.notes[0].snapshots.length, 1);
  const retainedHistory = applyMutation(note, {
    action: "upsert",
    entity: "notes",
    item: {
      id: "note-vision",
      title: "New title",
      snapshots: Array.from({ length: 30 }, (_, i) => ({
        id: `stale-${i}`,
        content: "stale",
        savedAt: now,
      })),
    },
  });
  assert.equal(retainedHistory.notes[0].snapshots.length, 1);
  assert.equal(
    retainedHistory.notes[0].snapshots[0].content,
    seed.notes[0].content,
  );
  const quickEdit = applyMutation(note, {
    action: "upsert",
    entity: "notes",
    item: { id: "note-vision", content: "A quick next sentence" },
  });
  assert.equal(quickEdit.notes[0].snapshots.length, 1);
  const restored = applyMutation(quickEdit, {
    action: "upsert",
    entity: "notes",
    item: { id: "note-vision", content: seed.notes[0].content },
  });
  assert.equal(
    restored.notes[0].snapshots.at(-1).content,
    "A quick next sentence",
  );
  const deletedNote = applyMutation(seed, {
    action: "delete",
    entity: "notes",
    id: "note-city",
  });
  assert.equal(
    deletedNote.canvases[0].cards.some((card) => card.entityId === "note-city"),
    false,
  );
  assert.equal(
    deletedNote.canvases[0].edges.some(
      (edge) => edge.from === "card-city" || edge.to === "card-city",
    ),
    false,
  );
  assert.equal(
    deletedNote.tasks.some((task) => task.noteIds.includes("note-city")),
    false,
  );
  const deletedPerson = applyMutation(seed, {
    action: "delete",
    entity: "people",
    id: "person-jamie",
  });
  assert.equal(
    deletedPerson.tasks.some((task) => task.assigneeId === "person-jamie"),
    false,
  );
  const deletedAuthor = applyMutation(seed, {
    action: "delete",
    entity: "people",
    id: "person-alex",
  });
  assert.equal(deletedAuthor.tasks[0].comments[0].personId, "");
  assert.equal(deletedAuthor.tasks[0].comments[0].body, "Test comment");
  assert.throws(
    () =>
      applyMutation(seed, {
        action: "upsert",
        entity: "canvases",
        item: {
          id: "bad-canvas",
          title: "Unsafe",
          cards: [
            {
              id: "bad-url",
              type: "url",
              text: "javascript:alert(1)",
              x: 0,
              y: 0,
              width: 200,
              height: 100,
              color: "#ffffff",
            },
          ],
          edges: [],
        },
      }),
    /http/,
  );

  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys = ON");
  const root = process.env.PROJECTANVIL_CHECK_ROOT || process.cwd();
  for (const relative of [
    "drizzle/0000_dear_mimic.sql",
    "db/auth.sql",
    "db/access.sql",
    "db/workrooms.sql",
    "db/reliability.sql",
    "db/collaboration.sql",
    "db/note-collaboration.sql",
    "db/storage.sql",
    "db/upload-limits.sql",
  ])
    sql.exec(fs.readFileSync(path.join(root, relative), "utf8"));
  const requiredTables = [
    "workspaces",
    "user",
    "session",
    "account",
    "verification",
    "rateLimit",
    "workspace_access",
    "appmembers",
    "appinvites",
    "workrooms",
    "workspace_write_guards",
    "workspace_receipts",
    "entity_tombstones",
    "note_history",
    "media_objects",
    "storage_media_purges",
    "workspace_trash",
    "personal_templates",
    "appmember_roles",
    "appinvite_roles",
    "project_permissions",
    "project_members",
    "workspace_security",
    "workspace_security_guards",
    "workspace_activity",
    "workspace_watchers",
    "workspace_notifications",
    "note_collaboration",
    "note_presence",
  ];
  const migratedTables = new Set(
    sql
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
  assert.equal(
    requiredTables.filter((name) => migratedTables.has(name)).length,
    requiredTables.length,
    "Runtime bootstrap must create every auth, access, work room and recovery table",
  );
  const userColumns = sql
    .prepare('PRAGMA table_info("user")')
    .all()
    .map((row) => row.name);
  assert.ok(userColumns.includes("username"));
  assert.equal(
    userColumns.includes("displayUsername"),
    false,
    "Username is the display name; the disabled displayUsername feature must not be assumed by fixtures",
  );
  assert.equal(
    sql.prepare("SELECT COUNT(*) AS count FROM workspaces").get().count,
    0,
    "Migrations must preserve a clean first run",
  );
  const statement = (query, values = []) => ({
    query,
    values,
    bind(...bindings) {
      return statement(query, bindings);
    },
    async first(column) {
      const row = sql.prepare(query).get(...values);
      return column ? (row?.[column] ?? null) : row || null;
    },
    async all() {
      return {
        success: true,
        results: sql.prepare(query).all(...values),
        meta: {},
      };
    },
    async raw() {
      return sql
        .prepare(query)
        .all(...values)
        .map((row) => Object.values(row));
    },
    async run() {
      const result = sql.prepare(query).run(...values);
      return {
        success: true,
        results: [],
        meta: {
          changes: Number(result.changes),
          last_row_id: Number(result.lastInsertRowid),
        },
      };
    },
  });
  const DB = {
    prepare: statement,
    async batch(statements) {
      sql.exec("BEGIN TRANSACTION");
      try {
        const results = [];
        for (const entry of statements) {
          const result = sql.prepare(entry.query).run(...entry.values);
          results.push({
            success: true,
            results: [],
            meta: {
              changes: Number(result.changes),
              last_row_id: Number(result.lastInsertRowid),
            },
          });
        }
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const users = new Map();
  function request(
    route = "/api/state",
    userId = "",
    workspace = "",
    options = {},
  ) {
    const headers = new Headers(options.headers);
    if (userId) headers.set("x-test-user", userId);
    if (workspace) headers.set("x-workspace-id", workspace);
    return new Request(new URL(route, "http://127.0.0.1:5173"), {
      ...options,
      headers,
    });
  }
  const objects = new Map();
  const BUCKET = {
    async put(key, bytes) {
      objects.set(key, bytes);
    },
    async get(key, options) {
      const bytes = objects.get(key);
      return bytes
        ? {
            body: options?.range
              ? bytes.slice(
                  options.range.offset,
                  options.range.offset + options.range.length,
                )
              : bytes,
            size: bytes.byteLength,
          }
        : null;
    },
    async head(key) {
      const bytes = objects.get(key);
      return bytes ? { size: bytes.byteLength } : null;
    },
    async list({ prefix }) {
      return {
        objects: [...objects.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, bytes]) => ({ key, size: bytes.byteLength })),
        truncated: false,
      };
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  const originalLoad = Module._load;
  Module._load = function (specifier, ...args) {
    if (specifier === "cloudflare:workers") return { env: { DB, BUCKET } };
    if (specifier === "./auth")
      return {
        getSessionUser: async (req) =>
          users.get(req.headers.get("x-test-user")) || null,
      };
    return originalLoad.call(this, specifier, ...args);
  };
  const rawStore = require("./compiled/app/lib/workspace-store");
  const store = {
    ...rawStore,
    mutateWorkspace: async (req, input) => {
      let state;
      try {
        state = await rawStore.readWorkspace(req);
      } catch {
        state = createSeedWorkspace();
      }
      return rawStore.mutateWorkspace(req, {
        ...mutationBase(state, input),
        operationId: input.operationId || crypto.randomUUID(),
      });
    },
  };
  const initial = await store.readWorkspace(request());
  for (const key of collections)
    assert.equal(
      initial[key].length,
      0,
      `Stored workspace must start without ${key}`,
    );
  const originalStoredData = sql
    .prepare("SELECT data FROM workspaces WHERE id = 'main'")
    .get().data;
  const legacyStored = fixtureWorkspace();
  for (const task of legacyStored.tasks) delete task.startDate;
  legacyStored.savedViews.push({
    id: "legacy-view",
    name: "Existing view",
    query: "",
    project: "",
    assignee: "",
    priority: "",
    status: "",
  });
  const legacyStoredData = JSON.stringify(legacyStored);
  sql
    .prepare("UPDATE workspaces SET data = ? WHERE id = 'main'")
    .run(legacyStoredData);
  const legacyRead = await store.readWorkspace(request());
  assert.ok(legacyRead.tasks.every((task) => task.startDate === ""));
  assert.equal(legacyRead.savedViews[0].dateFilter, "all");
  assert.equal(legacyRead.savedViews[0].sort, "priority");
  assert.equal(
    sql.prepare("SELECT data FROM workspaces WHERE id = 'main'").get().data,
    legacyStoredData,
    "Opening legacy records supplies defaults without rewriting persisted data",
  );
  sql
    .prepare("UPDATE workspaces SET data = ? WHERE id = 'main'")
    .run(originalStoredData);
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      store.mutateWorkspace(request(), {
        action: "upsert",
        entity: "tasks",
        item: { id: `task-${i + 1}`, title: `Concurrent edit ${i}` },
      }),
    ),
  );
  let state = await store.readWorkspace(request());
  assert.equal(state.revision, 8);
  for (let i = 0; i < 8; i++)
    assert.equal(
      state.tasks.find((task) => task.id === `task-${i + 1}`).title,
      `Concurrent edit ${i}`,
    );
  await Promise.all([
    store.mutateWorkspace(request(), {
      action: "upsert",
      entity: "tasks",
      item: { id: "task-1", priority: "low" },
    }),
    store.mutateWorkspace(request(), {
      action: "upsert",
      entity: "tasks",
      item: { id: "task-1", status: "done" },
    }),
  ]);
  state = await store.readWorkspace(request());
  assert.equal(state.tasks[0].priority, "low");
  assert.equal(state.tasks[0].status, "done");
  await Promise.all([
    store.mutateWorkspace(request(), {
      action: "upsert",
      entity: "tasks",
      item: { id: "new-a", title: "New task A", key: "TASK-9" },
    }),
    store.mutateWorkspace(request(), {
      action: "upsert",
      entity: "tasks",
      item: { id: "new-b", title: "New task B", key: "TASK-9" },
    }),
  ]);
  state = await store.readWorkspace(request());
  const newTasks = state.tasks.filter((task) => task.id.startsWith("new-"));
  assert.equal(newTasks.length, 2);
  assert.equal(new Set(newTasks.map((task) => task.key)).size, 2);
  const upload = require("./compiled/app/api/media/route");
  const form = new FormData();
  form.append(
    "file",
    new File(["<script>alert(1)</script>"], "unsafe.html", {
      type: "text/html",
    }),
  );
  const response = await upload.POST(
    new Request("http://127.0.0.1:5173/api/media", {
      method: "POST",
      body: form,
    }),
  );
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.workspace.media.length, 1);
  assert.equal(payload.workspace.people.length, 0);
  assert.equal(payload.workspace.projects.length, 0);
  const download = require("./compiled/app/api/media/[id]/route");
  const fileResponse = await download.GET(
    new Request(`http://127.0.0.1:5173${payload.media.url}`),
    { params: Promise.resolve({ id: payload.media.id }) },
  );
  assert.equal(fileResponse.status, 200);
  assert.equal(
    fileResponse.headers.get("content-type"),
    "application/octet-stream",
  );
  assert.match(fileResponse.headers.get("content-disposition"), /^attachment/);
  assert.equal(fileResponse.headers.get("x-content-type-options"), "nosniff");
  const ranged = await download.GET(
    new Request(`http://127.0.0.1:5173${payload.media.url}`, {
      headers: { range: "bytes=0-6" },
    }),
    { params: Promise.resolve({ id: payload.media.id }) },
  );
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-length"), "7");
  assert.match(ranged.headers.get("content-range"), /^bytes 0-6\//);
  assert.equal((await ranged.arrayBuffer()).byteLength, 7);
  const invalidRange = await download.GET(
    new Request(`http://127.0.0.1:5173${payload.media.url}`, {
      headers: { range: "bytes=9999-" },
    }),
    { params: Promise.resolve({ id: payload.media.id }) },
  );
  assert.equal(invalidRange.status, 416);
  const stateRoute = require("./compiled/app/api/state/route");
  assert.equal((await stateRoute.GET(request())).status, 200);
  const post = async (input) =>
    stateRoute.POST(
      new Request("http://127.0.0.1:5173/api/state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...mutationBase(await store.readWorkspace(request()), input),
          operationId: crypto.randomUUID(),
        }),
      }),
    );
  const commentResponse = await post({
    action: "upsert",
    entity: "tasks",
    item: {
      id: "task-1",
      comments: [
        {
          id: "local-guest-comment",
          personId: "",
          body: "Guest comment persists",
          createdAt: now,
        },
      ],
    },
  });
  assert.equal(commentResponse.status, 200);
  assert.equal(
    (await commentResponse.json()).workspace.tasks[0].comments[0].personId,
    "",
  );
  const exported = await require("./compiled/app/api/export/route").GET(
    request("/api/export"),
  );
  assert.equal(exported.status, 200);
  const backup = await exported.json();
  assert.equal(backup.tasks[0].comments[0].body, "Guest comment persists");
  assert.equal(backup.people.length, 0);
  const importResponse = await post({ action: "import", workspace: backup });
  assert.equal(importResponse.status, 200);
  assert.equal(
    (await importResponse.json()).workspace.tasks[0].comments[0].personId,
    "",
  );
  const invalid = await stateRoute.POST(
    new Request("http://127.0.0.1:5173/api/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{oops",
    }),
  );
  assert.equal(invalid.status, 400);
  state = await store.readWorkspace(request());
  await store.mutateWorkspace(request(), {
    action: "import",
    workspace: { ...createSeedWorkspace(), revision: state.revision },
  });
  const reopened = await store.readWorkspace(request());
  for (const key of collections)
    assert.equal(
      reopened[key].length,
      0,
      `Reopening a cleared workspace must not repopulate ${key}`,
    );
  await require("./account-boundaries.cjs")({
    sql,
    store,
    access: require("./compiled/app/lib/access-store"),
    users,
    request,
  });
  await checkSqlInjectionBoundaries({ sql, DB, store, users, request });
  await require("./connected-work.cjs")({
    store,
    access: require("./compiled/app/lib/access-store"),
    request,
  });
  await require("./reliability.cjs")({
    sql,
    store: rawStore,
    request,
    objects,
  });
  await require("./storage-cleanup.cjs")({ sql, store: rawStore, request, objects, users, BUCKET, DB });
  await require("./phase1-trash.cjs")({ sql, store: rawStore, request });
  await require("./personal-templates.cjs")({
    sql,
    store: rawStore,
    request,
    users,
  });
  await require("./phase2-planning.cjs")({
    sql,
    store: rawStore,
    request,
    users,
  });
  await require("./phase3-connected.cjs")({
    sql,
    store: rawStore,
    request,
    users,
  });
  await require("./phase4-permissions.cjs")({
    sql,
    store: rawStore,
    request,
    users,
  });
  await require("./phase4-collaboration.cjs")({
    sql,
    store: rawStore,
    request,
    users,
  });
  await require("./phase4-coedit.cjs")({
    sql,
    store: rawStore,
    request,
    users,
  });
  await require("./phase4-boundaries.cjs")({ sql, store: rawStore, request, users });
  await require("./phase5-portability.cjs")({ sql, store: rawStore, request, users });
  Module._load = originalLoad;
  sql.close();
  console.log(
    "PASS: clean guest initialization, project-free tasks/notes/canvas/media, guest comments and export/import, partial merges, references, dependency cycles, dates, snapshot history, cleanup, stale import, unsafe URLs, concurrent SQLite CAS/task key allocation, media persistence/safe downloads, malformed JSON, empty workspace reopening.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
