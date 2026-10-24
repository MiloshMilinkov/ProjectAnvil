const assert = require("node:assert/strict");

// Recovery checks use an isolated browser store, never the app's local records.
class MemoryStorage {
  values = new Map();
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
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}
global.window = {
  localStorage: new MemoryStorage(),
  addEventListener() {},
  removeEventListener() {},
};
const drafts = require("./compiled/app/lib/draft-store");
const {
  parseMilestoneDraft,
  discardMilestoneDraft,
} = require("./compiled/app/lib/milestone-drafts");
const scope = {
  accountId: "milestone-owner",
  workspaceId: "planning-workspace",
};
const otherScope = { ...scope, accountId: "another-owner" };
const projectId = "project-one";
const milestone = {
  id: "milestone-review",
  title: "First review",
  description: "Review the first complete draft.",
  targetDate: "2026-12-01",
  archived: false,
};
const form = {
  milestone,
  operationIds: ["own-save", "goal-save", "other-project-save"],
};
assert.deepEqual(parseMilestoneDraft(form), form);
for (const invalid of [
  null,
  {},
  { ...form, milestone: { ...milestone, archived: "false" } },
  { ...form, operationIds: ["../unsafe"] },
])
  assert.equal(parseMilestoneDraft(invalid), null);
const original = drafts.writeDraft(
  scope,
  "milestone-forms",
  "project-one:new",
  form,
  { id: projectId, milestones: [] },
);
const queue = (context, id, target, item) =>
  drafts.writeDraft(
    context,
    "mutations",
    id,
    {
      action: "upsert",
      entity: "projects",
      item: { id: target, ...item },
      operationId: id,
    },
    null,
  );
queue(scope, "own-save", projectId, { milestones: [milestone] });
queue(scope, "goal-save", projectId, { goal: "A separate project edit" });
queue(scope, "other-project-save", "project-two", { milestones: [milestone] });
queue(scope, "other-milestone-save", projectId, {
  milestones: [{ ...milestone, id: "another-milestone" }],
});
queue(otherScope, "own-save", projectId, { milestones: [milestone] });
const newer = drafts.writeDraft(
  scope,
  "milestone-forms",
  "project-one:new",
  {
    milestone: { ...milestone, title: "Newer draft" },
    operationIds: ["newer-save"],
  },
  { id: projectId, milestones: [] },
);
queue(scope, "newer-save", projectId, {
  milestones: [{ ...milestone, title: "Newer draft" }],
});
discardMilestoneDraft(
  scope,
  projectId,
  "project-one:new",
  form.operationIds,
  original.record.token,
);
assert.equal(
  drafts.readDraft(scope, "mutations", "own-save"),
  null,
  "The discarded form's failed milestone save must not replay",
);
for (const id of [
  "goal-save",
  "other-project-save",
  "other-milestone-save",
  "newer-save",
])
  assert.ok(
    drafts.readDraft(scope, "mutations", id),
    `${id} must remain recoverable`,
  );
assert.ok(
  drafts.readDraft(otherScope, "mutations", "own-save"),
  "Another account's saves must remain isolated",
);
assert.equal(
  drafts.readDraft(scope, "milestone-forms", "project-one:new").token,
  newer.record.token,
  "Discarding an older form must preserve a newer browser draft",
);
console.log(
  "PASS: milestone drafts validate recovery, cancel only their own failed saves, and preserve newer drafts, other project edits, and account boundaries.",
);
