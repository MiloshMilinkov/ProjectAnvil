"use client";

import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Flag } from "lucide-react";
import type { Task } from "../lib/types";
import {
  addCalendarDays,
  calendarDayOrdinal,
  taskScheduleRange,
} from "../lib/task-scheduling";
import { scheduleDateLabel } from "./TaskSchedule";
import { Empty, StatusIcon } from "./WorkspacePrimitives";

const windowDays = 28;
const earliestWindow = "0001-01-01";
const latestWindow = "9999-12-04";
const boundWindow = (date: string) =>
  date < earliestWindow
    ? earliestWindow
    : date > latestWindow
      ? latestWindow
      : date;

export default function TaskTimeline({
  tasks,
  referenceDate,
  openTask,
}: {
  tasks: Task[];
  referenceDate: string;
  openTask: (id: string) => void;
}) {
  const [chosenStart, setChosenStart] = useState<string | null>(null);
  const anchor = boundWindow(chosenStart || addCalendarDays(referenceDate, -3));
  const anchorDay = calendarDayOrdinal(anchor)!;
  const days = Array.from({ length: windowDays }, (_, index) =>
    addCalendarDays(anchor, index),
  );
  const scheduled = tasks.flatMap((task) => {
    const range = taskScheduleRange(task);
    return range ? [{ task, range }] : [];
  });
  const moveWindow = (offset: number) => {
    const next = addCalendarDays(anchor, offset);
    if (next) setChosenStart(boundWindow(next));
  };

  return (
    <section className="panel timeline-panel" aria-label="Task timeline">
      <div className="timeline-controls" data-tour="task-schedule">
        <label>
          <span>Window starts</span>
          <input
            type="date"
            aria-label="Timeline window starts"
            min={earliestWindow}
            max={latestWindow}
            value={anchor}
            onChange={(event) => {
              if (calendarDayOrdinal(event.target.value) !== null)
                setChosenStart(boundWindow(event.target.value));
            }}
          />
        </label>
        <div
          className="timeline-window-actions"
          role="group"
          aria-label="Timeline navigation"
        >
          <button
            className="btn-icon"
            aria-label="Previous 28 days"
            disabled={anchor === earliestWindow}
            onClick={() => moveWindow(-windowDays)}
          >
            <ChevronLeft size={17} />
          </button>
          <button className="btn" onClick={() => setChosenStart(null)}>
            Today
          </button>
          <button
            className="btn-icon"
            aria-label="Next 28 days"
            disabled={anchor === latestWindow}
            onClick={() => moveWindow(windowDays)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
      {scheduled.length > 0 ? (
        <div
          className="timeline-scroll"
          tabIndex={0}
          role="region"
          aria-label="28-day task schedule. Scroll horizontally to see every date."
        >
          <div className="timeline-header">
            <span>Scheduled tasks</span>
            <div>
              {days.map((date) => (
                <span
                  key={date}
                  className={date === referenceDate ? "is-today" : ""}
                  title={date}
                >
                  <small>
                    {new Date(`${date}T12:00:00`).toLocaleDateString(
                      undefined,
                      { weekday: "narrow" },
                    )}
                  </small>
                  {Number(date.slice(-2))}
                </span>
              ))}
            </div>
          </div>
          {scheduled.map(({ task, range }) => {
            const first = calendarDayOrdinal(range.startDate)! - anchorDay;
            const last = calendarDayOrdinal(range.endDate)! - anchorDay;
            const visible = last >= 0 && first < windowDays;
            const clippedFirst = Math.max(0, first);
            const span = Math.min(windowDays - 1, last) - clippedFirst + 1;
            const description =
              range.kind === "start"
                ? `Planned start ${range.startDate}`
                : range.kind === "due"
                  ? `Due ${range.endDate}`
                  : `Planned start ${range.startDate}, due ${range.endDate}`;
            return (
              <div key={task.id} className="timeline-row">
                <button
                  onClick={() => openTask(task.id)}
                  title={`${task.title} · ${description}`}
                >
                  <StatusIcon status={task.status} />
                  <span>{task.title}</span>
                </button>
                <div className="timeline-track">
                  {days.map((date) => (
                    <i key={date} aria-hidden="true" />
                  ))}
                  {visible ? (
                    <button
                      className={`timeline-bar ${range.kind !== "range" || span < 3 ? "timeline-marker" : ""}`}
                      aria-label={`${task.key}: ${task.title}. ${description}`}
                      title={`${task.title} · ${description}`}
                      onClick={() => openTask(task.id)}
                      style={{
                        left: `${(clippedFirst / windowDays) * 100}%`,
                        width: `${(span / windowDays) * 100}%`,
                      }}
                    >
                      {range.kind === "range" && span >= 3 ? (
                        task.key
                      ) : range.kind === "due" ? (
                        <Flag size={13} aria-hidden="true" />
                      ) : (
                        <CalendarDays size={13} aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    <span className="timeline-outside">
                      {scheduleDateLabel(range.startDate, referenceDate)} ·
                      outside this window
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty
          title={
            tasks.length
              ? "No scheduled tasks in this view"
              : "No matching tasks"
          }
          text={
            tasks.length
              ? "Add a planned start or due date under Dates in the task editor."
              : "Adjust your filters to see scheduled work."
          }
        />
      )}
      <p className="timeline-foot" role="status">
        {scheduleDateLabel(days[0], referenceDate)} –{" "}
        {scheduleDateLabel(days[windowDays - 1], referenceDate)}. Ranges show
        planned start through due date; a single date appears as a marker.
        {tasks.length > scheduled.length &&
          ` ${tasks.length - scheduled.length} ${tasks.length - scheduled.length === 1 ? "task has" : "tasks have"} no dates.`}
      </p>
    </section>
  );
}
