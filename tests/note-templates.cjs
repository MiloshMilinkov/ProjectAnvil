const assert = require("node:assert/strict");
const { createSeedWorkspace } = require("./compiled/app/lib/seed");
const { applyMutation } = require("./compiled/app/lib/workspace-model");
const {
  parseNewNoteDraft,
  stagePersonalNoteTemplate,
} = require("./compiled/app/lib/note-drafts");
const {
  noteTemplateContent,
} = require("./compiled/app/lib/personal-templates");

let workspace = applyMutation(createSeedWorkspace(), {
  action: "upsert",
  entity: "notes",
  item: {
    id: "source-note",
    title: "Project brief",
    content: "# Objective\n\nReusable planning content",
    tags: ["planning"],
    properties: { stage: "draft" },
  },
  base: null,
});
const original = workspace.notes[0];
const template = {
  id: "personal-planning",
  name: "Project planning",
  kind: "note",
  content: noteTemplateContent(original),
  revision: 1,
  updatedAt: new Date().toISOString(),
  deletedAt: null,
};

const before = JSON.stringify(workspace);
const staged = stagePersonalNoteTemplate(template, workspace.notes);
assert.equal(
  JSON.stringify(workspace),
  before,
  "Using a template only stages a form",
);
assert.equal(staged.title, "Project brief (copy)");
assert.notEqual(staged.candidate.id, original.id);
assert.equal(staged.candidate.content, original.content);
assert.deepEqual(staged.candidate.properties, original.properties);
assert.deepEqual(staged.candidate.tags, original.tags);
assert.deepEqual(staged.candidate.snapshots, []);
assert.equal(staged.personalTemplateId, template.id);
const recovered = parseNewNoteDraft(JSON.parse(JSON.stringify(staged)));
assert.equal(recovered.candidate.id, staged.candidate.id);
assert.equal(recovered.operationId, staged.operationId);
assert.equal(recovered.candidate.content, original.content);

// Explicit Create succeeds even when the source note still uses the old title.
workspace = applyMutation(workspace, {
  action: "upsert",
  entity: "notes",
  item: recovered.candidate,
  operationId: recovered.operationId,
  base: null,
});
assert.equal(workspace.notes.length, 2);
assert.equal(
  workspace.notes.find((note) => note.id === original.id).title,
  "Project brief",
);
const next = stagePersonalNoteTemplate(template, workspace.notes);
assert.equal(next.title, "Project brief (copy 2)");
assert.notEqual(next.candidate.id, staged.candidate.id);
assert.notEqual(next.operationId, staged.operationId);
assert.equal(
  stagePersonalNoteTemplate(template, [{ title: " PROJECT BRIEF " }]).title,
  "Project brief (copy)",
);

const longTemplate = {
  ...template,
  content: { ...template.content, title: "A".repeat(300) },
};
const longCopy = stagePersonalNoteTemplate(longTemplate, [
  { title: longTemplate.content.title },
]);
assert.equal(longCopy.title.length, 300);
assert(longCopy.title.endsWith(" (copy)"));
assert.notEqual(longCopy.title, longTemplate.content.title);
console.log(
  "PASS: personal note templates stage recoverable content with unique titles, fresh IDs, stable retry receipts, and explicit creation.",
);
