const assert = require("node:assert/strict");
const {
  createOfflineStore,
  createOfflineResumeFence,
  OFFLINE_LIMITS,
  offlineMediaUrl,
} = require("./compiled/app/lib/offline-store");
const {
  nextOfflineQueueMetadata,
  orderedOfflineMutations,
  projectOfflineMutation,
  projectOfflineMutations,
  canSupersedeQueuedMutation,
  queuedMutationSnapshotMatches,
} = require("./compiled/app/lib/offline-projection");
const { createSeedWorkspace } = require("./compiled/app/lib/seed");
const { applyMutation } = require("./compiled/app/lib/workspace-model");
const {
  AccountRefreshRequests,
  accountResponseStatus,
} = require("./compiled/app/lib/account-refresh");
const {
  canonicalMediaAddress,
  canonicalWorkspaceMedia,
  scopedWorkspaceMedia,
  canonicalMediaMutation,
  scopedMediaSource,
} = require("./compiled/app/lib/workspace-transport");

// Transactional fake: these checks never open a real browser database or read app state.
class MemoryOfflineStorage {
  metadata = new Map();
  media = new Map();
  failWrites = false;
  beforeReadMedia = null;
  async read(key) {
    return structuredClone(this.metadata.get(key));
  }
  async readMedia(key) {
    const blob = this.media.get(key);
    if (this.beforeReadMedia) await this.beforeReadMedia();
    return blob;
  }
  async mutate(update) {
    const change = update(structuredClone(this.metadata));
    if (this.failWrites) throw new Error("Storage quota exceeded");
    const metadata = structuredClone(this.metadata),
      media = new Map(this.media);
    for (const { key, value } of change.put || [])
      metadata.set(key, structuredClone(value));
    for (const key of change.remove || []) metadata.delete(key);
    for (const { key, value } of change.putMedia || []) media.set(key, value);
    for (const key of change.removeMedia || []) media.delete(key);
    this.metadata = metadata;
    this.media = media;
  }
}

const stamp = "2026-10-25T10:00:00.000Z";
const user = {
  id: "user-a",
  username: "alex",
  name: "Alex",
  email: "private@example.test",
};
const scope = { accountId: user.id, workspaceId: "team-a" };
const access = {
  id: scope.workspaceId,
  name: "Team A",
  kind: "team",
  role: "editor",
  securityRevision: 2,
  projectRoles: {},
};
const account = {
  user,
  workspaces: [access],
  invitations: [
    {
      id: "not-cached",
      workspaceId: "secret-team",
      workspaceName: "Secret",
      invitedBy: "owner",
    },
  ],
};

function workspaceFixture() {
  let workspace = createSeedWorkspace();
  workspace = applyMutation(
    workspace,
    {
      action: "upsert",
      entity: "projects",
      item: { id: "project-a", name: "Plan", key: "PLAN" },
      base: null,
    },
    stamp,
  );
  workspace = applyMutation(
    workspace,
    {
      action: "upsert",
      entity: "notes",
      item: {
        id: "note-a",
        title: "Plan",
        projectId: "project-a",
        content: "Original",
      },
      base: null,
    },
    stamp,
  );
  workspace = applyMutation(
    workspace,
    {
      action: "upsert",
      entity: "tasks",
      item: { id: "task-a", title: "Review", projectId: "project-a" },
      base: null,
    },
    stamp,
  );
  workspace.media.push({
    id: "file-a",
    name: "reference.txt",
    url: "/api/media/file-a",
    type: "text/plain",
    size: 3,
    createdAt: stamp,
    projectId: "project-a",
  });
  return workspace;
}
function entry(id, mutation, metadata, updatedAt = stamp) {
  return {
    id,
    record: {
      value: { ...mutation, operationId: id },
      baseline: metadata,
      token: id + "-token",
      updatedAt,
    },
  };
}

async function storageChecks() {
  const adapter = new MemoryOfflineStorage();
  const store = createOfflineStore(adapter);
  const workspace = workspaceFixture();
  assert.equal(await store.readWorkspace(scope), null);
  assert.equal(
    await store.update(scope, account, workspace),
    null,
    "Ordinary reads do not opt a workspace in",
  );
  assert.equal(await store.readResume(), null);
  const invalidSnapshot = { ...workspace, notes: null };
  assert.equal(
    await store.update(scope, account, invalidSnapshot),
    null,
    "An offline-disabled read does not verify or persist an unused snapshot",
  );
  await assert.rejects(
    store.enable(scope, account, invalidSnapshot),
    /could not be verified/,
    "Explicit opt-in still verifies every snapshot",
  );
  let copy = await store.enable(scope, account, workspace);
  await assert.rejects(
    store.update(scope, account, invalidSnapshot),
    /could not be verified/,
    "An enabled copy never accepts invalid snapshot data",
  );
  assert.equal(copy.workspace.notes[0].content, "Original");
  assert.equal(copy.user.email, "");
  const serialized = JSON.stringify([...adapter.metadata.values()]);
  assert.ok(!serialized.includes("private@example.test"));
  assert.ok(!serialized.includes("secret-team"));
  const resume = await store.readResume();
  assert.deepEqual(resume.account.invitations, []);
  assert.equal(resume.activeId, scope.workspaceId);
  assert.equal(resume.account.workspaces.length, 1);
  assert.equal(
    await store.readWorkspace({ ...scope, accountId: "user-b" }),
    null,
  );
  await assert.rejects(
    store.enable({ ...scope, accountId: "user-b" }, account, workspace),
    /another account/,
  );

  const data = new Blob(["abc"], { type: "text/plain" });
  await store.cacheMedia(scope, "file-a", data, copy.token);
  assert.equal(await (await store.readMedia(scope, "file-a")).text(), "abc");
  assert.equal(
    await store.readMedia({ ...scope, accountId: "user-b" }, "file-a"),
    null,
  );
  assert.equal(
    offlineMediaUrl({
      ...workspace.media[0],
      url: "https://example.test/file",
    }),
    null,
  );
  await assert.rejects(
    store.cacheMedia(
      scope,
      "file-a",
      new Blob(["ab"], { type: "text/plain" }),
      copy.token,
    ),
    /verified/,
  );
  await assert.rejects(
    store.cacheMedia(scope, "file-a", data, "stale-token"),
    /Refresh/,
  );

  const newer = structuredClone(workspace);
  newer.revision += 1;
  newer.notes[0].content = "Confirmed newer text";
  await store.update(scope, account, newer);
  await store.update(scope, account, workspace);
  assert.equal(
    (await store.readWorkspace(scope)).workspace.notes[0].content,
    "Confirmed newer text",
    "Late reads cannot downgrade a confirmed revision",
  );

  const changedAccess = {
    ...access,
    securityRevision: 3,
    projectRoles: { "project-a": "viewer" },
  };
  const changedAccount = { ...account, workspaces: [changedAccess] };
  await store.reconcileAccount(changedAccount);
  copy = await store.readWorkspace(scope);
  assert.equal(
    copy.workspace,
    null,
    "Access changes erase old private data before a filtered snapshot arrives",
  );
  assert.equal(copy.attachments.length, 0);
  assert.equal(adapter.media.size, 0);
  assert.equal(await store.readResume(), null);
  const invalidatedToken = copy.token;
  await store.update(scope, account, workspace);
  assert.equal(
    (await store.readWorkspace(scope)).workspace,
    null,
    "An older access epoch cannot revive a revoked snapshot",
  );
  await store.reconcileAccount(account);
  assert.equal(
    await store.readWorkspace(scope),
    null,
    "A lower permission counter cannot retain former private snapshots",
  );
  await store.update(scope, changedAccount, newer);
  assert.equal(
    await store.readWorkspace(scope),
    null,
    "A lower-counter invalidation requires an explicit fresh offline save",
  );
  await store.enable(scope, changedAccount, newer);
  copy = await store.readWorkspace(scope);
  assert.notEqual(copy.token, invalidatedToken);
  assert.equal(copy.workspace.revision, newer.revision);
  await assert.rejects(
    store.cacheMedia(scope, "file-a", data, "stale-token"),
    /Refresh/,
  );

  adapter.failWrites = true;
  await assert.rejects(
    store.update(scope, changedAccount, {
      ...newer,
      revision: newer.revision + 1,
    }),
    /quota/,
  );
  adapter.failWrites = false;
  assert.equal(
    (await store.readWorkspace(scope)).workspace.revision,
    newer.revision,
    "A failed cache write does not claim the newer snapshot persisted",
  );
  await assert.rejects(
    store.update(scope, changedAccount, {
      ...newer,
      notes: [
        {
          ...newer.notes[0],
          content: "x".repeat(OFFLINE_LIMITS.workspaceBytes),
        },
      ],
    }),
    /too large/,
  );

  await store.cacheMedia(scope, "file-a", data, copy.token);
  adapter.beforeReadMedia = () => store.forgetWorkspace(scope);
  assert.equal(
    await store.readMedia(scope, "file-a"),
    null,
    "Revocation during an attachment read blocks its result",
  );
  adapter.beforeReadMedia = null;
  assert.equal(await store.readResume(), null);
  await store.update(scope, changedAccount, newer);
  assert.equal(
    await store.readWorkspace(scope),
    null,
    "A late state request never recreates a forgotten offline choice",
  );

  await store.enable(scope, changedAccount, newer);
  await store.forgetAccount(user.id);
  assert.equal(await store.readWorkspace(scope), null);
  assert.equal(await store.readResume(), null);
  assert.equal(adapter.media.size, 0);

  await store.enable(scope, account, workspace);
  await store.reconcileAccount({ ...account, workspaces: [] });
  assert.equal(
    await store.readWorkspace(scope),
    null,
    "Membership removal drops the complete offline copy",
  );
  assert.equal(await store.readResume(), null);

  for (let index = 0; index < OFFLINE_LIMITS.workspaces; index++) {
    const id = `workspace-${index}`;
    await store.enable(
      { ...scope, workspaceId: id },
      { ...account, workspaces: [{ ...access, id }] },
      workspace,
    );
  }
  await assert.rejects(store.enable(scope, account, workspace), /up to 8/);
  await store.clearResume();
  assert.equal(
    await store.readResume(),
    null,
    "Clearing the resume pointer does not infer an offline sign-in from other stored accounts",
  );
}

function projectionChecks() {
  const workspace = workspaceFixture();
  const scoped = scopedWorkspaceMedia(workspace, access.id);
  const idle = projectOfflineMutations(scoped, [], access, user);
  assert.equal(
    idle.workspace,
    scoped,
    "An empty queue preserves the current scoped snapshot identity for stable rendering",
  );
  assert.deepEqual(idle.applied, []);
  assert.deepEqual(idle.conflicts, []);
  assert.deepEqual(idle.warnings, []);
  const idleCanonical = projectOfflineMutations(workspace, [], access, user);
  assert.equal(
    idleCanonical.workspace.media[0].url,
    `/api/media/file-a?workspace=${access.id}`,
    "Idle canonical snapshots still normalize attachment request scope",
  );
  assert.equal(workspace.media[0].url, "/api/media/file-a");
  assert.throws(
    () =>
      projectOfflineMutations(
        scoped,
        [],
        { ...access, id: "another-team" },
        user,
      ),
    /selected workspace/,
    "The empty-queue fast path does not accept another workspace's attachment URLs",
  );
  const first = entry(
    "op-create",
    {
      action: "upsert",
      entity: "notes",
      item: {
        id: "offline-note",
        title: "Offline draft",
        projectId: "project-a",
        content: "First text",
      },
      base: null,
    },
    { offlineQueuedAt: stamp, offlineSequence: 1 },
  );
  const preview = projectOfflineMutations(workspace, [first], access, user);
  const note = preview.workspace.notes.find(
    (note) => note.id === "offline-note",
  );
  const second = entry(
    "op-edit",
    {
      action: "upsert",
      entity: "notes",
      item: { id: note.id, content: "Second text" },
      base: note,
    },
    nextOfflineQueueMetadata([first], "op-edit", stamp),
  );
  assert.deepEqual(
    orderedOfflineMutations([second, first]).map((item) => item.id),
    [first.id, second.id],
  );
  assert.deepEqual(
    nextOfflineQueueMetadata([second, first], first.id),
    first.record.baseline,
    "Retry retains its original queue position",
  );
  const result = projectOfflineMutations(
    workspace,
    [second, first],
    access,
    user,
  );
  assert.equal(
    result.workspace.notes.find((note) => note.id === "offline-note").content,
    "Second text",
  );
  assert.equal(
    result.workspace.revision,
    workspace.revision,
    "An optimistic projection never invents a confirmed server revision",
  );
  assert.equal(
    result.workspace.notes.find((note) => note.id === "offline-note").snapshots
      .length,
    0,
    "Durable history waits for server confirmation",
  );
  assert.equal(result.conflicts.length, 0);
  assert.equal(
    workspace.notes.length,
    1,
    "Projection does not mutate the confirmed cache or the queued baseline",
  );
  assert.equal(second.record.value.base.content, "First text");

  const changed = structuredClone(workspace);
  changed.notes[0].content = "Another editor's text";
  const conflict = entry(
    "op-conflict",
    {
      action: "upsert",
      entity: "notes",
      item: { id: "note-a", content: "My offline text" },
      base: workspace.notes[0],
    },
    { offlineQueuedAt: stamp, offlineSequence: 1 },
  );
  const independent = entry(
    "op-independent",
    {
      action: "upsert",
      entity: "tasks",
      item: { id: "task-a", priority: "high" },
      base: workspace.tasks[0],
    },
    { offlineQueuedAt: stamp, offlineSequence: 2 },
  );
  const merged = projectOfflineMutations(
    changed,
    [conflict, independent],
    access,
    user,
  );
  assert.equal(merged.workspace.notes[0].content, "Another editor's text");
  assert.equal(merged.workspace.tasks[0].priority, "high");
  assert.equal(merged.conflicts[0].status, 409);
  assert.deepEqual(
    merged.applied,
    [independent.id],
    "Independent intents can remain visible while a conflicting change is reviewed",
  );
  assert.equal(
    conflict.record.value.item.content,
    "My offline text",
    "A conflict retains the original text for review",
  );

  const viewer = { ...access, role: "viewer" };
  assert.equal(
    projectOfflineMutations(workspace, [independent], viewer, user).conflicts[0]
      .status,
    403,
  );
  const projectViewer = { ...access, projectRoles: { "project-a": "viewer" } };
  assert.equal(
    projectOfflineMutations(workspace, [independent], projectViewer, user)
      .conflicts[0].status,
    403,
  );
  assert.throws(
    () =>
      projectOfflineMutation(
        workspace,
        { action: "restore", id: "trash-record" },
        access,
        user,
      ),
    /Connect/,
  );
  assert.throws(
    () =>
      projectOfflineMutation(
        workspace,
        { action: "import", workspace },
        { ...access, role: "owner" },
        user,
      ),
    /Connect/,
  );

  const recurring = structuredClone(workspace);
  recurring.tasks[0].dueDate = "2026-10-25";
  recurring.tasks[0].recurrence = {
    frequency: "daily",
    interval: 1,
    anchorDate: "2026-10-25",
    timeZone: "Europe/Belgrade",
  };
  const completed = projectOfflineMutation(
    recurring,
    {
      action: "upsert",
      entity: "tasks",
      item: { id: "task-a", status: "done" },
      base: recurring.tasks[0],
    },
    access,
    user,
    stamp,
  );
  assert.equal(completed.workspace.tasks[0].status, "done");
  assert.equal(
    completed.workspace.tasks.length,
    recurring.tasks.length,
    "Unconfirmed recurring IDs do not become editable phantom tasks",
  );
  assert.equal(completed.workspace.tasks[0].recurrenceNextId, undefined);
  assert.match(completed.warnings[0], /recurring/);
}

function queueAcknowledgementChecks() {
  const original = workspaceFixture();
  const first = entry(
    "op-first",
    {
      action: "upsert",
      entity: "notes",
      item: { id: "note-a", content: "First offline edit" },
      base: original.notes[0],
    },
    { offlineQueuedAt: stamp, offlineSequence: 1 },
    stamp,
  );
  const preview = projectOfflineMutations(
    original,
    [first],
    access,
    user,
  ).workspace;
  const second = entry(
    "op-second",
    {
      action: "upsert",
      entity: "notes",
      item: { id: "note-a", content: "Second offline edit" },
      base: preview.notes[0],
    },
    { offlineQueuedAt: "2026-10-25T10:00:01.000Z", offlineSequence: 2 },
    "2026-10-25T10:00:01.000Z",
  );
  const transmitted = {
    ...first,
    record: {
      ...first.record,
      token: "sending-first",
      updatedAt: "2026-10-25T10:01:00.000Z",
      baseline: { ...first.record.baseline, offlineNeverSent: false },
    },
  };
  const saved = applyMutation(
    original,
    first.record.value,
    "2026-10-25T10:01:00.000Z",
  );
  const remaining = [second].filter(
    (candidate) => !canSupersedeQueuedMutation(candidate, transmitted, saved),
  );
  assert.deepEqual(
    remaining.map((candidate) => candidate.id),
    [second.id],
    "Sending the first offline edit must not discard a later edit when its metadata timestamp advances",
  );
  const final = projectOfflineMutations(
    saved,
    remaining,
    access,
    user,
  ).workspace;
  assert.equal(
    final.notes[0].content,
    "Second offline edit",
    "The later same-field value remains visible and queued for its own receipt",
  );

  const latestAck = {
    ...second,
    record: { ...second.record, updatedAt: "2026-10-25T10:02:00.000Z" },
  };
  assert.equal(
    canSupersedeQueuedMutation(first, latestAck, saved),
    true,
    "A newer acknowledged save can still supersede an earlier failed intent covering the same fields",
  );
  const legacy = { ...first, record: { ...first.record, baseline: null } };
  assert.equal(
    canSupersedeQueuedMutation(legacy, latestAck, saved),
    true,
    "Earlier online drafts without queue metadata retain their original timestamp semantics",
  );
  const unrelated = entry(
    "op-title",
    {
      action: "upsert",
      entity: "notes",
      item: { id: "note-a", title: "Unrelated title draft" },
      base: original.notes[0],
    },
    first.record.baseline,
  );
  assert.equal(
    canSupersedeQueuedMutation(unrelated, latestAck, saved),
    false,
    "Acknowledging content never erases a separate title draft",
  );
  const comment = {
    id: "comment-a",
    body: "Keep this discussion",
    personId: "",
    createdAt: stamp,
  };
  const discussed = entry(
    "op-discussion",
    {
      action: "upsert",
      entity: "tasks",
      item: { id: "task-a", comments: [comment] },
    },
    first.record.baseline,
  );
  const discussionAck = entry(
    "op-discussion-latest",
    { action: "upsert", entity: "tasks", item: { id: "task-a", comments: [] } },
    second.record.baseline,
  );
  assert.equal(
    canSupersedeQueuedMutation(discussed, discussionAck, saved),
    false,
    "An older discussion remains recoverable until the saved task actually contains it",
  );
  const savedDiscussion = structuredClone(saved);
  savedDiscussion.tasks[0].comments = [comment];
  assert.equal(
    canSupersedeQueuedMutation(discussed, discussionAck, savedDiscussion),
    true,
  );

  assert.equal(queuedMutationSnapshotMatches(second, second.record), true);
  assert.equal(
    queuedMutationSnapshotMatches(second, null),
    false,
    "A captured replay must not recreate an intent another window discarded",
  );
  assert.equal(
    queuedMutationSnapshotMatches(second, {
      ...second.record,
      token: "newer-version",
    }),
    false,
    "A captured replay cannot submit a replaced draft version",
  );
  const pending = new Map([
      [first.id, first.record],
      [second.id, second.record],
    ]),
    sent = [];
  for (const captured of [first, second]) {
    const current = pending.get(captured.id) || null;
    if (!queuedMutationSnapshotMatches(captured, current)) continue;
    sent.push(captured.id);
    if (captured.id === first.id) pending.delete(second.id);
  }
  assert.deepEqual(
    sent,
    [first.id],
    "Both replay paths can skip an entry discarded while an earlier request was in flight",
  );
}

async function accountRefreshChecks() {
  const requests = new AccountRefreshRequests();
  let finishFirst,
    finishSecond,
    firstTicket,
    secondTicket,
    calls = 0;
  const first = requests.run(async (ticket) => {
    calls++;
    firstTicket = ticket;
    await new Promise((resolve) => {
      finishFirst = resolve;
    });
  });
  assert.equal(
    requests.run(async () => {
      calls++;
    }),
    first,
    "A slow request is shared by later polls rather than invalidated indefinitely",
  );
  await Promise.resolve();
  assert.equal(calls, 1);
  const second = requests.run(async (ticket) => {
    calls++;
    secondTicket = ticket;
    await new Promise((resolve) => {
      finishSecond = resolve;
    });
  }, true);
  await Promise.resolve();
  assert.equal(firstTicket.signal.aborted, true);
  assert.equal(
    firstTicket.isCurrent(),
    false,
    "Authentication transitions invalidate every earlier reply",
  );
  assert.equal(secondTicket.isCurrent(), true);
  finishFirst();
  await first;
  assert.equal(
    requests.run(async () => {
      calls++;
    }),
    second,
    "An older completion cannot clear the newer in-flight request",
  );
  finishSecond();
  await second;
  await requests.run(async () => {
    calls++;
  });
  assert.equal(calls, 3);
  requests.invalidate();
  assert.equal(secondTicket.isCurrent(), false);
  assert.equal(accountResponseStatus(200), "ready");
  for (const status of [401, 403, 404, 409])
    assert.equal(accountResponseStatus(status), "denied");
  for (const status of [408, 429, 500, 503])
    assert.equal(accountResponseStatus(status), "unavailable");
  assert.equal(accountResponseStatus(400), "failed");
}

async function scopedMediaChecks() {
  const original = workspaceFixture();
  const url = `/api/media/file-a?workspace=${scope.workspaceId}`;
  const browser = scopedWorkspaceMedia(original, scope.workspaceId);
  assert.equal(browser.media[0].url, url);
  assert.equal(
    scopedMediaSource(browser.media[0], "/api/media/file-a", scope.workspaceId),
    url,
    "Canonical note image and link sources request the correct online workspace",
  );
  assert.equal(
    scopedMediaSource(
      browser.media[0],
      "/api/media/file-a#page=2",
      scope.workspaceId,
    ),
    url + "#page=2",
    "PDF and media fragments survive online source resolution",
  );
  assert.equal(
    scopedMediaSource(browser.media[0], url, scope.workspaceId),
    url,
    "Already-scoped canvas and project files stay unchanged",
  );
  assert.throws(
    () =>
      scopedMediaSource(
        browser.media[0],
        "/api/media/file-a?workspace=foreign",
        scope.workspaceId,
      ),
    /attachment address/,
  );
  assert.equal(
    original.media[0].url,
    "/api/media/file-a",
    "Transport conversion never mutates the source snapshot",
  );
  assert.equal(
    canonicalMediaAddress(browser.media[0], scope.workspaceId),
    "/api/media/file-a",
  );
  assert.deepEqual(
    canonicalWorkspaceMedia(browser, scope.workspaceId),
    original,
  );
  assert.deepEqual(
    scopedWorkspaceMedia(browser, scope.workspaceId),
    browser,
    "Applying browser scope twice is idempotent",
  );
  assert.equal(
    offlineMediaUrl(browser.media[0], scope.workspaceId),
    url,
    "Attachment fetches retain their verified own workspace query",
  );
  assert.equal(
    offlineMediaUrl(browser.media[0]),
    null,
    "A scoped address needs an explicit matching workspace",
  );
  for (const bad of [
    "/api/media/file-a?workspace=foreign-workspace",
    url + "&extra=1",
    url + "#fragment",
    "/api/media/file-a?workspace=%74eam-a",
    "/api/media/another-file",
    "https://example.test/api/media/file-a?workspace=team-a",
    "//example.test/api/media/file-a",
  ]) {
    const file = { ...browser.media[0], url: bad };
    assert.equal(offlineMediaUrl(file, scope.workspaceId), null);
    assert.throws(
      () => canonicalMediaAddress(file, scope.workspaceId),
      /attachment address/,
    );
    assert.throws(
      () =>
        projectOfflineMutations(
          { ...browser, media: [file] },
          [],
          access,
          user,
        ),
      /attachment address/,
    );
  }

  const changed = projectOfflineMutation(
    browser,
    {
      action: "upsert",
      entity: "notes",
      item: { id: "note-a", content: "Edited offline with an attachment" },
      base: browser.notes[0],
    },
    access,
    user,
    stamp,
  ).workspace;
  assert.equal(changed.notes[0].content, "Edited offline with an attachment");
  assert.equal(
    changed.media[0].url,
    url,
    "Model application uses canonical metadata and restores browser URLs afterwards",
  );
  const rename = {
    action: "upsert",
    entity: "media",
    item: { ...browser.media[0], name: "renamed.txt" },
    base: browser.media[0],
  };
  const normalized = canonicalMediaMutation(rename, scope.workspaceId);
  assert.equal(normalized.item.url, "/api/media/file-a");
  assert.equal(normalized.base.url, "/api/media/file-a");
  assert.equal(
    rename.item.url,
    url,
    "Queued payloads and original comparison bases remain unchanged",
  );
  const renamed = projectOfflineMutation(
    browser,
    rename,
    access,
    user,
    stamp,
  ).workspace;
  assert.equal(renamed.media[0].name, "renamed.txt");
  assert.equal(renamed.media[0].url, url);
  assert.throws(
    () =>
      canonicalMediaMutation(
        {
          ...rename,
          base: {
            ...rename.base,
            url: "/api/media/file-a?workspace=other-team",
          },
        },
        scope.workspaceId,
      ),
    /attachment address/,
  );

  const adapter = new MemoryOfflineStorage(),
    store = createOfflineStore(adapter);
  const copy = await store.enable(scope, account, browser);
  assert.equal(copy.workspace.media[0].url, url);
  const saved = [...adapter.metadata.values()].find(
    (value) => value.kind === "workspace",
  );
  assert.equal(
    saved.workspace.media[0].url,
    "/api/media/file-a",
    "Only canonical metadata is kept in IndexedDB",
  );
  assert.equal((await store.readWorkspace(scope)).workspace.media[0].url, url);
  await store.cacheMedia(
    scope,
    "file-a",
    new Blob(["abc"], { type: "text/plain" }),
    copy.token,
  );
  assert.equal(await (await store.readMedia(scope, "file-a")).text(), "abc");
  await store.update(scope, account, original);
  assert.equal(
    (await store.readWorkspace(scope)).attachments.length,
    1,
    "Canonical and scoped transport forms share a stable binary fingerprint",
  );
  assert.equal(await (await store.readMedia(scope, "file-a")).text(), "abc");
  await assert.rejects(
    store.update(scope, account, {
      ...browser,
      media: [
        { ...browser.media[0], url: "/api/media/file-a?workspace=other-team" },
      ],
    }),
    /could not be copied/,
  );
}

async function rollbackRefreshChecks() {
  const workspace = workspaceFixture();
  const newer = { ...workspace, revision: workspace.revision + 10 };
  const adapter = new MemoryOfflineStorage();
  const store = createOfflineStore(adapter);
  const copy = await store.enable(scope, account, newer);
  await store.cacheMedia(
    scope,
    "file-a",
    new Blob(["abc"], { type: "text/plain" }),
    copy.token,
  );
  const refreshed = await store.refreshAfterRollback(
    scope,
    account,
    workspace,
    copy.token,
  );
  assert.equal(refreshed.workspace.revision, workspace.revision);
  assert.notEqual(
    refreshed.token,
    copy.token,
    "A confirmed database rollback rotates the attachment authority token",
  );
  assert.equal(refreshed.attachments.length, 0);
  assert.equal(
    adapter.media.size,
    0,
    "Rollback removes old cached bytes even when file IDs and sizes happen to match",
  );
  assert.equal(
    await store.refreshAfterRollback(scope, account, workspace, copy.token),
    null,
    "An earlier rollback completion cannot replace a refreshed copy",
  );
  assert.equal(
    await store.refreshAfterRollback(scope, account, workspace, undefined),
    null,
  );

  for (const action of ["remove", "logout", "permissions"]) {
    const raceAdapter = new MemoryOfflineStorage();
    const raceStore = createOfflineStore(raceAdapter);
    const saved = await raceStore.enable(scope, account, newer);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const originalMutate = raceAdapter.mutate.bind(raceAdapter);
    let pauseFirst = true;
    raceAdapter.mutate = async (update) => {
      if (pauseFirst) {
        pauseFirst = false;
        await gate;
      }
      return originalMutate(update);
    };
    const pending = raceStore.refreshAfterRollback(
      scope,
      account,
      workspace,
      saved.token,
    );
    const changed = {
      ...account,
      workspaces: [
        {
          ...access,
          role: "viewer",
          securityRevision: access.securityRevision + 1,
        },
      ],
    };
    if (action === "remove") await raceStore.forgetWorkspace(scope);
    else if (action === "logout") await raceStore.forgetAccount(user.id);
    else await raceStore.reconcileAccount(changed);
    release();
    assert.equal(
      await pending,
      null,
      `An in-flight rollback cannot undo ${action}`,
    );
    const after = await raceStore.readWorkspace(scope);
    if (action === "permissions") {
      assert.equal(after.access.role, "viewer");
      assert.equal(after.workspace, null);
      assert.notEqual(after.token, saved.token);
    } else assert.equal(after, null);
    assert.equal(await raceStore.readResume(), null);
  }

  const lowerAdapter = new MemoryOfflineStorage();
  const lowerStore = createOfflineStore(lowerAdapter);
  const privileged = {
    ...account,
    workspaces: [{ ...access, role: "admin", securityRevision: 20 }],
  };
  const oldCopy = await lowerStore.enable(scope, privileged, newer);
  await lowerStore.cacheMedia(
    scope,
    "file-a",
    new Blob(["abc"], { type: "text/plain" }),
    oldCopy.token,
  );
  await lowerStore.reconcileAccount({
    ...account,
    workspaces: [{ ...access, role: "viewer", securityRevision: 1 }],
  });
  assert.equal(await lowerStore.readWorkspace(scope), null);
  assert.equal(
    await lowerStore.readResume(),
    null,
    "A restored lower-security database cannot resume former role/private content",
  );
  assert.equal(lowerAdapter.media.size, 0);
}

function resumeFenceChecks() {
  let marker = null;
  const storage = {
    read: () => marker,
    write: (value) => {
      marker = value;
    },
  };
  const fence = createOfflineResumeFence(storage);
  const initial = fence.capture();
  assert(!fence.isBlocked());
  fence.block();
  const denied = marker;
  assert(fence.isBlocked());
  assert.equal(
    fence.complete(initial, true),
    false,
    "A late explicit save cannot clear a newer local logout marker",
  );
  assert.equal(marker, denied);
  const whileDenied = fence.capture();
  assert.equal(
    fence.complete(whileDenied, false),
    false,
    "Background saves never unblock a logout, including failed-purge retention",
  );
  assert.equal(marker, denied);

  const anotherTab = createOfflineResumeFence(storage);
  anotherTab.block();
  const otherDenied = marker;
  assert.notEqual(otherDenied, denied);
  assert.equal(
    fence.complete(whileDenied, true),
    false,
    "A new cross-tab logout is distinct even if an old denial was already present",
  );
  assert.equal(marker, otherDenied);
  const fresh = fence.capture();
  assert(
    fence.complete(fresh, true),
    "A current user-explicit offline save may enable reopening after an earlier logout",
  );
  assert(!fence.isBlocked());
  const beforeAnotherTabTransition = fence.capture();
  anotherTab.block();
  assert(anotherTab.complete(anotherTab.capture(), true));
  assert(
    !fence.current(beforeAnotherTabTransition),
    "A block/allow cycle in another tab cannot validate a previously captured resume read",
  );
  assert.equal(fence.complete(beforeAnotherTabTransition, true), false);
  marker = "true";
  assert(fence.isBlocked(), "Legacy denial markers remain effective");
}

(async () => {
  await storageChecks();
  projectionChecks();
  await accountRefreshChecks();
  await scopedMediaChecks();
  queueAcknowledgementChecks();
  await rollbackRefreshChecks();
  resumeFenceChecks();
  console.log(
    "PASS: opt-in offline copies, account isolation, access invalidation, verified scoped attachments, quota rollback, ordered durable intents, partial conflicts, viewer limits and deferred generated IDs.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
