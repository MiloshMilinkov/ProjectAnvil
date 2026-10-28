const assert = require("node:assert/strict");
class MemoryStorage {
  values = new Map();
  failRecovery = false;
  failRecoveryAt = 0;
  failRemove = false;
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
    if (
      key.includes(":recovery-copies:") &&
      this.failRecoveryAt > 0 &&
      --this.failRecoveryAt === 0
    )
      throw new Error("Storage full after first recovery copy");
    if (this.failRecovery && key.includes(":recovery-copies:"))
      throw new Error("Storage full");
    this.values.set(key, String(value));
  }
  removeItem(key) {
    if (this.failRemove) throw new Error("Storage unavailable");
    this.values.delete(key);
  }
}
const storage = new MemoryStorage();
global.window = {
  localStorage: storage,
  addEventListener() {},
  removeEventListener() {},
};
const drafts = require("./compiled/app/lib/draft-store");
const {
  buildBulkMutations,
  runBulkMutations,
  supersedeBulkFailures,
} = require("./compiled/app/lib/bulk-tasks");
const {
  emptyBulkForm,
  bulkFormPatch,
  parseBulkDraft,
} = require("./compiled/app/lib/bulk-drafts");
const reminderState = require("./compiled/app/lib/reminder-state");
const { applyMutation } = require("./compiled/app/lib/workspace-model");
const { createSeedWorkspace } = require("./compiled/app/lib/seed");
const scope = { accountId: "bulk-person", workspaceId: "bulk-workspace" };
const otherScope = { ...scope, accountId: "other-person" };
let state = createSeedWorkspace();
function put(entity, item) {
  state = applyMutation(state, {
    action: "upsert",
    entity,
    item,
    base: state[entity].find((value) => value.id === item.id) || null,
  });
  return state;
}
function captured(mutation, selectedScope = scope) {
  return drafts.writeDraft(
    selectedScope,
    "mutations",
    mutation.operationId,
    mutation,
    null,
  ).record;
}

async function main() {
  put("projects", { id: "project", name: "Project", key: "PRJ" });
  put("projects", { id: "other", name: "Other", key: "OTH" });
  put("tasks", { id: "parent", title: "Parent", projectId: "project" });
  put("tasks", {
    id: "child",
    title: "Child",
    projectId: "project",
    parentId: "parent",
  });
  const family = [...state.tasks];
  const completion = buildBulkMutations(family, { status: "done" }, scope);
  assert.deepEqual(
    completion.map((mutation) => mutation.item.id),
    ["child", "parent"],
  );
  let outcomes = await runBulkMutations(
    completion,
    async (mutation) => (state = applyMutation(state, mutation)),
    () => {},
  );
  assert(outcomes.every((result) => result.status === "saved"));
  const reopening = buildBulkMutations(
    [...state.tasks].reverse(),
    { status: "todo" },
    scope,
  );
  assert.deepEqual(
    reopening.map((mutation) => mutation.item.id),
    ["parent", "child"],
  );
  const reopeningSameProject = buildBulkMutations(
    [...state.tasks].reverse(),
    { status: "todo", projectId: "project" },
    scope,
  );
  assert.deepEqual(
    reopeningSameProject.map((mutation) => mutation.item.id),
    ["parent", "child"],
  );
  assert.equal(
    Object.hasOwn(reopeningSameProject[1].item, "parentId"),
    false,
    "Keeping the same project must preserve the family",
  );
  outcomes = await runBulkMutations(
    reopeningSameProject,
    async (mutation) => (state = applyMutation(state, mutation)),
    () => {},
  );
  assert(
    outcomes.every((result) => result.status === "saved"),
    "Reopening must not try a child while its parent is still done",
  );
  const move = buildBulkMutations(state.tasks, { projectId: "other" }, scope);
  assert.deepEqual(
    move.map((mutation) => mutation.item.id),
    ["child", "parent"],
  );
  assert(
    move.every(
      (mutation) =>
        mutation.item.parentId === "" && mutation.item.milestoneId === "",
    ),
  );
  outcomes = await runBulkMutations(
    move,
    async (mutation) => (state = applyMutation(state, mutation)),
    () => {},
  );
  assert(outcomes.every((result) => result.status === "saved"));
  assert(state.tasks.every((task) => task.projectId === "other"));

  put("tasks", {
    id: "dates-a",
    title: "First dates",
    startDate: "2027-01-01",
    dueDate: "2027-01-12",
  });
  put("tasks", {
    id: "dates-b",
    title: "Later start",
    startDate: "2027-01-10",
    dueDate: "2027-01-12",
  });
  put("tasks", {
    id: "dates-c",
    title: "Last dates",
    startDate: "2027-01-01",
    dueDate: "2027-01-12",
  });
  const dates = buildBulkMutations(
    state.tasks.filter((task) => task.id.startsWith("dates-")),
    { dueDate: "2027-01-05" },
    scope,
  );
  const received = [];
  outcomes = await runBulkMutations(
    dates,
    async (mutation) => (state = applyMutation(state, mutation)),
    (result) => received.push(result),
  );
  assert.deepEqual(
    outcomes.map((result) => result.status),
    ["saved", "failed", "saved"],
  );
  assert.match(outcomes[1].error, /planned start/);
  assert.doesNotMatch(outcomes[1].error, /another tab/);
  assert.equal(dates[1].base.startDate, "2027-01-10");
  assert.equal(dates[1].base.dueDate, "2027-01-12");
  assert.equal(received.length, 3);
  assert.equal(
    state.tasks.find((task) => task.id === "dates-b").dueDate,
    "2027-01-12",
  );
  put("tasks", { id: "dates-b", startDate: "2027-01-03" });
  const retryId = dates[1].operationId;
  outcomes = await runBulkMutations(
    [dates[1]],
    async (mutation) => (state = applyMutation(state, mutation)),
    () => {},
  );
  assert.equal(outcomes[0].status, "saved");
  assert.equal(dates[1].operationId, retryId);
  const frozen = buildBulkMutations(
    [state.tasks[0]],
    { priority: "high" },
    scope,
  )[0];
  put("tasks", { id: state.tasks[0].id, title: "Unrelated newer title" });
  state = applyMutation(state, frozen);
  assert.equal(state.tasks[0].title, "Unrelated newer title");
  put("tasks", { id: state.tasks[0].id, priority: "urgent" });
  assert.throws(
    () =>
      applyMutation(state, {
        ...frozen,
        item: { id: frozen.item.id, priority: "low" },
      }),
    /changed since you opened/,
  );

  for (const status of [0, 401, 403, 404, 500]) {
    let called = 0;
    const failed = await runBulkMutations(
      completion,
      async () => {
        called++;
        const error = new Error("Unavailable");
        if (status) error.status = status;
        throw error;
      },
      () => {},
    );
    assert.equal(called, 1, `Stop after transport or access failure ${status}`);
    assert.deepEqual(
      failed.map((result) => result.status),
      ["failed", "not-run"],
    );
  }
  let continueBatch = true;
  let called = 0;
  const stopped = await runBulkMutations(
    completion,
    async () => {
      called++;
      return state;
    },
    () => {
      continueBatch = false;
    },
    () => continueBatch,
  );
  assert.equal(called, 1);
  assert.equal(stopped[1].status, "not-run");
  assert.throws(() => buildBulkMutations([], {}, scope), /between 1 and 100/);
  assert.throws(
    () =>
      buildBulkMutations(
        [state.tasks[0], state.tasks[0]],
        { status: "todo" },
        scope,
      ),
    /only once/,
  );

  const intent = buildBulkMutations(
    [state.tasks[0]],
    { priority: "low" },
    scope,
  )[0];
  const original = captured(intent);
  const retry = buildBulkMutations(
    [state.tasks[0]],
    { priority: "low" },
    scope,
  )[0];
  assert.equal(
    retry.operationId,
    intent.operationId,
    "A lost reply must recover the same scoped receipt",
  );
  assert.notEqual(
    buildBulkMutations([state.tasks[0]], { priority: "low" }, otherScope)[0]
      .operationId,
    intent.operationId,
  );
  const second = {
    ...intent,
    operationId: crypto.randomUUID(),
    item: { ...intent.item, priority: "medium" },
  };
  const secondRecord = captured(second);
  assert.equal(
    supersedeBulkFailures(
      scope,
      [original, secondRecord],
      new Set([second.operationId]),
    ),
    null,
  );
  assert.equal(drafts.readDraft(scope, "mutations", intent.operationId), null);
  assert.equal(
    drafts.readDraft(scope, "mutations", second.operationId).token,
    secondRecord.token,
  );
  assert(
    drafts
      .listDrafts(scope, "recovery-copies")
      .some((copy) => copy.record.value.record.token === original.token),
  );
  const newer = captured({
    ...second,
    item: { ...second.item, priority: "urgent" },
  });
  assert.equal(supersedeBulkFailures(scope, [secondRecord], new Set()), null);
  assert.equal(
    drafts.readDraft(scope, "mutations", second.operationId).token,
    newer.token,
    "A newer pending intent must survive late replacement",
  );
  const foreign = captured(
    { ...second, item: { ...second.item, priority: "low" } },
    otherScope,
  );
  supersedeBulkFailures(scope, [foreign], new Set());
  assert.equal(
    drafts.readDraft(otherScope, "mutations", second.operationId).token,
    foreign.token,
  );
  assert.equal(
    drafts.readDraft(scope, "mutations", second.operationId).token,
    newer.token,
  );
  const blocked = captured({ ...intent, operationId: crypto.randomUUID() });
  storage.failRecoveryAt = 2;
  assert.match(
    supersedeBulkFailures(scope, [newer, blocked], new Set()),
    /recovery/,
  );
  assert.equal(
    drafts.readDraft(scope, "mutations", second.operationId).token,
    newer.token,
  );
  assert.equal(
    drafts.readDraft(scope, "mutations", blocked.value.operationId).token,
    blocked.token,
    "No pending intent is removed before all recovery copies save",
  );
  storage.failRecovery = false;
  storage.failRemove = true;
  assert.match(
    supersedeBulkFailures(scope, [blocked], new Set()),
    /could not be cleared/,
  );
  storage.failRemove = false;
  assert.equal(supersedeBulkFailures(scope, [blocked], new Set()), null);
  assert.equal(
    drafts.readDraft(scope, "mutations", blocked.value.operationId),
    null,
  );

  const recoverable = {
    form: emptyBulkForm,
    ids: [String(intent.item.id)],
    pending: [intent],
    replacing: true,
  };
  assert.equal(
    parseBulkDraft(recoverable).pending[0].operationId,
    intent.operationId,
  );
  assert.equal(parseBulkDraft(recoverable).replacing, true);
  assert(parseBulkDraft({ form: emptyBulkForm, ids: [] }));
  assert.equal(parseBulkDraft({ ...recoverable, ids: ["same", "same"] }), null);
  assert.equal(parseBulkDraft({ ...recoverable, replacing: "true" }), null);
  assert.equal(
    parseBulkDraft({
      ...recoverable,
      pending: [{ ...intent, entity: "notes" }],
    }),
    null,
  );
  assert.equal(
    parseBulkDraft({
      ...recoverable,
      pending: [
        { ...intent, item: { ...intent.item, recurrenceNextId: "forged" } },
      ],
    }),
    null,
  );
  assert.equal(
    parseBulkDraft({
      ...recoverable,
      pending: [{ ...intent, base: { id: "wrong" } }],
    }),
    null,
  );
  assert.equal(
    parseBulkDraft({ ...recoverable, pending: [intent, intent] }),
    null,
  );
  assert.deepEqual(
    bulkFormPatch({
      ...emptyBulkForm,
      changeDue: true,
      dueDate: "",
      assignee: "set:",
    }),
    { dueDate: "", assigneeId: "" },
  );

  const reminderTask = {
    ...state.tasks[0],
    id: "reminder",
    status: "todo",
    assigneeId: "self",
    reminder: {
      date: "2027-10-31",
      time: "02:30",
      timeZone: "Europe/Belgrade",
    },
  };
  const tasks = [
    reminderTask,
    { ...reminderTask, id: "unassigned", assigneeId: "" },
    { ...reminderTask, id: "other-person", assigneeId: "other" },
    { ...reminderTask, id: "completed", status: "done" },
  ];
  const scheduled = reminderState.scheduledReminders(tasks, "self");
  assert.deepEqual(
    new Set(scheduled.map((item) => item.task.id)),
    new Set(["reminder", "unassigned"]),
  );
  assert.equal(scheduled[0].instant, Date.parse("2027-10-31T00:30:00Z"));
  const preferences = { dismissed: [], snoozed: {} };
  assert.equal(
    reminderState
      .visibleReminders(
        scheduled,
        preferences,
        Date.parse("2027-10-31T00:29:59Z"),
      )
      .filter((item) => item.due).length,
    0,
  );
  assert.equal(
    reminderState
      .visibleReminders(
        scheduled,
        preferences,
        Date.parse("2027-10-31T00:30:00Z"),
      )
      .filter((item) => item.due).length,
    2,
  );
  const key = reminderState.reminderKey(reminderTask);
  preferences.dismissed.push(key);
  assert.equal(
    reminderState.visibleReminders(
      scheduled,
      preferences,
      Date.parse("2027-10-31T01:30:00Z"),
    ).length,
    1,
    "A repeated clock hour must not repeat a dismissed reminder",
  );
  preferences.dismissed = [];
  preferences.snoozed[key] = Date.parse("2027-10-31T01:30:00Z");
  assert.equal(
    reminderState
      .visibleReminders(
        scheduled,
        preferences,
        Date.parse("2027-10-31T01:00:00Z"),
      )
      .find((item) => item.key === key).due,
    false,
  );
  assert.equal(
    reminderState
      .visibleReminders(
        scheduled,
        preferences,
        Date.parse("2027-10-31T01:30:00Z"),
      )
      .find((item) => item.key === key).due,
    true,
  );
  const rescheduled = {
    ...reminderTask,
    reminder: { ...reminderTask.reminder, date: "2027-11-01" },
  };
  assert.notEqual(reminderState.reminderKey(rescheduled), key);
  assert.deepEqual(
    reminderState.pruneReminderPreferences(
      { dismissed: [key], snoozed: { [key]: 1 } },
      [rescheduled],
    ),
    { dismissed: [], snoozed: {} },
  );
  assert.deepEqual(
    reminderState.parseReminderPreferences({
      dismissed: [key, 42],
      snoozed: { valid: 5, bad: NaN, negative: -1 },
    }),
    { dismissed: [key], snoozed: { valid: 5 } },
  );
  assert.equal(
    reminderState.scheduledReminders(
      [
        {
          ...reminderTask,
          reminder: { ...reminderTask.reminder, time: "99:99" },
        },
      ],
      "self",
    ).length,
    0,
  );
  console.log(
    "PASS: bulk family ordering, safe field merges, partial failures and retry receipts, network/access stops, scoped queued-intent replacement and recovery, strict batch drafts, personal reminder visibility, DST snoozes and rescheduled reminders.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
