const assert = require("node:assert/strict");
const {
  savedViewConfig,
  matchesSavedView,
} = require("./compiled/app/lib/saved-view-config");
const legacy = {
  id: "old",
  name: "Older board",
  query: "review",
  assignee: "",
  priority: "high",
  project: "",
  status: "",
};
const config = savedViewConfig(legacy);
assert.equal(config.layout, "board");
assert.equal(config.dateFilter, "all");
assert.equal(config.sort, "priority");
assert.equal(matchesSavedView(legacy, config), true);
assert.equal(matchesSavedView(legacy, { ...config, layout: "list" }), false);
assert.equal(
  matchesSavedView(legacy, { ...config, dateFilter: "overdue" }),
  false,
);
assert.equal(
  matchesSavedView(legacy, { ...config, sort: "start-date" }),
  false,
);
assert.equal(matchesSavedView({ ...legacy, name: "Renamed" }, config), true);
assert.equal(Object.hasOwn(config, "id"), false);
assert.equal(Object.hasOwn(config, "name"), false);
assert.equal(Object.hasOwn(legacy, "layout"), false);
console.log(
  "PASS: legacy saved views retain their board, schedules/sort/layout detect unsaved changes, rename preserves configuration.",
);
