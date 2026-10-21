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

async function checkDrafts() {
  checkNoteDraftValues();
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
