const assert = require("node:assert/strict");
const { zipSync } = require("fflate");
const portable = require("./compiled/app/lib/portable-markdown");
const { createSeedWorkspace } = require("./compiled/app/lib/seed");
const {
  applyMutation,
  validateWorkspace,
} = require("./compiled/app/lib/workspace-model");
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
const now = "2026-10-25T12:00:00Z";
let workspace = createSeedWorkspace();
const add = (entity, item) =>
  (workspace = applyMutation(
    workspace,
    { action: "upsert", entity, item, base: null },
    now,
  ));
add("noteTypes", {
  id: "type_source",
  name: "Research",
  description: "Keep useful sources",
  archived: false,
  fields: [
    {
      id: "confidence",
      name: "Confidence",
      type: "number",
      required: true,
      options: [],
    },
  ],
});
add("media", {
  id: "picture",
  name: "Reference picture.png",
  type: "image/png",
  size: 3,
  url: "/api/media/picture",
  createdAt: now,
});
add("notes", {
  id: "alpha",
  title: "First idea",
  folder: "Planning",
  content:
    "# First\n\n[[Second idea#Details|Related]] and ![Reference](/api/media/picture?workspace=main).\n\n`[[Second idea]]`\n",
  customTypeId: "type_source",
  propertyValues: { confidence: "90" },
  properties: { source: "/api/media/picture" },
  tags: ["planning"],
});
add("notes", {
  id: "beta",
  title: "Second idea",
  folder: "Reference",
  content: "# Details\n\nA useful paragraph. ^detail-block\n",
});
add("relationships", {
  id: "link",
  from: { type: "note", id: "alpha" },
  to: { type: "note", id: "beta" },
  kind: "supports",
  label: "Evidence",
});
const exported = portable.exportPortableNotes(workspace);
exported.files.push({
  path: exported.attachmentPaths.get("picture"),
  bytes: new Uint8Array([1, 2, 3]),
});
const first = decoder.decode(
  exported.files.find((file) => file.path === "Planning/First idea.md").bytes,
);
assert(first.includes("[[../Reference/Second idea#Details|Related]]"));
assert(first.includes("../attachments/picture-Reference%20picture.png"));
assert(first.includes("`[[Second idea]]`"), "Code samples remain literal");
const packed = portable.packPortableZip(exported.files);
assert.deepEqual(
  packed,
  portable.packPortableZip([...exported.files].reverse()),
  "Folder archives are deterministic for safe interrupted retries",
);
const unpacked = portable.unpackPortableZip(packed);
const bundle = portable.readPortableBundle(unpacked);
assert.equal(bundle.notes.length, 2);
assert.equal(bundle.attachments[0].name, "Reference picture.png");
assert.equal(bundle.attachments[0].type, "image/png");
assert.equal(bundle.noteTypes.length, 1);
assert.equal(bundle.relationships.length, 1);
const ids = new Map(
  [
    ...bundle.notes.map((note) => note.path),
    ...bundle.attachments.map((file) => file.path),
    "type:0",
    "relationship:0",
  ].map((key, index) => [key, `fresh_${index}`]),
);
const plan = portable.planPortableImport(bundle, workspace, "", ids, now);
assert.equal(plan.notes[0].title, "First idea (imported 2)");
assert.equal(plan.notes[1].title, "Second idea (imported 2)");
assert(
  plan.notes[0].content.includes(
    "[[Second idea (imported 2)#Details|Related]]",
  ),
);
assert(
  plan.notes[0].content.includes(
    `/api/media/${ids.get(bundle.attachments[0].path)}`,
  ),
);
assert.equal(
  plan.notes[0].properties.source,
  `/api/media/${ids.get(bundle.attachments[0].path)}`,
);
assert.equal(plan.notes[0].propertyValues.confidence, "90");
assert.equal(plan.notes[0].snapshots.length, 0);
assert.equal(plan.noteTypes[0].name, "Research (imported 2)");
assert.equal(plan.notes[0].customTypeId, plan.noteTypes[0].id);
assert.equal(plan.relationships[0].from.id, plan.notes[0].id);
assert.equal(plan.relationships[0].to.id, plan.notes[1].id);
validateWorkspace({
  ...workspace,
  notes: [...workspace.notes, ...plan.notes],
  media: [...workspace.media, ...plan.media],
  noteTypes: [...workspace.noteTypes, ...plan.noteTypes],
  relationships: [...workspace.relationships, ...plan.relationships],
});
assert.equal(
  workspace.notes[0].title,
  "First idea",
  "Planning an import never changes existing data",
);

const wrapped = portable.readPortableBundle(
  unpacked.map((file) => ({ ...file, path: `Exported folder/${file.path}` })),
);
assert.equal(wrapped.noteTypes.length, 1);
assert.equal(wrapped.notes[0].path, "Planning/First idea.md");
const generic = portable.readPortableBundle([
  {
    path: "Planning/Week.md",
    bytes: encoder.encode(
      "---\ntitle: Weekly plan\ntags:\n  - planning\n  - personal\nrating: 5\n---\n[Read](../Reference/Facts.md#details) and ![[../photos/reference.png]].",
    ),
  },
  {
    path: "Reference/Facts.md",
    bytes: encoder.encode("# Details\n\nKeep useful information."),
  },
  { path: "photos/reference.png", bytes: new Uint8Array([3, 2, 1]) },
]);
const genericIds = new Map(
  [
    ...generic.notes.map((note) => note.path),
    ...generic.attachments.map((file) => file.path),
  ].map((key, index) => [key, `generic_${index}`]),
);
const genericPlan = portable.planPortableImport(
  generic,
  createSeedWorkspace(),
  "",
  genericIds,
  now,
);
assert(genericPlan.notes[0].content.includes("[[Facts#details|Read]]"));
assert(
  genericPlan.notes[0].content.includes(
    "![reference.png](/api/media/generic_2)",
  ),
);
assert.deepEqual(genericPlan.notes[0].tags, ["planning", "personal"]);
assert.equal(genericPlan.notes[0].properties.rating, "5");
assert.equal(genericPlan.notes[0].folder, "Planning");
const advanced = "---\nsettings:\n  nested: true\n---\nKeep all my content.";
const advancedBundle = portable.readPortableBundle([
  { path: "Advanced.md", bytes: encoder.encode(advanced) },
]);
assert.equal(advancedBundle.notes[0].body, advanced);
assert(
  advancedBundle.warnings.some((text) => text.includes("frontmatter is kept")),
);

for (const path of [
  "../secret.md",
  "/absolute.md",
  "C:/drive.md",
  "a/../../escape.md",
  "a\\escape.md",
  "__proto__",
  "CON.txt",
  "a/./note.md",
  "note.md ",
])
  assert.throws(() => portable.portablePath(path));
assert.throws(
  () =>
    portable.unpackPortableZip(
      zipSync({ "../escape.md": encoder.encode("unsafe") }),
    ),
  /relative folder/,
);
assert.throws(
  () =>
    portable.unpackPortableZip(
      zipSync({
        "One.md": encoder.encode("one"),
        "one.md": encoder.encode("two"),
      }),
    ),
  /case-colliding/,
);
assert.throws(
  () =>
    portable.readPortableBundle([
      { path: "Huge.md", bytes: encoder.encode("x".repeat(100001)) },
    ]),
  /100,000/,
);
assert.throws(
  () =>
    portable.readPortableBundle([
      { path: "Bad.md", bytes: new Uint8Array([0xff, 0xfe]) },
    ]),
  /UTF-8/,
);
assert.throws(
  () =>
    portable.readPortableBundle([
      { path: "asset.png", bytes: new Uint8Array([1]) },
    ]),
  /containing Markdown/,
);
const damaged = new Uint8Array(packed);
const header = new DataView(damaged.buffer);
const payloadOffset =
  30 + header.getUint16(26, true) + header.getUint16(28, true);
damaged[payloadOffset] ^= 1;
assert.throws(() => portable.unpackPortableZip(damaged), /damaged/);
const bomb = zipSync({ "Bomb.md": encoder.encode("small") });
const bombView = new DataView(bomb.buffer);
for (let index = 0; index < bomb.length - 46; index++)
  if (bombView.getUint32(index, true) === 0x02014b50) {
    bombView.setUint32(index + 24, 0x10000000, true);
    break;
  }
assert.throws(() => portable.unpackPortableZip(bomb), /size limit/);
const lyingSize = zipSync(
  { "Lying.md": encoder.encode("x".repeat(2_000_000)) },
  { level: 9 },
);
const lyingView = new DataView(lyingSize.buffer);
lyingView.setUint32(22, 1, true);
for (let index = 0; index < lyingSize.length - 46; index++)
  if (lyingView.getUint32(index, true) === 0x02014b50) {
    lyingView.setUint32(index + 24, 1, true);
    break;
  }
assert.throws(() => portable.unpackPortableZip(lyingSize), /expanded beyond/);
console.log(
  "PASS: Markdown folder/ZIP portability, metadata and attachment round trips, collision-safe links, deterministic retry archives, literal code, and bounded hostile archive rejection.",
);
