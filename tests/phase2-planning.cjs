const assert = require("node:assert/strict");

module.exports = async function checkPlanning({ sql, store, request }) {
  const {
    applyMutation,
    validateWorkspace,
  } = require("./compiled/app/lib/workspace-model");
  const progress = require("./compiled/app/lib/planning-progress");
  const { createSeedWorkspace } = require("./compiled/app/lib/seed");
  const access = require("./compiled/app/lib/access-store");
  const journal = require("./compiled/app/lib/workspace-journal");
  const now = "2027-01-30T12:00:00.000Z";
  let plan = createSeedWorkspace();
  const pure = (entity, item, at = now) => {
    plan = applyMutation(
      plan,
      {
        action: "upsert",
        entity,
        item,
        base: plan[entity].find((value) => value.id === item.id) || null,
      },
      at,
    );
    return plan;
  };
  const failure = (entity, item, pattern) =>
    assert.throws(() => pure(entity, item), pattern);
  const milestone = {
    id: "first",
    title: "First milestone",
    description: "",
    targetDate: "2027-02-28",
    archived: false,
  };
  pure("projects", {
    id: "plan",
    name: "Project plan",
    key: "PLAN",
    milestones: [
      milestone,
      { ...milestone, id: "second", title: "Second milestone" },
    ],
  });
  pure("projects", { id: "other", name: "Other project", key: "OTH" });
  pure("tasks", {
    id: "parent",
    title: "Parent",
    projectId: "plan",
    milestoneId: "first",
  });
  pure("tasks", {
    id: "child",
    title: "Child",
    projectId: "plan",
    parentId: "parent",
  });
  pure("tasks", {
    id: "nested",
    title: "Nested leaf",
    projectId: "plan",
    parentId: "child",
    status: "done",
  });
  pure("tasks", {
    id: "second-leaf",
    title: "Other leaf",
    projectId: "plan",
    milestoneId: "second",
  });
  assert.deepEqual(progress.projectProgress(plan, "plan"), {
    total: 2,
    completed: 1,
    percent: 50,
    taskIds: ["nested", "second-leaf"],
  });
  assert.equal(progress.taskChildrenProgress(plan, "parent").completed, 1);
  assert.equal(progress.taskChildrenProgress(plan, "parent").total, 1);
  assert.equal(progress.milestoneProgress(plan, "plan", "first").total, 1);
  assert.equal(
    progress.effectiveMilestoneId(
      plan,
      plan.tasks.find((task) => task.id === "nested"),
    ),
    "first",
  );
  const nestedDraft = {
    ...plan.tasks.find((task) => task.id === "nested"),
    milestoneId: "second",
  };
  assert.equal(
    progress.effectiveMilestoneId(plan, nestedDraft),
    "second",
    "Unsaved task values must not reuse the stored task's milestone cache",
  );
  assert.equal(
    progress.effectiveMilestoneId(
      plan,
      plan.tasks.find((task) => task.id === "nested"),
    ),
    "first",
  );
  failure("tasks", { id: "parent", parentId: "nested" }, /cycle/);
  failure("tasks", { id: "child", blockedBy: ["parent"] }, /cycle/);
  failure("tasks", { id: "child", projectId: "other" }, /same project/);
  failure("tasks", { id: "parent", status: "done" }, /child tasks/);
  failure("tasks", { id: "parent", milestoneId: "missing" }, /milestone/);
  failure("projects", { id: "plan", milestones: [] }, /Archive/);
  pure("projects", {
    id: "plan",
    milestones: [
      { ...milestone, archived: true },
      { ...milestone, id: "second", title: "Second milestone" },
    ],
  });
  pure("tasks", { id: "parent", title: "Archived assignment retained" });
  failure(
    "tasks",
    { id: "second-leaf", milestoneId: "first" },
    /active milestone/,
  );
  pure("canvases", {
    id: "planning-canvas",
    title: "Planning canvas",
    projectId: "plan",
  });
  assert.throws(
    () =>
      applyMutation(plan, {
        action: "delete",
        entity: "projects",
        id: "plan",
        base: plan.projects[0],
      }),
    /tasks, notes, canvases, and brainstorming boards/,
  );
  failure(
    "tasks",
    {
      id: "parent",
      recurrence: {
        frequency: "daily",
        interval: 1,
        anchorDate: "2027-01-31",
        timeZone: "UTC",
      },
    },
    /without child/,
  );
  // The rejected mutation above must not modify the immutable previous snapshot.
  assert.equal(
    plan.tasks.find((task) => task.id === "parent").recurrence,
    null,
  );
  const archivedRule = {
    frequency: "monthly",
    interval: 1,
    anchorDate: "2027-01-31",
    timeZone: "UTC",
  };
  pure("tasks", {
    id: "second-leaf",
    dueDate: "2027-01-31",
    recurrence: archivedRule,
  });
  pure("projects", {
    id: "plan",
    milestones: [
      { ...milestone, archived: true },
      { ...milestone, id: "second", title: "Second milestone", archived: true },
    ],
  });
  pure("tasks", { id: "second-leaf", status: "done" });
  assert.equal(
    plan.tasks.find((task) => task.recurringFromId === "second-leaf")
      .milestoneId,
    "second",
    "Archiving must not silently unlink an existing recurring series",
  );

  let repeats = createSeedWorkspace();
  const repeat = (item, at = now) => {
    repeats = applyMutation(
      repeats,
      {
        action: "upsert",
        entity: "tasks",
        item,
        base: repeats.tasks.find((task) => task.id === item.id) || null,
      },
      at,
    );
    return repeats;
  };
  const rule = {
    frequency: "monthly",
    interval: 1,
    anchorDate: "2027-01-31",
    timeZone: "Europe/Belgrade",
    untilDate: "",
  };
  repeat({
    id: "monthly",
    title: "Monthly review",
    startDate: "2027-01-29",
    dueDate: "2027-01-31",
    recurrence: rule,
    subtasks: [{ id: "old-check", title: "Review", done: true }],
    comments: [],
  });
  repeat({ id: "monthly", status: "done" });
  assert.equal(repeats.tasks.length, 2);
  const following = repeats.tasks.find(
    (task) => task.recurringFromId === "monthly",
  );
  assert.equal(following.dueDate, "2027-02-28");
  assert.equal(following.startDate, "2027-02-26");
  assert.equal(following.status, "todo");
  assert.notEqual(following.subtasks[0].id, "old-check");
  assert.equal(following.subtasks[0].done, false);
  assert.equal(repeats.tasks[0].recurrenceNextId, following.id);
  assert.notEqual(following.key, repeats.tasks[0].key);
  repeat({ id: "monthly", status: "todo" });
  repeat({ id: "monthly", status: "done" });
  assert.equal(
    repeats.tasks.length,
    2,
    "Reopening and recompleting must not duplicate the successor",
  );
  repeat({ id: following.id, status: "done" }, "2027-02-28T12:00:00.000Z");
  assert.equal(
    repeats.tasks.find((task) => task.recurringFromId === following.id).dueDate,
    "2027-03-31",
    "Month-end anchor must not drift after February",
  );
  assert.throws(
    () => repeat({ id: "monthly", recurrenceNextId: "forged" }),
    /managed automatically/,
  );
  repeat({
    id: "start-only",
    title: "Start only",
    startDate: "2027-01-31",
    recurrence: { ...rule, frequency: "daily" },
  });
  repeat({ id: "start-only", status: "done" });
  const startOnly = repeats.tasks.find(
    (task) => task.recurringFromId === "start-only",
  );
  assert.equal(startOnly.startDate, "2027-02-01");
  assert.equal(startOnly.dueDate, "");
  repeat({
    id: "ended",
    title: "Ended repeat",
    dueDate: "2027-01-31",
    recurrence: { ...rule, untilDate: "2027-01-31" },
  });
  repeat({ id: "ended", status: "done" });
  assert.equal(
    repeats.tasks.find((task) => task.recurringFromId === "ended"),
    undefined,
  );
  repeat({
    id: "gap",
    title: "Clock change",
    dueDate: "2027-03-27",
    recurrence: { ...rule, frequency: "daily", anchorDate: "2027-03-27" },
    reminder: {
      date: "2027-03-27",
      time: "02:30",
      timeZone: "Europe/Belgrade",
    },
  });
  const beforeGap = JSON.stringify(repeats);
  assert.throws(
    () => repeat({ id: "gap", status: "done" }, "2027-03-27T12:00:00.000Z"),
    /clocks change/,
  );
  assert.equal(
    JSON.stringify(repeats),
    beforeGap,
    "A missing reminder wall time must not commit completion or successor",
  );

  const req = request();
  const read = () => store.readWorkspace(req);
  const write = (mutation) =>
    store.mutateWorkspace(req, {
      operationId: crypto.randomUUID(),
      ...mutation,
    });
  const reset = async () =>
    write({
      action: "import",
      workspace: {
        ...createSeedWorkspace(),
        revision: (await read()).revision,
      },
    });
  const upsert = async (entity, item) =>
    write({
      action: "upsert",
      entity,
      item,
      base:
        (await read())[entity].find((value) => value.id === item.id) || null,
    });
  await reset();
  await upsert("projects", {
    id: "recovery-plan",
    name: "Recovery plan",
    key: "RCV",
    milestones: [milestone],
  });
  await upsert("projects", {
    id: "recovery-other",
    name: "Other plan",
    key: "RCO",
  });
  await upsert("tasks", {
    id: "recovery-parent",
    title: "Recover parent",
    projectId: "recovery-plan",
    milestoneId: "first",
  });
  await upsert("tasks", {
    id: "recovery-child",
    title: "Recover child",
    projectId: "recovery-plan",
    parentId: "recovery-parent",
  });
  const removeParent = async () => {
    const id = crypto.randomUUID();
    await write({
      action: "delete",
      entity: "tasks",
      id: "recovery-parent",
      base: (await read()).tasks.find((task) => task.id === "recovery-parent"),
      operationId: id,
    });
    return id;
  };
  const deleted = await removeParent();
  assert.equal((await read()).tasks[0].parentId, "");
  await upsert("tasks", { id: "recovery-child", title: "Newer child title" });
  await write({ action: "restore", id: deleted });
  const restored = (await read()).tasks.find(
    (task) => task.id === "recovery-child",
  );
  assert.equal(restored.title, "Newer child title");
  assert.equal(restored.parentId, "recovery-parent");
  const secondDeletion = await removeParent();
  await upsert("tasks", { id: "recovery-child", projectId: "recovery-other" });
  const partial = await store.mutateWorkspaceResult(req, {
    action: "restore",
    id: secondDeletion,
    operationId: crypto.randomUUID(),
  });
  assert.equal(
    partial.workspace.tasks.find((task) => task.id === "recovery-child")
      .parentId,
    "",
  );
  assert(partial.warnings.some((warning) => warning.includes("parent")));

  await reset();
  await upsert("tasks", {
    id: "concurrent-repeat",
    title: "Concurrent review",
    dueDate: "2090-01-31",
    recurrence: { ...rule, anchorDate: "2090-01-31" },
  });
  const original = (await read()).tasks[0];
  const completion = {
    action: "upsert",
    entity: "tasks",
    item: { id: original.id, status: "done" },
    base: original,
    operationId: crypto.randomUUID(),
  };
  await Promise.all([write(completion), write(completion)]);
  let concurrent = await read();
  assert.equal(concurrent.tasks.length, 2);
  const nextId = concurrent.tasks[0].recurrenceNextId;
  assert(nextId);
  await write({
    action: "delete",
    entity: "tasks",
    id: nextId,
    base: concurrent.tasks.find((task) => task.id === nextId),
  });
  await upsert("tasks", { id: original.id, status: "todo" });
  await upsert("tasks", { id: original.id, status: "done" });
  assert.equal(
    (await read()).tasks.length,
    1,
    "Deleting successor must not erase the original ledger and respawn it",
  );

  // Workspace size and collection limits protect both halves of completion.
  const full = await read();
  const recurring = { ...full.tasks[0], status: "todo" };
  delete recurring.recurrenceNextId;
  full.tasks = [
    recurring,
    ...Array.from({ length: 1499 }, (_, i) => ({
      ...recurring,
      id: `limit-${i}`,
      key: `LIMIT-${i}`,
      title: `Task ${i}`,
      recurrence: null,
    })),
  ];
  await write({ action: "import", workspace: full });
  const beforeFull = await read();
  await assert.rejects(() =>
    write({
      action: "upsert",
      entity: "tasks",
      item: { id: recurring.id, status: "done" },
      base: beforeFull.tasks[0],
    }),
  );
  assert.equal((await read()).tasks[0].status, "todo");
  assert.equal((await read()).tasks.length, 1500);

  // Even an already prepared recurrence cannot commit after team access is revoked.
  const accountRequest = request("/api/teams", "alice");
  const known = new Set(
    (await access.getAccountContext(accountRequest)).workspaces.map(
      (workspace) => workspace.id,
    ),
  );
  const created = await access.teamAction(accountRequest, {
    action: "create",
    name: "Planning authorization fixture",
  });
  const team = created.workspaces.find((workspace) => !known.has(workspace.id));
  const teamReq = request("/api/state", "alice", team.id);
  const teamState = await store.mutateWorkspace(teamReq, {
    action: "upsert",
    entity: "tasks",
    item: {
      id: "member-repeat",
      title: "Private review",
      dueDate: "2090-01-31",
      recurrence: { ...rule, anchorDate: "2090-01-31" },
    },
    base: null,
    operationId: crypto.randomUUID(),
  });
  const prepared = applyMutation(
    teamState,
    {
      action: "upsert",
      entity: "tasks",
      item: { id: "member-repeat", status: "done" },
      base: teamState.tasks[0],
    },
    now,
  );
  const resolved = await access.resolveWorkspace(teamReq);
  sql
    .prepare(
      "DELETE FROM appmembers WHERE workspace_id = ? AND user_id = 'alice'",
    )
    .run(team.id);
  assert.equal(
    await journal.commitWorkspace(
      resolved,
      teamState,
      prepared,
      crypto.randomUUID(),
      "prepared-recurring-completion",
    ),
    false,
  );
  const stored = JSON.parse(
    sql.prepare("SELECT data FROM workspaces WHERE id = ?").get(team.id).data,
  );
  assert.equal(stored.tasks.length, 1);
  assert.equal(stored.tasks[0].status, "todo");

  // Legacy records gain defaults on reads without rewriting their saved JSON.
  const legacy = createSeedWorkspace();
  legacy.tasks = [{ ...recurring, recurrence: null }];
  delete legacy.tasks[0].parentId;
  delete legacy.tasks[0].milestoneId;
  delete legacy.tasks[0].recurrence;
  delete legacy.tasks[0].reminder;
  sql
    .prepare("UPDATE workspaces SET data = ? WHERE id = 'main'")
    .run(JSON.stringify(legacy));
  const legacyData = sql
    .prepare("SELECT data FROM workspaces WHERE id = 'main'")
    .get().data;
  const normalized = await read();
  assert.equal(normalized.tasks[0].parentId, "");
  assert.equal(normalized.tasks[0].recurrence, null);
  assert.equal(
    sql.prepare("SELECT data FROM workspaces WHERE id = 'main'").get().data,
    legacyData,
  );
  validateWorkspace(normalized);
  console.log(
    "PASS: project milestones, leaf progress, inherited milestones, parent/dependency guards, archived assignments, atomic recurring completion, month-end anchors, missing DST times, retry receipts, quota rollback, scoped restore, revoked access and legacy defaults.",
  );
};
