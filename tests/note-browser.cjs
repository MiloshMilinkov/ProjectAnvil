const assert = require("node:assert/strict");
const { indexNotes, filterNotes } = require("./compiled/app/lib/note-browser");
const {
  newNote,
  templates,
  noteTemplateIds,
} = require("./compiled/app/lib/note-template-catalog");
const { parseNewNoteDraft } = require("./compiled/app/lib/note-drafts");

const older = {
  ...newNote("blank", "Planning reference", "project-a"),
  id: "older",
  folder: "",
  tags: ["weekly"],
  content: "# A linked **reference**",
  updatedAt: "2026-01-01T10:00:00.000Z",
};
const newer = {
  ...newNote("decision", "Accepted direction", "project-b"),
  id: "newer",
  customTypeId: "research",
  propertyValues: { audience: "Stakeholders" },
  bookmarked: true,
  updatedAt: "2026-02-01T10:00:00.000Z",
};
newer.decision.outcome = "Choose the accessible approach";
const notes = [older, newer];
const before = JSON.stringify(notes);
const index = indexNotes(notes, [
  {
    id: "research",
    name: "Research record",
    archived: false,
    description: "",
    fields: [],
  },
]);
const defaults = {
  search: "",
  folder: "all",
  tag: "all",
  type: "all",
  bookmarked: false,
};
const ids = (filters = {}) =>
  filterNotes(index, { ...defaults, ...filters }).map(({ note }) => note.id);
assert.deepEqual(ids(), ["newer", "older"]);
assert.deepEqual(
  ids({ search: "STAKEHOLDERS" }),
  ["newer"],
  "Structured property values remain searchable",
);
assert.deepEqual(
  ids({ search: "accessible approach", type: "decision", bookmarked: true }),
  ["newer"],
);
assert.deepEqual(ids({ type: "custom:research" }), ["newer"]);
assert.deepEqual(
  ids({ folder: "Notes", tag: "weekly" }),
  ["older"],
  "Empty folders retain the default Notes filter",
);
assert.deepEqual(ids({ tag: "weekly", bookmarked: true }), []);
assert.equal(index[0].excerpt, " A linked reference");
assert.equal(index[1].typeLabel, "Research record");
assert.equal(
  JSON.stringify(notes),
  before,
  "Search and sorting leave source order and content intact",
);

// Each indexing pass follows the current device time zone and native date labels.
const previousTimezone = process.env.TZ;
const originalTimeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
const datedNotes = [
  "2026-01-01T00:30:00Z",
  "2026-03-29T00:30:00Z",
  "2026-11-01T00:30:00Z",
  "invalid",
  "",
].map((updatedAt) => ({ ...older, updatedAt }));
try {
  for (const timezone of ["Europe/Belgrade", "America/New_York"]) {
    process.env.TZ = timezone;
    assert.deepEqual(
      indexNotes(datedNotes, []).map(({ updatedLabel }) => updatedLabel),
      datedNotes.map(({ updatedAt }) =>
        new Date(updatedAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
      ),
    );
  }
} finally {
  process.env.TZ = previousTimezone ?? originalTimeZone;
  if (previousTimezone === undefined) delete process.env.TZ;
}
assert.deepEqual(indexNotes([], []), []);

assert.equal(new Set(noteTemplateIds).size, templates.length);
for (const template of templates) {
  const first = newNote(template.id, "First", "project-a");
  const second = newNote(template.id, "Second", "project-b");
  assert.notEqual(first.id, second.id);
  assert.equal(first.content, template.body);
  assert.equal(first.kind, template.kind);
  assert.equal(
    parseNewNoteDraft({ title: "Recover", templateId: template.id }).templateId,
    template.id,
  );
  first.tags.push("local");
  first.properties.Status = "Changed";
  assert.deepEqual(second.tags, []);
  assert.equal(second.properties.Status, "Draft");
  if (first.decision) {
    first.decision.outcome = "Changed";
    assert.equal(second.decision.outcome, "");
  }
}
console.log("Note browsing and template catalogue checks passed.");
