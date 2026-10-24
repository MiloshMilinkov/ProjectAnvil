const assert = require("node:assert/strict");
const { duplicateTask } = require("./compiled/app/lib/task-copy.js");
const source = {
  id: "old",
  key: "OLD-7",
  title: "Prepare review",
  description: "Criteria",
  status: "done",
  priority: "high",
  type: "story",
  projectId: "project",
  assigneeId: "person",
  startDate: "2026-10-01",
  dueDate: "2026-10-20",
  estimate: 3,
  tags: ["review"],
  noteIds: ["note", "deleted-note"],
  blockedBy: ["task"],
  subtasks: [{ id: "step", title: "Read brief", done: true }],
  comments: [
    {
      id: "comment",
      personId: "person",
      body: "Done",
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  ],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  source: { noteId: "note", excerpt: "Original provenance" },
};
const before = structuredClone(source);
const workspace = { projects: [{ id: "project" }], notes: [{ id: "note" }] };
const copy = duplicateTask(source, workspace);
assert.notEqual(copy.id, source.id);
assert.equal(copy.key, "");
for (const key of [
  "title",
  "description",
  "priority",
  "type",
  "projectId",
  "estimate",
])
  assert.equal(copy[key], source[key]);
assert.deepEqual(copy.tags, source.tags);
assert.deepEqual(copy.noteIds, ["note"]);
assert.equal(copy.status, "todo");
for (const key of ["assigneeId", "startDate", "dueDate"])
  assert.equal(copy[key], "");
for (const key of ["comments", "blockedBy"]) assert.deepEqual(copy[key], []);
assert.equal(copy.source, undefined);
assert.equal(copy.subtasks[0].done, false);
assert.notEqual(copy.subtasks[0].id, source.subtasks[0].id);
copy.tags.push("new");
copy.subtasks[0].title = "Changed";
assert.deepEqual(source, before);
const second = duplicateTask(source, { projects: [], notes: [] });
assert.notEqual(second.id, copy.id);
assert.notEqual(second.subtasks[0].id, copy.subtasks[0].id);
assert.equal(second.projectId, "");
assert.deepEqual(second.noteIds, []);
console.log("Task duplication checks passed.");
