import type { DateFilter, Priority, Task, TaskSort } from "./types";

export type { DateFilter, TaskSort } from "./types";

export const dateFilterOptions: { id: DateFilter; label: string }[] = [
  { id: "all", label: "All dates" },
  { id: "due-today", label: "Due today" },
  { id: "overdue", label: "Overdue" },
  { id: "due-next-7-days", label: "Due next 7 days" },
  { id: "no-due-date", label: "No due date" },
  { id: "start-today", label: "Starts today" },
  { id: "start-next-7-days", label: "Starts next 7 days" },
  { id: "no-start-date", label: "No planned start" },
];

export const taskSortOptions: { id: TaskSort; label: string }[] = [
  { id: "priority", label: "Priority" },
  { id: "due-date", label: "Due date" },
  { id: "start-date", label: "Planned start" },
  { id: "updated", label: "Recently updated" },
];

const millisecondsPerDay = 86_400_000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

/** Convert a date-only value to a day number without local daylight-saving offsets. */
export function calendarDayOrdinal(value: string): number | null {
  if (!datePattern.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    return null;
  return Math.floor(parsed.getTime() / millisecondsPerDay);
}

/** Calendar arithmetic for date-only fields. Invalid or out-of-range dates stay empty. */
export function addCalendarDays(value: string, days: number): string {
  const ordinal = calendarDayOrdinal(value);
  if (ordinal === null || !Number.isInteger(days)) return "";
  const result = new Date((ordinal + days) * millisecondsPerDay);
  if (!Number.isFinite(result.getTime())) return "";
  const key = result.toISOString().slice(0, 10);
  return datePattern.test(key) ? key : "";
}

type DatedTask = Pick<Task, "dueDate" | "status"> & { startDate?: string };

/** Next seven days includes today and the following six local calendar dates. */
export function matchesTaskDate(
  task: DatedTask,
  filter: DateFilter,
  referenceDate: string,
): boolean {
  if (filter === "all") return true;
  if (filter === "no-due-date") return !task.dueDate;
  if (filter === "no-start-date") return !task.startDate;

  const reference = calendarDayOrdinal(referenceDate);
  if (reference === null) return false;
  const value = filter.startsWith("start-") ? task.startDate : task.dueDate;
  const ordinal = value ? calendarDayOrdinal(value) : null;
  if (ordinal === null) return false;

  switch (filter) {
    case "overdue":
      return task.status !== "done" && ordinal < reference;
    case "due-today":
    case "start-today":
      return ordinal === reference;
    case "due-next-7-days":
    case "start-next-7-days":
      return ordinal >= reference && ordinal <= reference + 6;
  }
}

const priorityOrder: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};
type SortableTask = Pick<
  Task,
  "id" | "key" | "priority" | "dueDate" | "updatedAt"
> & { startDate?: string };

function compareNumbers(left: number, right: number): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function lastUpdated(task: SortableTask): number {
  const timestamp = Date.parse(task.updatedAt);
  return Number.isFinite(timestamp) ? timestamp : -Infinity;
}

const taskKeyOrder = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function sortRank(task: SortableTask, sort: TaskSort): number {
  switch (sort) {
    case "due-date":
      return calendarDayOrdinal(task.dueDate) ?? Infinity;
    case "start-date":
      return calendarDayOrdinal(task.startDate || "") ?? Infinity;
    case "updated":
      return -lastUpdated(task);
    case "priority":
      return priorityOrder[task.priority];
  }
}

/** Return a sorted copy. Undated tasks follow dated tasks; ties remain deterministic. */
export function sortTasks<T extends SortableTask>(
  tasks: readonly T[],
  sort: TaskSort,
): T[] {
  // Parse each date once rather than on every comparison in a large task list.
  return tasks
    .map((task) => ({ task, rank: sortRank(task, sort) }))
    .sort(
      (left, right) =>
        compareNumbers(left.rank, right.rank) ||
        taskKeyOrder.compare(left.task.key, right.task.key) ||
        left.task.id.localeCompare(right.task.id, "en"),
    )
    .map(({ task }) => task);
}

export type TaskScheduleRange = {
  startDate: string;
  endDate: string;
  kind: "range" | "start" | "due";
};

/** A single known date is a one-day marker; effort estimates never imply duration. */
export function taskScheduleRange(
  task: Pick<Task, "dueDate"> & { startDate?: string },
): TaskScheduleRange | null {
  const start = task.startDate || "";
  const due = task.dueDate;
  if (
    (start && calendarDayOrdinal(start) === null) ||
    (due && calendarDayOrdinal(due) === null) ||
    (start && due && start > due)
  )
    return null;
  if (start && due) return { startDate: start, endDate: due, kind: "range" };
  if (start) return { startDate: start, endDate: start, kind: "start" };
  if (due) return { startDate: due, endDate: due, kind: "due" };
  return null;
}
