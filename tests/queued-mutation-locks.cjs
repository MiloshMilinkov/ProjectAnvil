const assert = require("node:assert/strict");
const drafts = require("./compiled/app/lib/draft-store");
const {
  claimQueuedMutation,
  cancelUnsentQueuedDeletion,
  queuedMutationLockName,
} = require("./compiled/app/lib/queued-mutation-lock");

class MemoryStorage {
  values = new Map();
  failWrites = false;
  failRemovals = false;
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
    if (this.failRemovals) throw new Error("Storage unavailable");
    this.values.delete(key);
  }
}

// Every simulated tab shares this lock manager and its transactional ordering.
class SharedLocks {
  tails = new Map();
  active = new Set();
  request(name, work) {
    const previous = this.tails.get(name) || Promise.resolve();
    const operation = previous
      .catch(() => {})
      .then(async () => {
        assert.equal(this.active.has(name), false);
        this.active.add(name);
        try {
          return await work();
        } finally {
          this.active.delete(name);
        }
      });
    this.tails.set(name, operation);
    return operation.finally(() => {
      if (this.tails.get(name) === operation) this.tails.delete(name);
    });
  }
}

const scope = { accountId: "lock-account", workspaceId: "lock-workspace" };
const storage = new MemoryStorage();
const originalWindow = global.window;
global.window = {
  localStorage: storage,
  addEventListener() {},
  removeEventListener() {},
};

function stage(id) {
  return drafts.writeDraft(
    scope,
    "mutations",
    id,
    {
      action: "delete",
      entity: "tasks",
      id: "task-a",
      operationId: id,
      base: { id: "task-a", title: "Kept task" },
    },
    {
      offlineNeverSent: true,
      offlineQueuedAt: "2026-10-25T12:00:00.000Z",
      offlineSequence: 1,
    },
  ).record;
}

(async () => {
  const locks = new SharedLocks();
  const first = stage("cancel-first");
  const [cancelled, absent] = await Promise.all([
    cancelUnsentQueuedDeletion(scope, "cancel-first", first.token, locks),
    claimQueuedMutation(scope, "cancel-first", first.token, locks),
  ]);
  assert.equal(cancelled, "cancelled");
  assert.equal(
    absent.state,
    "missing",
    "Sender cannot recreate a deletion cancelled by another tab before its claim",
  );
  assert.equal(drafts.readDraft(scope, "mutations", "cancel-first"), null);

  const second = stage("claim-first");
  const [claimed, waiting] = await Promise.all([
    claimQueuedMutation(scope, "claim-first", second.token, locks),
    cancelUnsentQueuedDeletion(scope, "claim-first", second.token, locks),
  ]);
  assert.equal(claimed.state, "ready");
  assert.equal(claimed.draft.record.baseline.offlineNeverSent, false);
  assert.equal(claimed.draft.persisted, true);
  assert.equal(
    waiting,
    "already-sent",
    "Undo never reports a safe local cancellation after another tab claimed the deletion",
  );
  assert.equal(
    drafts.readDraft(scope, "mutations", "claim-first").token,
    claimed.draft.record.token,
  );
  assert.equal(
    locks.active.size,
    0,
    "No browser lock remains held when the caller begins HTTP delivery",
  );

  const replaced = stage("replaced");
  const newer = stage("replaced");
  assert.equal(
    (await claimQueuedMutation(scope, "replaced", replaced.token, locks)).state,
    "changed",
  );
  assert.equal(
    await cancelUnsentQueuedDeletion(scope, "replaced", replaced.token, locks),
    "changed",
  );
  assert.equal(
    drafts.readDraft(scope, "mutations", "replaced").token,
    newer.token,
  );

  const unsupported = stage("unsupported");
  await assert.rejects(
    cancelUnsentQueuedDeletion(scope, "unsupported", unsupported.token, null),
    /Reconnect and synchronize/,
  );
  assert.equal(
    drafts.readDraft(scope, "mutations", "unsupported").baseline
      .offlineNeverSent,
    true,
  );
  assert.equal(
    (await claimQueuedMutation(scope, "unsupported", unsupported.token, null))
      .state,
    "ready",
    "Ordinary synchronization remains available without browser locks",
  );
  const denied = stage("unavailable-lock");
  const deniedLocks = {
    request: async () => {
      throw new Error("Locks unavailable");
    },
  };
  await assert.rejects(
    cancelUnsentQueuedDeletion(
      scope,
      "unavailable-lock",
      denied.token,
      deniedLocks,
    ),
    /Reconnect and synchronize/,
  );
  assert.equal(
    (
      await claimQueuedMutation(
        scope,
        "unavailable-lock",
        denied.token,
        deniedLocks,
      )
    ).state,
    "ready",
  );

  const failed = stage("failed-claim");
  storage.failWrites = true;
  const failedClaim = await claimQueuedMutation(
    scope,
    "failed-claim",
    failed.token,
    locks,
  );
  assert.equal(failedClaim.state, "ready");
  assert.equal(failedClaim.draft.persisted, false);
  assert.match(failedClaim.draft.error, /could not keep/);
  storage.failWrites = false;
  const removal = stage("failed-removal");
  storage.failRemovals = true;
  await assert.rejects(
    cancelUnsentQueuedDeletion(scope, "failed-removal", removal.token, locks),
    /could not be cancelled/,
  );
  storage.failRemovals = false;
  assert.equal(
    drafts.readDraft(scope, "mutations", "failed-removal").token,
    removal.token,
  );

  assert.notEqual(
    queuedMutationLockName(scope, "same-operation"),
    queuedMutationLockName(
      { ...scope, accountId: "other-account" },
      "same-operation",
    ),
  );
  assert.notEqual(
    queuedMutationLockName(scope, "same-operation"),
    queuedMutationLockName(
      { ...scope, workspaceId: "other-workspace" },
      "same-operation",
    ),
  );
  console.log(
    "PASS: cross-tab queued deletion claims and Undo ordering, exact tokens, durable send markers, scoped locks, unavailable-lock fallback, and storage failure recovery.",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
  });
