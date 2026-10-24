const assert = require("node:assert/strict");
const {
  nextRecurrenceDate,
  addCalendarDays,
  calendarDayDifference,
} = require("./compiled/app/lib/recurrence");
const {
  wallTimeToInstant,
  todayInZone,
  validTimeZone,
  isCalendarDate,
} = require("./compiled/app/lib/reminder-time");
const { parseRecoverableTask } = require("./compiled/app/lib/task-drafts");
const { duplicateTask } = require("./compiled/app/lib/task-copy");
const {
  taskTemplateContent,
  instantiateTaskTemplate,
} = require("./compiled/app/lib/personal-templates");
const daily = {
  frequency: "daily",
  interval: 1,
  anchorDate: "2026-10-20",
  timeZone: "Europe/Belgrade",
};
const next = (rule, occurrence, now) =>
  nextRecurrenceDate(rule, occurrence, new Date(now));
assert.equal(next(daily, "2026-10-20", "2026-10-24T12:00:00Z"), "2026-10-25");
assert.equal(
  next(
    { ...daily, frequency: "weekly", anchorDate: "2026-10-19" },
    "2026-10-19",
    "2026-10-24T12:00:00Z",
  ),
  "2026-10-26",
);
assert.equal(
  next(
    { ...daily, frequency: "weekly", interval: 2, anchorDate: "2026-10-19" },
    "2026-10-19",
    "2026-10-24T12:00:00Z",
  ),
  "2026-11-02",
);
const monthly = { ...daily, frequency: "monthly", anchorDate: "2027-01-31" };
assert.equal(next(monthly, "2027-01-31", "2027-01-31T12:00:00Z"), "2027-02-28");
assert.equal(next(monthly, "2027-02-28", "2027-02-28T12:00:00Z"), "2027-03-31");
assert.equal(
  next({ ...monthly, interval: 2 }, "2027-01-31", "2027-01-31T12:00:00Z"),
  "2027-03-31",
);
assert.equal(
  next(
    { ...monthly, anchorDate: "2028-01-31" },
    "2028-01-31",
    "2028-01-31T12:00:00Z",
  ),
  "2028-02-29",
);
const yearlyLeap = { ...monthly, interval: 12, anchorDate: "2028-02-29" };
assert.equal(
  next(yearlyLeap, "2028-02-29", "2028-02-29T12:00:00Z"),
  "2029-02-28",
);
assert.equal(
  next(yearlyLeap, "2031-02-28", "2031-02-28T12:00:00Z"),
  "2032-02-29",
);
assert.equal(
  next(
    { ...monthly, untilDate: "2027-02-27" },
    "2027-01-31",
    "2027-01-31T12:00:00Z",
  ),
  null,
);
assert.equal(
  next(
    { ...monthly, untilDate: "2027-02-28" },
    "2027-01-31",
    "2027-01-31T12:00:00Z",
  ),
  "2027-02-28",
);
assert.equal(
  next(
    { ...daily, anchorDate: "2027-03-01" },
    "2026-10-20",
    "2026-10-24T12:00:00Z",
  ),
  "2027-03-01",
);
assert.equal(
  next(
    { ...monthly, anchorDate: "9999-12-31" },
    "9999-12-31",
    "9999-12-31T12:00:00Z",
  ),
  null,
);
assert.equal(
  next({ ...daily, interval: 0 }, "2026-10-20", "2026-10-24T12:00:00Z"),
  null,
);
assert.equal(
  next(
    { ...daily, timeZone: "Unknown/Nowhere" },
    "2026-10-20",
    "2026-10-24T12:00:00Z",
  ),
  null,
);
assert.equal(
  todayInZone("America/New_York", new Date("2026-03-08T04:30:00Z")),
  "2026-03-07",
);
assert.equal(
  next(
    { ...daily, anchorDate: "2026-03-07", timeZone: "America/New_York" },
    "2026-03-07",
    "2026-03-08T04:30:00Z",
  ),
  "2026-03-08",
);
assert.equal(addCalendarDays("2026-03-28", 1), "2026-03-29");
assert.equal(addCalendarDays("2026-10-24", 1), "2026-10-25");
assert.equal(calendarDayDifference("2026-03-30", "2026-03-28"), 2);
assert.equal(calendarDayDifference("2026-03-28", "2026-03-30"), -2);
assert.throws(() => addCalendarDays("9999-12-31", 1), RangeError);
assert.equal(validTimeZone("Europe/Belgrade"), true);
assert.equal(validTimeZone("Not a zone"), false);
assert.equal(isCalendarDate("2028-02-29"), true);
assert.equal(isCalendarDate("2027-02-29"), false);
assert.equal(isCalendarDate("0000-01-01"), false);
const instant = (date, time, timeZone) =>
  wallTimeToInstant({ date, time, timeZone });
assert.equal(
  instant("2026-03-28", "09:00", "Europe/Belgrade"),
  "2026-03-28T08:00:00.000Z",
);
assert.equal(
  instant("2026-03-29", "09:00", "Europe/Belgrade"),
  "2026-03-29T07:00:00.000Z",
);
assert.equal(instant("2026-03-29", "02:30", "Europe/Belgrade"), null);
assert.equal(
  instant("2026-10-25", "02:30", "Europe/Belgrade"),
  "2026-10-25T00:30:00.000Z",
);
assert.equal(instant("2026-03-08", "02:30", "America/New_York"), null);
assert.equal(
  instant("2026-11-01", "01:30", "America/New_York"),
  "2026-11-01T05:30:00.000Z",
);
assert.equal(
  instant("2026-10-24", "09:00", "Asia/Kathmandu"),
  "2026-10-24T03:15:00.000Z",
);
assert.equal(instant("2026-10-24", "24:00", "UTC"), null);
assert.equal(instant("2026-02-30", "09:00", "UTC"), null);
assert.equal(instant("2026-10-24", "09:00", "Unknown/Nowhere"), null);
assert.equal(instant("9999-12-31", "23:59", "UTC"), "9999-12-31T23:59:00.000Z");
assert.equal(instant("0001-01-01", "00:00", "UTC"), "0001-01-01T00:00:00.000Z");
// Repeated lookups must preserve the single earlier instant from the cache.
assert.equal(
  instant("2026-11-01", "01:30", "America/New_York"),
  "2026-11-01T05:30:00.000Z",
);
const task = {
  id: "old",
  key: "P-1",
  title: "Routine",
  description: "Review",
  projectId: "p",
  assigneeId: "",
  status: "todo",
  priority: "medium",
  type: "task",
  startDate: "",
  dueDate: "",
  estimate: 1,
  tags: [],
  noteIds: [],
  blockedBy: [],
  subtasks: [],
  comments: [],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};
const legacy = parseRecoverableTask(task);
assert.equal(legacy.parentId, "");
assert.equal(legacy.milestoneId, "");
assert.equal(legacy.recurrence, null);
assert.equal(legacy.reminder, null);
const configured = {
  ...task,
  parentId: "parent",
  milestoneId: "m",
  recurrence: daily,
  reminder: { date: "2026-10-24", time: "09:00", timeZone: "Europe/Belgrade" },
  recurrenceNextId: "next",
  recurringFromId: "previous",
};
assert.equal(parseRecoverableTask(configured).reminder.time, "09:00");
assert.equal(
  parseRecoverableTask({ ...task, recurrence: { interval: 1 } }),
  null,
);
assert.equal(
  parseRecoverableTask({ ...task, reminder: { time: "09:00" } }),
  null,
);
const copy = duplicateTask(configured, {
  projects: [{ id: "p", milestones: [{ id: "m", archived: false }] }],
  notes: [],
});
assert.equal(copy.parentId, "");
assert.equal(copy.milestoneId, "m");
for (const field of [
  "recurrence",
  "reminder",
  "recurrenceNextId",
  "recurringFromId",
])
  assert.equal(copy[field], undefined);
const template = taskTemplateContent(configured);
const templated = instantiateTaskTemplate(template);
for (const field of [
  "parentId",
  "milestoneId",
  "recurrence",
  "reminder",
  "recurrenceNextId",
  "recurringFromId",
])
  assert.equal(templated[field], undefined);
console.log(
  `PASS: anchored recurrence, month/leap boundaries, skipped dates, time zones, DST gaps/repeated hours, recoverable planning drafts and clean copies (${process.env.TZ || "system"}).`,
);
