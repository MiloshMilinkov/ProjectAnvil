const assert = require("node:assert/strict");
const {
  emptyDecision,
  decisionReplacement,
  decisionStatus,
  isNoteTypeDraft,
  isDecisionDraft,
  noteStructureDefaults,
  exportNoteMarkdown,
} = require("./compiled/app/lib/note-structures");
const {
  isRecoverableNote,
  parseNewNoteDraft,
} = require("./compiled/app/lib/note-drafts");
const {
  noteTemplateContent,
  instantiateNoteTemplate,
} = require("./compiled/app/lib/personal-templates");

const now = "2026-10-24T12:00:00.000Z";
const legacy = {
  id: "note-one",
  title: "Research source",
  content: "## Evidence\n\n[[Reference]]",
  kind: "research",
  folder: "Sources",
  tags: ["research"],
  projectId: "",
  bookmarked: false,
  properties: { Status: "Draft" },
  snapshots: [],
  createdAt: now,
  updatedAt: now,
};
const canonical = noteStructureDefaults(legacy);
assert.equal(canonical.customTypeId, "");
assert.deepEqual(canonical.propertyValues, {});
assert.equal(canonical.decision, null);
assert.equal(
  legacy.customTypeId,
  undefined,
  "Legacy normalization must not mutate its input",
);
assert(isRecoverableNote(legacy));
const type = {
  id: "source-type",
  name: "Source",
  description: "",
  archived: false,
  fields: [
    {
      id: "score",
      name: "Quality | score",
      type: "number",
      required: true,
      options: [],
    },
  ],
};
assert(isNoteTypeDraft(type));
assert(
  !isNoteTypeDraft({
    ...type,
    fields: [{ ...type.fields[0], options: { bad: "shape" } }],
  }),
);
assert(
  !isNoteTypeDraft({
    ...type,
    fields: [{ ...type.fields[0], type: "untrusted" }],
  }),
);
const incomplete = {
  ...canonical,
  customTypeId: type.id,
  propertyValues: { score: "-" },
};
assert(
  isRecoverableNote(incomplete),
  "An unfinished typed value must remain recoverable",
);
assert(
  !isRecoverableNote({
    ...incomplete,
    propertyValues: { score: { bad: "shape" } },
  }),
);
assert(!isRecoverableNote({ ...incomplete, customTypeId: { bad: "shape" } }));
const decision = {
  ...emptyDecision(),
  status: "accepted",
  context: "Need a useful source",
  options: "Compare A and B",
  outcome: "Choose A",
  consequences: "Review next month",
  decidedOn: "2026-10-24",
  ownerId: "owner-one",
  supersededById: "replacement",
};
const replaced = decisionReplacement(emptyDecision(), "replacement");
assert.equal(replaced.status, "superseded");
assert.equal(replaced.supersededById, "replacement");
assert.equal(decisionReplacement(replaced, "").status, "proposed");
assert.equal(decisionStatus(replaced, "accepted").supersededById, "");
assert.equal(decisionStatus(replaced, "proposed").supersededById, "");
assert(isDecisionDraft(decision));
assert(!isDecisionDraft({ ...decision, options: [] }));
const note = {
  ...incomplete,
  kind: "decision",
  decision,
  propertyValues: { score: "4\n5" },
};
assert(isRecoverableNote(note));
assert(
  !isRecoverableNote({
    ...note,
    decision: { ...decision, consequences: { bad: "shape" } },
  }),
);
assert.equal(
  parseNewNoteDraft({ title: "Decision", templateId: "decision" }).templateId,
  "decision",
);
const output = exportNoteMarkdown(note, {
  noteTypes: [type],
  people: [{ id: "owner-one", name: "Alex", role: "", color: "#000000" }],
  notes: [{ ...legacy, id: "replacement", title: "Updated decision" }],
  projects: [],
});
assert(output.includes("Quality \\| score | 4<br>5"));
assert(output.includes("Custom note type | Source"));
assert(output.includes("Status: accepted"));
assert(output.includes("Owner: Alex"));
assert(output.includes("Replaced by: [[Updated decision]]"));
assert(output.includes("Choose A"));
assert(output.includes(note.content));
const reusable = noteTemplateContent(note);
assert(reusable.content.includes("Choose A"));
assert(reusable.content.includes("Compare A and B"));
assert(!JSON.stringify(reusable).includes("owner-one"));
assert(!JSON.stringify(reusable).includes("replacement"));
assert(!JSON.stringify(reusable).includes("source-type"));
const copy = instantiateNoteTemplate(reusable);
assert.notEqual(copy.id, note.id);
assert.deepEqual(
  copy.decision,
  emptyDecision(),
  "Personal decision templates start with a fresh proposed decision",
);
assert.equal(copy.customTypeId, "");
assert.deepEqual(copy.propertyValues, {});
assert(copy.content.includes("Choose A"));
console.log(
  "PASS: structured note draft recovery, decision templates, portable reasoning, and readable Markdown export.",
);
