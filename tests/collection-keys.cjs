const assert = require("node:assert/strict");
const {
  collectionTypeName,
  groupCollectionItems,
  normalizeCollectionKeys,
  storedCollectionColumns,
  structuredPropertyKey,
} = require("./compiled/app/lib/collection-keys");

const uuid = "353a9fce-1cbd-40ae-9e04-dba74f603698";
const shortKey = structuredPropertyKey("type", "field");
const uuidKey = structuredPropertyKey(uuid, uuid);
const longestKey = structuredPropertyKey("a".repeat(120), "b".repeat(120));
assert.ok(
  shortKey.length > 80,
  "Even short imported IDs cannot collide with a freeform property",
);
assert.equal(longestKey.length, 321);
assert.deepEqual(
  storedCollectionColumns([uuidKey, longestKey, uuidKey, "Ordinary"], true),
  [uuidKey, longestKey, "Ordinary"],
);
assert.deepEqual(
  storedCollectionColumns([uuidKey, "Ordinary"], false),
  ["Ordinary"],
  "Freeform names retain their 80-character bound",
);
assert.equal(
  storedCollectionColumns(
    Array.from({ length: 70 }, (_, index) => `key${index}`),
    true,
  ).length,
  50,
);
assert.deepEqual(
  storedCollectionColumns(["x".repeat(401), null, 6, ""], true),
  [],
);

const types = [
  {
    id: "type",
    name: "Research",
    fields: [{ id: "field", name: "Confidence" }],
  },
];
const legacy = "structured:type:field";
const preferences = {
  columns: [legacy, "Ordinary"],
  sort: `prop:${legacy}`,
  group: `prop:${legacy}`,
  summaryProperty: legacy,
  layout: "table",
};
assert.deepEqual(normalizeCollectionKeys(preferences, types, []), {
  ...preferences,
  columns: [shortKey, "Ordinary"],
  sort: `prop:${shortKey}`,
  group: `prop:${shortKey}`,
  summaryProperty: shortKey,
});
assert.deepEqual(
  normalizeCollectionKeys(preferences, types, [legacy]),
  preferences,
  "An actual freeform property keeps its value and selection when a legacy key collides",
);
assert.deepEqual(
  normalizeCollectionKeys(
    {
      ...preferences,
      columns: [shortKey],
      sort: `prop:${shortKey}`,
      group: "kind",
      summaryProperty: shortKey,
    },
    types,
    [legacy],
  ).columns,
  [shortKey],
);
assert.equal(
  collectionTypeName("Research", ["note", "research"]),
  "Research (custom)",
);
assert.equal(
  collectionTypeName("My research", ["note", "research"]),
  "My research",
);
const rows = [
  { id: "later-b", group: "Beta" },
  { id: "first-a", group: "Alpha" },
  { id: "empty", group: "" },
  { id: "second-a", group: "Alpha" },
  { id: "literal-empty", group: "Unspecified" },
];
let groupReads = 0;
const original = JSON.stringify(rows);
assert.deepEqual(
  groupCollectionItems(rows, (row) => {
    groupReads++;
    return row.group;
  }),
  [
    { name: "Alpha", notes: [rows[1], rows[3]] },
    { name: "Beta", notes: [rows[0]] },
    { name: "Unspecified", notes: [rows[2], rows[4]] },
  ],
);
assert.equal(
  groupReads,
  rows.length,
  "Grouping reads each value once, including distinct-group workloads",
);
assert.equal(
  JSON.stringify(rows),
  original,
  "Grouping preserves original records and their order",
);
assert.deepEqual(
  groupCollectionItems([], () => "never"),
  [],
);
const manyGroups = Array.from({ length: 1000 }, (_, index) => ({
  id: index,
  group: `group-${index}`,
}));
groupReads = 0;
assert.equal(
  groupCollectionItems(manyGroups, (row) => {
    groupReads++;
    return row.group;
  }).length,
  1000,
);
assert.equal(groupReads, 1000);
console.log(
  "PASS: structured collection keys, legacy selections, distinct type labels, stable groups, and linear group lookups.",
);
