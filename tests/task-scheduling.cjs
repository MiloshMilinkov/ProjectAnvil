const assert = require("node:assert/strict");
const {
  addCalendarDays,
  calendarDayOrdinal,
  dateFilterOptions,
  matchesTaskDate,
  sortTasks,
  taskScheduleRange,
  taskSortOptions,
} = require("./compiled/app/lib/task-scheduling");
const { taskDateFilters, taskSorts } = require("./compiled/app/lib/types");

const task = (overrides = {}) => ({
  id: "task-1",
  key: "TASK-1",
  priority: "medium",
  status: "todo",
  dueDate: "",
  startDate: "",
  updatedAt: "2026-10-21T12:00:00.000Z",
  ...overrides,
});

assert.deepEqual(
  dateFilterOptions.map((option) => option.id),
  [...taskDateFilters],
);
assert.deepEqual(
  taskSortOptions.map((option) => option.id),
  [...taskSorts],
);

// Strict calendar dates reject rollover and malformed values while preserving leap days.
assert.equal(calendarDayOrdinal(""), null);
assert.equal(calendarDayOrdinal("2026-2-01"), null);
assert.equal(calendarDayOrdinal("2026-02-31"), null);
assert.equal(calendarDayOrdinal("2026-02-29"), null);
assert.equal(
  calendarDayOrdinal("2028-02-29") + 1,
  calendarDayOrdinal("2028-03-01"),
);
assert.equal(addCalendarDays("2028-02-28", 1), "2028-02-29");
assert.equal(addCalendarDays("2028-02-29", 1), "2028-03-01");
assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
assert.equal(addCalendarDays("2026-01-01", -1), "2025-12-31");
assert.equal(addCalendarDays("2026-02-31", 1), "");
assert.equal(addCalendarDays("2026-10-21", 0.5), "");
assert.equal(addCalendarDays("9999-12-31", 1), "");

// Adjacent local date keys remain one day apart across both DST changes.
for (const [before, after] of [
  ["2026-03-28", "2026-03-29"],
  ["2026-03-29", "2026-03-30"],
  ["2026-10-24", "2026-10-25"],
  ["2026-10-25", "2026-10-26"],
  ["2026-03-07", "2026-03-08"],
  ["2026-11-01", "2026-11-02"],
]) {
  assert.equal(calendarDayOrdinal(after) - calendarDayOrdinal(before), 1);
  assert.equal(addCalendarDays(before, 1), after);
}

const reference = "2026-10-21";
assert.equal(matchesTaskDate(task(), "all", reference), true);
assert.equal(matchesTaskDate(task(), "due-today", reference), false);
assert.equal(matchesTaskDate(task(), "start-today", reference), false);
assert.equal(matchesTaskDate(task(), "overdue", reference), false);
assert.equal(matchesTaskDate(task(), "no-due-date", reference), true);
assert.equal(
  matchesTaskDate(task({ startDate: undefined }), "no-start-date", reference),
  true,
);
assert.equal(
  matchesTaskDate(task({ dueDate: reference }), "due-today", reference),
  true,
);
assert.equal(
  matchesTaskDate(task({ startDate: reference }), "start-today", reference),
  true,
);
assert.equal(
  matchesTaskDate(task({ dueDate: "2026-10-20" }), "overdue", reference),
  true,
);
assert.equal(
  matchesTaskDate(task({ dueDate: reference }), "overdue", reference),
  false,
);
assert.equal(
  matchesTaskDate(
    task({ dueDate: "2026-10-20", status: "done" }),
    "overdue",
    reference,
  ),
  false,
  "Finished tasks are not overdue",
);
assert.equal(
  matchesTaskDate(
    task({ dueDate: reference, status: "done" }),
    "due-today",
    reference,
  ),
  true,
  "Date filters remain composable with the separate status filter",
);
assert.equal(
  matchesTaskDate(task({ dueDate: reference }), "due-today", "invalid"),
  false,
);

// The rolling window includes today plus six dates, never yesterday or the eighth date.
for (const [date, expected] of [
  ["2026-10-20", false],
  ["2026-10-21", true],
  ["2026-10-27", true],
  ["2026-10-28", false],
]) {
  assert.equal(
    matchesTaskDate(task({ dueDate: date }), "due-next-7-days", reference),
    expected,
  );
  assert.equal(
    matchesTaskDate(task({ startDate: date }), "start-next-7-days", reference),
    expected,
  );
}
assert.equal(
  matchesTaskDate(
    task({ dueDate: "2027-01-03" }),
    "due-next-7-days",
    "2026-12-29",
  ),
  true,
);
assert.equal(
  matchesTaskDate(
    task({ dueDate: "2027-01-05" }),
    "due-next-7-days",
    "2026-12-29",
  ),
  false,
);

const items = [
  task({
    id: "ten",
    key: "TASK-10",
    priority: "low",
    updatedAt: "2026-10-20T12:00:00Z",
  }),
  task({
    id: "two",
    key: "TASK-2",
    priority: "high",
    dueDate: "2026-10-23",
    startDate: "2026-10-21",
  }),
  task({
    id: "one",
    key: "TASK-1",
    priority: "high",
    dueDate: "2026-10-22",
    startDate: "2026-10-20",
    updatedAt: "2026-10-22T12:00:00Z",
  }),
  task({
    id: "three",
    key: "TASK-3",
    priority: "urgent",
    dueDate: "2026-10-22",
    updatedAt: "invalid",
  }),
];
const originalIds = items.map((item) => item.id);
const ids = (sort) => sortTasks(items, sort).map((item) => item.id);
assert.deepEqual(ids("priority"), ["three", "one", "two", "ten"]);
assert.deepEqual(ids("due-date"), ["one", "three", "two", "ten"]);
assert.deepEqual(ids("start-date"), ["one", "two", "three", "ten"]);
assert.deepEqual(ids("updated"), ["one", "two", "ten", "three"]);
assert.deepEqual(
  items.map((item) => item.id),
  originalIds,
  "Sorting never mutates workspace records",
);
assert.deepEqual(
  sortTasks(
    [task({ id: "ten", key: "TASK-10" }), task({ id: "two", key: "TASK-2" })],
    "priority",
  ).map((item) => item.key),
  ["TASK-2", "TASK-10"],
  "Natural task-number ordering makes ties predictable",
);
assert.deepEqual(
  sortTasks([task({ id: "b" }), task({ id: "a" })], "due-date").map(
    (item) => item.id,
  ),
  ["a", "b"],
  "Missing dates and duplicate task keys still have stable ordering",
);

assert.equal(taskScheduleRange(task()), null);
assert.deepEqual(
  taskScheduleRange(task({ dueDate: reference, estimate: 99 })),
  {
    startDate: reference,
    endDate: reference,
    kind: "due",
  },
);
assert.deepEqual(taskScheduleRange(task({ startDate: reference })), {
  startDate: reference,
  endDate: reference,
  kind: "start",
});
assert.deepEqual(
  taskScheduleRange(task({ startDate: "2026-10-20", dueDate: reference })),
  {
    startDate: "2026-10-20",
    endDate: reference,
    kind: "range",
  },
);
assert.equal(
  taskScheduleRange(task({ startDate: "2026-10-23", dueDate: reference })),
  null,
);
assert.equal(taskScheduleRange(task({ dueDate: "2026-02-31" })), null);

console.log(
  `Task date filters, sorting, and calendar range checks passed (${process.env.TZ})`,
);
