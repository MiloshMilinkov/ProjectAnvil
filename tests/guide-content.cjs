const assert = require("node:assert/strict");
const {
  tourSteps,
  quickStartGuide,
  topicGuides,
  guideCatalog,
  findGuides,
} = require("./compiled/app/lib/guide-content");

assert.equal(
  quickStartGuide.steps.length,
  8,
  "First-time help stays a short essentials journey",
);
assert.equal(topicGuides.length, 9);
assert.equal(tourSteps.length, 58);
assert.equal(
  new Set(guideCatalog.map((guide) => guide.id)).size,
  guideCatalog.length,
);
const detailIds = topicGuides.flatMap((guide) =>
  guide.steps.map((step) => step.id),
);
assert.equal(
  detailIds.length,
  tourSteps.length,
  "No detailed explanation is silently dropped or duplicated",
);
assert.equal(new Set(detailIds).size, tourSteps.length);
assert.deepEqual(
  [...detailIds].sort(),
  tourSteps.map((step) => step.id).sort(),
);
for (const guide of guideCatalog) {
  assert.ok(guide.title && guide.description);
  assert.ok(
    guide.steps.length >= 2 && guide.steps.length <= 10,
    "Focused guides remain bounded",
  );
  for (const step of guide.steps)
    assert.ok(
      step.id && step.page && step.title && step.body && step.anchors.length,
    );
}
const order = guideCatalog.map((guide) => guide.id);
assert.deepEqual(
  findGuides(" ").map((guide) => guide.id),
  order,
);
assert.ok(
  findGuides("  MARKDOWN PORTABILITY  ").some(
    (guide) => guide.id === "portability",
  ),
);
assert.ok(
  findGuides("milestones").some((guide) => guide.id === "projects"),
  "Feature text is searchable even when it is not the topic title",
);
assert.ok(findGuides("conflict").some((guide) => guide.id === "offline"));
assert.ok(findGuides("Account security").length > 0);
assert.ok(findGuides("Forgot password").length > 0);
assert.deepEqual(findGuides("nonexistent-feature-97f732"), []);
assert.deepEqual(
  guideCatalog.map((guide) => guide.id),
  order,
  "Search leaves the catalogue order intact",
);
console.log(
  "Guide coverage, concise onboarding, and topic search checks passed.",
);
