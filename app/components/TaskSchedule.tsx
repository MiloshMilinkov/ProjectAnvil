"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Flag } from "lucide-react";
import { today, type Task } from "../lib/types";

/** Refresh local calendar boundaries even when workspace polling returns no changes. */
export function useCalendarToday(): string {
  const [date, setDate] = useState(today);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      setDate(today());
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 25);
      clearTimeout(timer);
      timer = setTimeout(
        refresh,
        Math.min(60_000, midnight.getTime() - now.getTime()),
      );
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return date;
}

export function scheduleDateLabel(
  value: string,
  referenceDate: string,
): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(value.slice(0, 4) !== referenceDate.slice(0, 4)
      ? { year: "numeric" }
      : {}),
  });
}

export function TaskDates({
  task,
  referenceDate,
}: {
  task: Pick<Task, "startDate" | "dueDate" | "status">;
  referenceDate: string;
}) {
  const overdue =
    task.status !== "done" && task.dueDate && task.dueDate < referenceDate;
  return (
    <span className="task-dates">
      {task.startDate && (
        <span
          className="task-date-line"
          title={`Planned start: ${task.startDate}`}
        >
          <CalendarDays size={13} aria-hidden="true" />
          <span>
            Start{" "}
            <time dateTime={task.startDate}>
              {scheduleDateLabel(task.startDate, referenceDate)}
            </time>
          </span>
        </span>
      )}
      {task.dueDate && (
        <span
          className={`task-date-line due-date ${overdue ? "overdue" : ""}`}
          title={`Due date: ${task.dueDate}${overdue ? " · Overdue" : ""}`}
        >
          <Flag size={13} aria-hidden="true" />
          <span>
            {overdue ? "Overdue · " : "Due "}
            <time dateTime={task.dueDate}>
              {scheduleDateLabel(task.dueDate, referenceDate)}
            </time>
          </span>
        </span>
      )}
      {!task.startDate && !task.dueDate && <span>No dates</span>}
    </span>
  );
}
