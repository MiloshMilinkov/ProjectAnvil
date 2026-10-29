const assert = require("node:assert/strict");

// All browser storage here is an isolated fake. No workspace data or secrets are read.
class MemoryStorage {
  values = new Map();
  failWrites = false;
  get length() {
    return this.values.size;
  }
  key(index) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    if (this.failWrites) throw new Error("Quota exceeded");
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

function checkNoteDraftValues() {
  const {
    isRecoverableNote,
    isRecoverableNoteRecord,
    parseNewNoteDraft,
    parseLinkedTaskDraft,
    parseNoteCopyDraft,
    noteTemplateIds,
  } = require("./compiled/app/lib/note-drafts");
  const timestamp = "2026-10-21T12:00:00.000Z";
  const note = {
    id: "note-valid",
    title: "",
    content: "An unfinished note",
    folder: "Notes",
    tags: ["planning"],
    projectId: "",
    kind: "note",
    bookmarked: false,
    properties: { status: "draft" },
    snapshots: [
      { id: "snapshot-valid", content: "Earlier text", savedAt: timestamp },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  assert.equal(
    isRecoverableNote(note),
    true,
    "An unfinished empty title is recoverable",
  );
  const malformed = {
    id: 3,
    title: { text: "Not a string" },
    content: null,
    folder: [],
    tags: [42],
    projectId: {},
    kind: "unsupported",
    bookmarked: "false",
    properties: { status: [] },
    snapshots: [{ id: "snapshot-valid", content: 15, savedAt: timestamp }],
    createdAt: false,
    updatedAt: "not a date",
  };
  for (const [field, value] of Object.entries(malformed)) {
    assert.equal(
      isRecoverableNote({ ...note, [field]: value }),
      false,
      `Reject malformed note ${field}`,
    );
  }
  assert.equal(isRecoverableNote({ ...note, kind: { toString: null } }), false);
  assert.equal(isRecoverableNote({ ...note, properties: new Date() }), false);
  assert.equal(
    isRecoverableNote({
      ...note,
      snapshots: [{ id: "s", content: "text", savedAt: [] }],
    }),
    false,
  );
  const record = {
    value: note,
    baseline: note,
    token: "token",
    updatedAt: timestamp,
  };
  assert.equal(isRecoverableNoteRecord(record, note.id), true);
  assert.equal(isRecoverableNoteRecord(record, "different-note"), false);
  assert.equal(
    isRecoverableNoteRecord(
      { ...record, baseline: { ...note, id: "different-note" } },
      note.id,
    ),
    false,
  );
  assert.equal(
    isRecoverableNoteRecord({ ...record, baseline: { id: note.id } }, note.id),
    false,
  );
  assert.equal(
    isRecoverableNoteRecord({ ...record, baseline: null }, note.id),
    false,
  );

  for (const templateId of noteTemplateIds)
    assert.equal(
      parseNewNoteDraft({ title: "", templateId })?.templateId,
      templateId,
    );
  const form = {
    title: "Plan",
    templateId: "blank",
    candidate: note,
    operationId: "create-operation",
  };
  assert.equal(parseNewNoteDraft(form)?.candidate, note);
  for (const value of [
    null,
    [],
    { ...form, title: {} },
    { ...form, templateId: "unknown" },
    { ...form, candidate: { ...note, tags: [{}] } },
    { ...form, operationId: {} },
    { ...form, operationId: undefined },
    { title: "Plan", templateId: "blank", operationId: "without-candidate" },
  ]) {
    assert.equal(parseNewNoteDraft(value), null);
  }
  const linked = {
    title: "",
    excerpt: "A source quote",
    projectId: "",
    assigneeId: "",
    priority: "medium",
    taskId: "new-task",
    operationId: "create-linked",
    createdAt: timestamp,
  };
  assert.equal(parseLinkedTaskDraft(linked)?.excerpt, linked.excerpt);
  for (const field of [
    "title",
    "excerpt",
    "projectId",
    "assigneeId",
    "taskId",
    "operationId",
    "createdAt",
  ]) {
    assert.equal(
      parseLinkedTaskDraft({ ...linked, [field]: {} }),
      null,
      `Reject malformed linked-task ${field}`,
    );
  }
  assert.equal(parseLinkedTaskDraft({ ...linked, priority: "highest" }), null);
  assert.equal(
    parseLinkedTaskDraft({ ...linked, createdAt: "not a date" }),
    null,
  );
  assert.equal(parseLinkedTaskDraft({ ...linked, taskId: "" }), null);
  assert.equal(
    parseNoteCopyDraft({ note, operationId: "copy-operation" })?.note,
    note,
  );
  assert.equal(
    parseNoteCopyDraft({
      note: { ...note, properties: [] },
      operationId: "copy-operation",
    }),
    null,
  );
  assert.equal(parseNoteCopyDraft({ note, operationId: null }), null);
}

function checkTaskDraftValues() {
  const {
    parseTaskDraft,
    parseRecoverableTask,
  } = require("./compiled/app/lib/task-drafts");
  const timestamp = "2026-10-21T12:00:00.000Z";
  const task = {
    id: "task-draft",
    key: "PLAN-1",
    title: "",
    description: "Keep this unfinished plan",
    status: "todo",
    priority: "medium",
    type: "task",
    projectId: "",
    assigneeId: "",
    dueDate: "2026-10-25",
    estimate: 3,
    tags: ["planning"],
    noteIds: [],
    blockedBy: [],
    subtasks: [{ id: "step-a", title: "First step", done: false }],
    comments: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const record = {
    value: {
      task,
      tagText: "planning",
      comment: "Unsent discussion",
      subtask: "Unadded step",
    },
    baseline: { ...task, title: "Saved title" },
    token: "draft-token-unchanged",
    owner: "other-window",
    updatedAt: timestamp,
  };
  const unchanged = structuredClone(record);
  const recovered = parseTaskDraft(record, task.id);
  assert.ok(recovered, "Old unfinished forms remain recoverable");
  assert.equal(recovered.value.task.startDate, "");
  assert.equal(recovered.baseline.startDate, "");
  assert.equal(
    recovered.value.task.title,
    "",
    "An unfinished empty title is preserved",
  );
  assert.equal(recovered.value.comment, record.value.comment);
  assert.equal(recovered.value.subtask, record.value.subtask);
  assert.equal(recovered.token, record.token);
  assert.equal(recovered.owner, record.owner);
  assert.equal(recovered.updatedAt, record.updatedAt);
  assert.deepEqual(
    record,
    unchanged,
    "Normalization never mutates the stored recovery copy",
  );
  const unfinishedRange = { ...task, startDate: "2026-10-30" };
  const recoveredRange = parseTaskDraft(
    { ...record, value: { ...record.value, task: unfinishedRange } },
    task.id,
  );
  assert.equal(
    recoveredRange.value.task.startDate,
    unfinishedRange.startDate,
    "A conflicting date range remains editable instead of being discarded",
  );
  assert.equal(recoveredRange.value.task.dueDate, task.dueDate);
  const newTask = parseTaskDraft({ ...record, baseline: null });
  assert.equal(newTask.baseline, null);
  assert.equal(newTask.value.task.startDate, "");
  assert.equal(parseTaskDraft(record, "another-task"), null);
  assert.equal(
    parseTaskDraft({ ...record, baseline: { ...task, id: "another-task" } }),
    null,
  );
  assert.equal(
    parseTaskDraft({ ...record, value: { ...record.value, comment: {} } }),
    null,
  );
  assert.equal(
    parseTaskDraft({ ...record, baseline: { ...task, startDate: 42 } }),
    null,
  );
  assert.equal(parseRecoverableTask({ ...task, startDate: 42 }), null);
  assert.equal(parseRecoverableTask({ ...task, startDate: null }), null);
  assert.equal(parseRecoverableTask(null), null);
  assert.equal(parseTaskDraft(null), null);
}

async function checkEverydayRetryRecovery(drafts) {
  const { moveToTrash } = require("./compiled/app/lib/trash-actions");
  const {
    recoverPendingOperation,
  } = require("./compiled/app/lib/editor-mutations");
  const { applyMutation } = require("./compiled/app/lib/workspace-model");
  const { createSeedWorkspace } = require("./compiled/app/lib/seed");
  const scope = { accountId: "retry-account", workspaceId: "retry-workspace" };
  let workspace = applyMutation(createSeedWorkspace(), {
    action: "upsert",
    entity: "tasks",
    item: { id: "retry-task", title: "Keep this recovery copy" },
    base: null,
  });
  const input = {
    entity: "tasks",
    id: "retry-task",
    base: structuredClone(workspace.tasks[0]),
  };
  // A matching intent belonging to another account must not supply Undo's token.
  drafts.writeDraft(
    { ...scope, accountId: "other-account" },
    "mutations",
    "foreign-delete",
    {
      ...input,
      action: "delete",
      operationId: "foreign-delete",
    },
    null,
  );
  const archives = new Map();
  const receipts = new Map();
  const calls = [];
  const notices = [];
  let loseDeleteReply = true;
  const mutateDelete = async (mutation) => {
    calls.push(structuredClone(mutation));
    const recovery = drafts.writeDraft(
      scope,
      "mutations",
      mutation.operationId,
      mutation,
      null,
    );
    if (!receipts.has(mutation.operationId)) {
      const deleted = workspace.tasks.find((task) => task.id === mutation.id);
      workspace = applyMutation(workspace, mutation);
      archives.set(mutation.operationId, structuredClone(deleted));
      receipts.set(mutation.operationId, JSON.stringify(mutation));
    } else {
      assert.equal(
        JSON.stringify(mutation),
        receipts.get(mutation.operationId),
        "A receipt retry keeps the original payload",
      );
    }
    if (loseDeleteReply) {
      loseDeleteReply = false;
      throw new Error("Delete committed but its reply was lost");
    }
    drafts.removeDraft(
      scope,
      "mutations",
      mutation.operationId,
      recovery.record.token,
    );
    return structuredClone(workspace);
  };
  const notify = (message, options) => notices.push({ message, ...options });
  await assert.rejects(
    () => moveToTrash(mutateDelete, notify, input, "Task", scope),
    /reply was lost/,
  );
  assert.equal(
    workspace.tasks.length,
    0,
    "The first request really committed before the connection failed",
  );
  assert.equal(
    notices.length,
    0,
    "Undo is offered only after an acknowledged deletion",
  );
  const pending = drafts.listDrafts(scope, "mutations");
  assert.equal(pending.length, 1);
  const deletionId = pending[0].id;
  assert.notEqual(deletionId, "foreign-delete");
  await moveToTrash(mutateDelete, notify, input, "Task", scope);
  assert.equal(calls.length, 2);
  assert.equal(
    calls[1].operationId,
    deletionId,
    "The helper recovers the original delete ID instead of creating another action",
  );
  assert.equal(
    archives.size,
    1,
    "Retrying does not create another Trash archive",
  );
  assert.equal(receipts.size, 1);
  assert.equal(archives.get(deletionId).id, input.id);
  assert.deepEqual(notices, [
    { message: "Task moved to Trash", undoId: deletionId },
  ]);
  assert.equal(
    drafts.listDrafts(scope, "mutations").length,
    0,
    "Acknowledgement clears the recovered pending delete",
  );

  // SavedTaskViews holds its creation ID until acknowledgement. Exercise that
  // composition with the real operation recovery and workspace model so a lost
  // create reply cannot produce a second saved view or discard its layout.
  const createId = "saved-view-stable-create";
  const creation = {
    action: "upsert",
    entity: "savedViews",
    base: null,
    item: {
      id: createId,
      name: "Upcoming priorities",
      query: "planning",
      assignee: "",
      priority: "high",
      project: "",
      status: "todo",
      dateFilter: "due-next-7-days",
      sort: "due-date",
      layout: "timeline",
    },
  };
  let loseCreateReply = true;
  const createReceipts = new Map();
  const createCalls = [];
  const saveView = async (intent) => {
    const mutation = recoverPendingOperation(scope, structuredClone(intent));
    mutation.operationId ||= crypto.randomUUID();
    createCalls.push(structuredClone(mutation));
    const recovery = drafts.writeDraft(
      scope,
      "mutations",
      mutation.operationId,
      mutation,
      null,
    );
    if (!createReceipts.has(mutation.operationId)) {
      workspace = applyMutation(workspace, mutation);
      createReceipts.set(mutation.operationId, JSON.stringify(mutation));
    } else
      assert.equal(
        JSON.stringify(mutation),
        createReceipts.get(mutation.operationId),
      );
    if (loseCreateReply) {
      loseCreateReply = false;
      throw new Error("View committed but its reply was lost");
    }
    drafts.removeDraft(
      scope,
      "mutations",
      mutation.operationId,
      recovery.record.token,
    );
    return workspace;
  };
  await assert.rejects(() => saveView(creation), /reply was lost/);
  const pendingView = drafts.listDrafts(scope, "mutations")[0];
  assert.equal(pendingView.record.value.item.id, createId);
  assert.equal(
    recoverPendingOperation(scope, {
      ...creation,
      item: { ...creation.item, layout: "list" },
    }).operationId,
    undefined,
    "Changed layout is a distinct intent and cannot reuse the previous receipt",
  );
  await saveView(creation);
  assert.equal(createCalls[1].operationId, createCalls[0].operationId);
  assert.equal(createReceipts.size, 1);
  assert.equal(workspace.savedViews.length, 1);
  assert.equal(workspace.savedViews[0].id, createId);
  assert.equal(workspace.savedViews[0].layout, "timeline");
  assert.equal(drafts.listDrafts(scope, "mutations").length, 0);
}

function checkConfirmedTaskReplacement(drafts) {
  const { replaceTaskDraft } = require("./compiled/app/lib/task-drafts");
  const { applyMutation } = require("./compiled/app/lib/workspace-model");
  const { createSeedWorkspace } = require("./compiled/app/lib/seed");
  for (const sameId of [false, true]) {
    const scope = {
      accountId: "replacement-account",
      workspaceId: `replacement-${sameId}`,
    };
    const foreign = { ...scope, accountId: "other-replacement-account" };
    const oldMutation = {
      action: "upsert",
      entity: "tasks",
      item: { id: "abandoned-task", title: "Abandoned task" },
      base: null,
      operationId: "failed-task-save",
    };
    const oldTask = applyMutation(createSeedWorkspace(), oldMutation).tasks[0];
    const oldForm = { task: oldTask, tagText: "", comment: "", subtask: "" };
    const oldDraft = drafts.writeDraft(
      scope,
      "tasks",
      "new-task",
      oldForm,
      null,
    );
    drafts.writeDraft(
      scope,
      "mutations",
      oldMutation.operationId,
      oldMutation,
      null,
    );
    const otherTask = {
      action: "upsert",
      entity: "tasks",
      item: { id: "other-task", title: "Another unfinished task" },
      base: null,
      operationId: "other-save",
    };
    drafts.writeDraft(
      scope,
      "mutations",
      otherTask.operationId,
      otherTask,
      null,
    );
    drafts.writeDraft(
      scope,
      "mutations",
      "note-save",
      {
        action: "upsert",
        entity: "notes",
        item: { id: oldTask.id, title: "Unrelated note" },
        base: null,
      },
      null,
    );
    drafts.writeDraft(
      foreign,
      "mutations",
      oldMutation.operationId,
      oldMutation,
      null,
    );
    const displaced = drafts.writeDraft(
      scope,
      "recovery-copies",
      "another-window",
      { entity: "tasks", id: "new-task", record: oldDraft.record },
      null,
    );
    const replacementTask = {
      ...oldTask,
      id: sameId ? oldTask.id : "copied-task",
      title: sameId ? "Template content" : "Task copy",
      key: "",
    };
    const replacement = { ...oldForm, task: replacementTask };

    // This is the persistence action shared by both confirmed replacement paths.
    const result = replaceTaskDraft(scope, "new-task", oldTask.id, replacement);
    assert.equal(result.persisted, true);
    assert.deepEqual(
      drafts.readDraft(scope, "tasks", "new-task").value,
      replacement,
    );
    const pending = drafts
      .listDrafts(scope, "mutations")
      .map(({ record }) => record.value);
    assert.deepEqual(
      pending.map((mutation) => mutation.operationId).filter(Boolean),
      ["other-save"],
    );
    assert.equal(
      pending.some((mutation) => mutation.entity === "notes"),
      true,
      "Other entity writes remain queued",
    );
    assert.equal(
      drafts.listDrafts(foreign, "mutations").length,
      1,
      "Other account writes remain queued",
    );
    assert.deepEqual(
      drafts.readDraft(scope, "recovery-copies", "another-window"),
      displaced.record,
      "Another window's displaced recovery copy remains intact",
    );
    let workspace = createSeedWorkspace();
    for (const mutation of pending)
      workspace = applyMutation(workspace, mutation);
    workspace = applyMutation(workspace, {
      action: "upsert",
      entity: "tasks",
      item: replacementTask,
      base: null,
    });
    assert.deepEqual(
      workspace.tasks.map((task) => task.title).sort(),
      ["Another unfinished task", replacementTask.title].sort(),
      "Retrying saves cannot resurrect the abandoned task content",
    );
  }
}

async function checkDrafts() {
  checkNoteDraftValues();
  checkTaskDraftValues();
  const {
    defaultPreferences,
    parseWorkspacePreferences,
  } = require("./compiled/app/lib/workspace-preferences");
  for (const invalid of [null, undefined, false, "broken json", [], 5]) {
    assert.deepEqual(parseWorkspacePreferences(invalid), defaultPreferences);
  }
  assert.deepEqual(
    parseWorkspacePreferences({
      compact: "true",
      taskShortcut: "Ctrl+N",
      savedPage: "missing-page",
    }),
    defaultPreferences,
  );
  assert.deepEqual(
    parseWorkspacePreferences({
      compact: true,
      taskShortcut: "P",
      savedPage: "rooms",
    }),
    {
      compact: true,
      taskShortcut: "p",
      savedPage: "rooms",
    },
  );
  assert.deepEqual(
    parseWorkspacePreferences({ compact: 1, taskShortcut: "?", savedPage: 42 }),
    defaultPreferences,
  );
  assert.deepEqual(
    parseWorkspacePreferences({
      compact: false,
      taskShortcut: "a",
      savedPage: "notes",
      extra: "ignored",
    }),
    {
      compact: false,
      taskShortcut: "a",
      savedPage: "notes",
    },
  );
  const previousWindow = global.window;
  const storage = new MemoryStorage();
  const events = new Map();
  global.window = {
    localStorage: storage,
    addEventListener(name, listener) {
      events.set(name, [...(events.get(name) || []), listener]);
    },
    removeEventListener(name, listener) {
      events.set(
        name,
        (events.get(name) || []).filter((item) => item !== listener),
      );
    },
  };
  const modulePath = require.resolve("./compiled/app/lib/draft-store");
  const reload = () => {
    delete require.cache[modulePath];
    return require(modulePath);
  };
  try {
    let drafts = reload();
    const scope = { accountId: "account-a", workspaceId: "team-a" };
    const baseline = { content: "Saved text", tags: [] };
    const value = { content: "Recovered text", tags: ["planning"] };
    const first = drafts.writeDraft(scope, "notes", "note-a", value, baseline);
    assert.equal(first.persisted, true);
    value.content = "Changed after writing";
    baseline.content = "Mutated baseline";
    assert.equal(
      drafts.readDraft(scope, "notes", "note-a").value.content,
      "Recovered text",
    );
    assert.equal(
      drafts.readDraft(scope, "notes", "note-a").baseline.content,
      "Saved text",
    );
    assert.equal(
      drafts.readDraft({ ...scope, accountId: "account-b" }, "notes", "note-a"),
      null,
    );
    assert.equal(
      drafts.readDraft(
        { ...scope, workspaceId: "personal-a" },
        "notes",
        "note-a",
      ),
      null,
    );
    assert.equal(drafts.readDraft(scope, "tasks", "note-a"), null);

    const second = drafts.writeDraft(
      scope,
      "notes",
      "note-a",
      { content: "Newer typing" },
      { content: "Saved text" },
    );
    assert.equal(
      drafts.removeDraft(scope, "notes", "note-a", first.record.token),
      false,
    );
    assert.equal(
      drafts.readDraft(scope, "notes", "note-a").value.content,
      "Newer typing",
    );
    drafts = reload();
    assert.equal(
      drafts.readDraft(scope, "notes", "note-a").token,
      second.record.token,
      "Recovery survives page/module reload",
    );

    storage.failWrites = true;
    const failed = drafts.writeDraft(
      scope,
      "notes",
      "note-a",
      { content: "Newest unsaved typing" },
      { content: "Saved text" },
    );
    assert.equal(failed.persisted, false);
    assert.equal(
      drafts.isDraftPersisted(scope, "notes", "note-a", failed.record.token),
      false,
      "An in-memory recovery value is not an offline acknowledgement",
    );
    assert.match(failed.error, /Keep this page open/);
    assert.equal(
      drafts.readDraft(scope, "notes", "note-a").value.content,
      "Newest unsaved typing",
    );
    assert.equal(drafts.hasUnpersistedDrafts(scope), true);
    assert.equal(
      drafts.hasUnpersistedDrafts({ ...scope, accountId: "account-b" }),
      false,
    );
    storage.failWrites = false;
    const retried = drafts.writeDraft(
      scope,
      "notes",
      "note-a",
      failed.record.value,
      failed.record.baseline,
    );
    assert.equal(drafts.hasUnpersistedDrafts(scope), false);
    assert.equal(
      drafts.isDraftPersisted(scope, "notes", "note-a", retried.record.token),
      true,
      "Retry must durably store the exact version before acknowledging it",
    );
    assert.equal(
      drafts.removeDraft(scope, "notes", "note-a", retried.record.token),
      true,
    );
    assert.equal(drafts.listDrafts(scope, "notes").length, 0);

    const durable = drafts.writeDraft(
      scope,
      "notes",
      "parallel",
      { content: "Window one" },
      { content: "Saved" },
    );
    storage.failWrites = true;
    const memoryOnly = drafts.writeDraft(
      scope,
      "notes",
      "parallel",
      { content: "Window one newer typing" },
      { content: "Saved" },
    );
    const parallelKey = [...storage.values.keys()].find((key) =>
      key.endsWith(":parallel"),
    );
    const otherWindow = {
      ...durable.record,
      owner: "window-two",
      token: "other-window-token",
      value: { content: "Window two recovery copy" },
    };
    storage.values.set(parallelKey, JSON.stringify(otherWindow));
    storage.failWrites = false;
    assert.equal(
      drafts.removeDraft(scope, "notes", "parallel", memoryOnly.record.token),
      false,
    );
    assert.equal(
      drafts.readDraft(scope, "notes", "parallel").value.content,
      "Window two recovery copy",
      "A quota-failed acknowledgement never erases another window’s durable draft",
    );
    // Pretend the current page already owns a draft while another page replaces it.
    const firstBranch = drafts.writeDraft(
      scope,
      "notes",
      "parallel",
      { content: "Our first edit" },
      { content: "Saved" },
    );
    const secondForeign = {
      ...otherWindow,
      token: "other-window-next",
      value: { content: "Their next edit" },
    };
    storage.values.set(parallelKey, JSON.stringify(secondForeign));
    drafts.writeDraft(
      scope,
      "notes",
      "parallel",
      { content: "Our next edit" },
      { content: "Saved" },
    );
    let copies = drafts.listDrafts(scope, "recovery-copies");
    assert.equal(copies.length, 1);
    assert.equal(
      copies[0].record.value.record.value.content,
      "Their next edit",
    );
    storage.values.set(
      parallelKey,
      JSON.stringify({
        ...secondForeign,
        token: "other-window-latest",
        value: { content: "Their latest edit" },
      }),
    );
    drafts.writeDraft(
      scope,
      "notes",
      "parallel",
      { content: "Our latest edit" },
      { content: "Saved" },
    );
    copies = drafts.listDrafts(scope, "recovery-copies");
    assert.equal(
      copies.length,
      1,
      "One recovery copy per displaced window avoids per-keystroke archives",
    );
    assert.equal(
      copies[0].record.value.record.value.content,
      "Their latest edit",
    );
    assert.equal(
      drafts.removeDraft(scope, "notes", "parallel", firstBranch.record.token),
      false,
    );
    drafts.removeDraft(scope, "notes", "parallel");
    drafts.removeDraft(scope, "recovery-copies", copies[0].id);

    drafts.writeDraft(
      scope,
      "mutations",
      "operation-a",
      { entity: "notes", item: { id: "note-a", content: "A" } },
      null,
    );
    drafts.writeDraft(
      scope,
      "mutations",
      "operation-b",
      { entity: "notes", item: { id: "note-b", content: "B" } },
      null,
    );
    drafts.writeDraft(
      scope,
      "mutations",
      "operation-c",
      { entity: "tasks", item: { id: "note-a", title: "Task" } },
      null,
    );
    drafts.discardDraftMutations(scope, "notes", "note-a");
    assert.deepEqual(
      new Set(drafts.listDrafts(scope, "mutations").map((item) => item.id)),
      new Set(["operation-b", "operation-c"]),
    );

    const {
      recoverPendingOperation,
    } = require("./compiled/app/lib/editor-mutations");
    const pendingCreate = {
      action: "upsert",
      entity: "notes",
      item: { id: "lost-create", title: "Plan", content: "Notes" },
      base: null,
    };
    drafts.writeDraft(
      scope,
      "mutations",
      "lost-reply",
      { ...pendingCreate, operationId: "lost-reply" },
      null,
    );
    assert.equal(
      recoverPendingOperation(scope, pendingCreate).operationId,
      "lost-reply",
    );
    assert.equal(
      recoverPendingOperation(scope, {
        base: null,
        item: { content: "Notes", title: "Plan", id: "lost-create" },
        entity: "notes",
        action: "upsert",
      }).operationId,
      "lost-reply",
      "Object property order does not change a retry payload",
    );
    assert.equal(
      recoverPendingOperation(scope, {
        ...pendingCreate,
        item: { ...pendingCreate.item, title: "Different plan" },
      }).operationId,
      undefined,
    );
    assert.equal(
      recoverPendingOperation(scope, {
        ...pendingCreate,
        base: { id: "lost-create", title: "Different original" },
      }).operationId,
      undefined,
    );
    assert.equal(
      recoverPendingOperation(
        { ...scope, workspaceId: "another-team" },
        pendingCreate,
      ).operationId,
      undefined,
    );
    const explicit = {
      ...pendingCreate,
      operationId: "explicit-new-operation",
    };
    assert.equal(
      recoverPendingOperation(scope, explicit),
      explicit,
      "An explicit receipt ID is never replaced",
    );
    const discussion = {
      action: "upsert",
      entity: "tasks",
      item: {
        id: "task-discussion",
        comments: [{ id: "first", body: "First message" }],
      },
      base: { id: "task-discussion", comments: [] },
    };
    drafts.writeDraft(
      scope,
      "mutations",
      "discussion-reply",
      { ...discussion, operationId: "discussion-reply" },
      null,
    );
    assert.equal(
      recoverPendingOperation(scope, {
        ...discussion,
        item: {
          ...discussion.item,
          comments: [
            ...discussion.item.comments,
            { id: "second", body: "Another message" },
          ],
        },
      }).operationId,
      undefined,
      "A new comment is a distinct operation",
    );
    assert.equal(
      pendingCreate.operationId,
      undefined,
      "Replay lookup does not mutate the editor payload",
    );
    assert.equal(
      recoverPendingOperation(scope, { ...pendingCreate, base: undefined })
        .operationId,
      undefined,
      "Missing and explicit null baselines are distinct",
    );
    assert.equal(
      recoverPendingOperation(
        { ...scope, accountId: "another-account" },
        pendingCreate,
      ).operationId,
      undefined,
      "Operation identity is private to the account",
    );
    const ordered = {
      ...discussion,
      item: {
        ...discussion.item,
        comments: [
          ...discussion.item.comments,
          { id: "second", body: "Another message" },
        ],
      },
    };
    drafts.writeDraft(
      scope,
      "mutations",
      "ordered-reply",
      { ...ordered, operationId: "ordered-reply" },
      null,
    );
    assert.equal(
      recoverPendingOperation(scope, ordered).operationId,
      "ordered-reply",
    );
    assert.equal(
      recoverPendingOperation(scope, {
        ...ordered,
        item: {
          ...ordered.item,
          comments: [...ordered.item.comments].reverse(),
        },
      }).operationId,
      undefined,
      "Array order remains meaningful",
    );
    const rename = {
      action: "rename",
      name: "New workspace name",
      base: { name: "Original name" },
    };
    drafts.writeDraft(
      scope,
      "mutations",
      "rename-reply",
      { ...rename, operationId: "rename-reply" },
      null,
    );
    assert.equal(
      recoverPendingOperation(scope, rename).operationId,
      "rename-reply",
    );
    assert.equal(
      recoverPendingOperation(scope, { ...rename, name: "Another name" })
        .operationId,
      undefined,
      "Action-specific fields are part of the identity",
    );
    const review = {
      action: "review-relationship",
      id: "relationship-a",
      expectedFromSignature: "a",
      expectedToSignature: "b",
    };
    drafts.writeDraft(
      scope,
      "mutations",
      "review-reply",
      { ...review, operationId: "review-reply" },
      null,
    );
    assert.equal(
      recoverPendingOperation(scope, review).operationId,
      "review-reply",
    );
    assert.equal(
      recoverPendingOperation(scope, {
        ...review,
        expectedToSignature: "changed",
      }).operationId,
      undefined,
      "Changed review expectations get a new operation",
    );

    await checkEverydayRetryRecovery(drafts);
    checkConfirmedTaskReplacement(drafts);

    const queuedCreate = drafts.writeDraft(
      scope,
      "mutations",
      "offline-create",
      {
        action: "upsert",
        entity: "tasks",
        item: { id: "offline-task", title: "Keep this creation" },
        operationId: "offline-create",
      },
      null,
    );
    const queuedDelete = drafts.writeDraft(
      scope,
      "mutations",
      "offline-delete",
      {
        action: "delete",
        entity: "tasks",
        id: "offline-task",
        operationId: "offline-delete",
      },
      null,
    );
    drafts.discardDraftMutations(scope, "tasks", "offline-task", {
      preserveQueuedDeletion: true,
    });
    assert.equal(
      drafts.readDraft(scope, "mutations", "offline-create").token,
      queuedCreate.record.token,
      "Offline delete cleanup keeps the earlier creation in queue order",
    );
    assert.equal(
      drafts.readDraft(scope, "mutations", "offline-delete").token,
      queuedDelete.record.token,
      "Offline delete cleanup keeps its Undo receipt",
    );
    drafts.removeDraft(
      scope,
      "mutations",
      "offline-delete",
      queuedDelete.record.token,
    );
    drafts.discardDraftMutations(scope, "tasks", "offline-task", {
      preserveQueuedDeletion: true,
    });
    assert.equal(
      drafts.readDraft(scope, "mutations", "offline-create"),
      null,
      "Confirmed deletion still clears obsolete editor intents",
    );

    let dirty = true;
    const release = drafts.registerDraftGuard(scope, "recording", {
      hasUnsaved: () => dirty,
      hasUnpersisted: () => dirty,
      flush: async () => {
        dirty = false;
        return true;
      },
    });
    assert.equal(drafts.hasUnpersistedDrafts(scope), true);
    assert.equal(await drafts.flushDraftGuards(scope), true);
    assert.equal(drafts.hasUnpersistedDrafts(scope), false);
    release();

    const reloadScope = {
      accountId: "reload-account",
      workspaceId: "reload-workspace",
    };
    assert.equal(await drafts.prepareWorkspaceReload(reloadScope), true);
    const releaseUnsaved = drafts.registerDraftGuard(
      reloadScope,
      "unfinished",
      {
        hasUnsaved: () => true,
      },
    );
    assert.equal(await drafts.prepareWorkspaceReload(reloadScope), false);
    releaseUnsaved();

    storage.failWrites = true;
    const unstored = drafts.writeDraft(
      reloadScope,
      "notes",
      "unstored",
      { content: "Keep this text" },
      null,
    );
    storage.failWrites = false;
    assert.equal(
      await drafts.prepareWorkspaceReload(reloadScope),
      false,
      "Reload cannot discard a failed device-storage write",
    );
    drafts.removeDraft(reloadScope, "notes", "unstored", unstored.record.token);

    const pending = drafts.writeDraft(
      reloadScope,
      "mutations",
      "pending",
      {
        action: "upsert",
        entity: "tasks",
        item: { id: "pending-task", title: "Keep queued work" },
      },
      null,
    );
    assert.equal(await drafts.prepareWorkspaceReload(reloadScope), false);
    assert.equal(
      drafts.readDraft(reloadScope, "mutations", "pending").token,
      pending.record.token,
      "A blocked reload retains the queued operation",
    );
    const releaseSave = drafts.registerDraftGuard(reloadScope, "save", {
      hasUnsaved: () => !!drafts.readDraft(reloadScope, "mutations", "pending"),
      flush: async () => {
        drafts.removeDraft(
          reloadScope,
          "mutations",
          "pending",
          pending.record.token,
        );
        return true;
      },
    });
    assert.equal(
      await drafts.prepareWorkspaceReload(reloadScope),
      true,
      "A confirmed flush can make a previously queued workspace ready to reload",
    );
    releaseSave();

    let finishSave;
    let acknowledged = false;
    let newerEdit = false;
    const saveBarrier = new Promise((resolve) => {
      finishSave = resolve;
    });
    const releaseRace = drafts.registerDraftGuard(reloadScope, "newer-edit", {
      hasUnsaved: () => !acknowledged || newerEdit,
      flush: async () => {
        await saveBarrier;
        acknowledged = true;
        return true;
      },
    });
    const checkingReload = drafts.prepareWorkspaceReload(reloadScope);
    newerEdit = true;
    finishSave();
    assert.equal(
      await checkingReload,
      false,
      "An earlier save acknowledgement cannot authorize reloading over newer work",
    );
    releaseRace();
    assert.equal(
      await drafts.prepareWorkspaceReload(reloadScope),
      true,
      "Unrelated workspace drafts do not block a clean scope",
    );

    storage.setItem("projectanvil-draft-v1:account-a:team-a:notes:%ZZ", "{}");
    storage.setItem(
      "projectanvil-draft-v1:account-a:team-a:notes:corrupt",
      "not json",
    );
    assert.equal(
      drafts.listDrafts(scope, "notes").length,
      0,
      "Malformed browser entries never prevent startup",
    );
    console.log("Browser draft recovery checks passed");
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    delete require.cache[modulePath];
  }
}

module.exports = { checkDrafts };
if (require.main === module)
  checkDrafts().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
