"use client";

import { useId, useMemo, useState } from "react";
import { ArrowRight, Bell, GitBranch, Repeat2 } from "lucide-react";
import type {
  RecurrenceRule,
  ReminderRule,
  Task,
  Workspace,
} from "../lib/types";
import {
  effectiveMilestoneId,
  taskChildrenProgress,
} from "../lib/planning-progress";
import { nextRecurrenceDate } from "../lib/recurrence";
import {
  isCalendarDate,
  localTimeZone,
  todayInZone,
  validTimeZone,
  wallTimeToInstant,
} from "../lib/reminder-time";
import { StatusIcon } from "./WorkspacePrimitives";
import "./task-planning-fields.css";

interface PlanningProps {
  task: Task;
  workspace: Workspace;
  onChange: (patch: Partial<Task>) => void;
  onOpenTask?: (id: string) => void;
}

/** Parent, milestone, and child progress fields share one planning group. */
export function TaskHierarchyFields({
  task,
  workspace,
  onChange,
  onOpenTask,
}: PlanningProps) {
  const parentOptions = useMemo(() => {
    const children = new Map<string, string[]>();
    for (const item of workspace.tasks) {
      if (!item.parentId) continue;
      const group = children.get(item.parentId) || [];
      group.push(item.id);
      children.set(item.parentId, group);
    }
    const excluded = new Set([task.id]);
    const pending = [...(children.get(task.id) || [])];
    while (pending.length) {
      const id = pending.pop()!;
      if (excluded.has(id)) continue;
      excluded.add(id);
      pending.push(...(children.get(id) || []));
    }
    return workspace.tasks.filter(
      (item) =>
        item.projectId === task.projectId &&
        !excluded.has(item.id) &&
        !item.recurrence &&
        (item.status !== "done" ||
          task.status === "done" ||
          item.id === task.parentId),
    );
  }, [workspace.tasks, task.id, task.projectId, task.status, task.parentId]);
  const project = workspace.projects.find((item) => item.id === task.projectId);
  const parent = workspace.tasks.find((item) => item.id === task.parentId);
  const children = workspace.tasks.filter((item) => item.parentId === task.id);
  const progress = taskChildrenProgress(workspace, task.id);
  const inherited =
    parent &&
    project?.milestones?.find(
      (item) => item.id === effectiveMilestoneId(workspace, parent),
    );
  return (
    <section
      className="task-hierarchy-fields"
      aria-label="Task hierarchy and milestone"
      data-tour="task-hierarchy"
    >
      <div className="task-meta-grid">
        <label>
          Parent task
          <select
            value={task.parentId || ""}
            onChange={(event) => onChange({ parentId: event.target.value })}
          >
            <option value="">No parent task</option>
            {task.parentId &&
              !parentOptions.some((item) => item.id === task.parentId) && (
                <option value={task.parentId} disabled>
                  Unavailable parent — choose another
                </option>
              )}
            {parentOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.key} · {item.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Milestone
          <select
            value={task.milestoneId || ""}
            disabled={!project}
            onChange={(event) => onChange({ milestoneId: event.target.value })}
          >
            <option value="">
              {inherited ? `Inherit: ${inherited.title}` : "No milestone"}
            </option>
            {task.milestoneId &&
              !project?.milestones?.some(
                (item) => item.id === task.milestoneId,
              ) && (
                <option value={task.milestoneId} disabled>
                  Unavailable milestone — choose another
                </option>
              )}
            {project?.milestones
              ?.filter((item) => !item.archived || item.id === task.milestoneId)
              .map((item) => (
                <option key={item.id} value={item.id} disabled={item.archived}>
                  {item.title}
                  {item.archived ? " (archived)" : ""}
                </option>
              ))}
          </select>
        </label>
      </div>
      <p className="task-planning-help">
        Progress counts tasks without children once. Child tasks can inherit
        their parent&apos;s milestone.
      </p>
      {parent && onOpenTask && (
        <button
          type="button"
          className="text-button task-parent-link"
          onClick={() => onOpenTask(parent.id)}
        >
          <ArrowRight size={15} aria-hidden="true" /> Open parent: {parent.key} ·{" "}
          {parent.title}
        </button>
      )}
      {children.length > 0 && (
        <div className="task-child-group">
          <h3>
            <GitBranch size={16} /> Child tasks{" "}
            <span>
              {progress.completed}/{progress.total} complete
            </span>
          </h3>
          <ul>
            {children.map((item) => (
              <li key={item.id}>
                <StatusIcon status={item.status} />
                {onOpenTask ? (
                  <button type="button" onClick={() => onOpenTask(item.id)}>
                    {item.key} · {item.title}
                  </button>
                ) : (
                  <span>
                    {item.key} · {item.title}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="task-planning-help">
            Finish the child tasks before completing this parent.
          </p>
        </div>
      )}
    </section>
  );
}

const commonZones = [
  "UTC",
  "Europe/Belgrade",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export function TaskScheduleOptions({
  task,
  workspace,
  onChange,
  onOpenTask,
}: PlanningProps) {
  const id = useId();
  const [defaultZone] = useState(localTimeZone);
  const [initialRepeatOpen] = useState(!!task.recurrence);
  const [initialReminderOpen] = useState(!!task.reminder);
  const hasChildren = workspace.tasks.some((item) => item.parentId === task.id);
  const rule = task.recurrence;
  const reminder = task.reminder;
  const next = rule
    ? nextRecurrenceDate(
        rule,
        task.dueDate || task.startDate || rule.anchorDate,
      )
    : null;
  const nextTask = workspace.tasks.find(
    (item) => item.id === task.recurrenceNextId,
  );
  const reminderInstant = reminder && wallTimeToInstant(reminder);
  const changeRule = (patch: Partial<RecurrenceRule>) => {
    if (rule) onChange({ recurrence: { ...rule, ...patch } });
  };
  const changeReminder = (patch: Partial<ReminderRule>) => {
    if (reminder) onChange({ reminder: { ...reminder, ...patch } });
  };
  return (
    <div className="task-schedule-options">
      <datalist id={`${id}-zones`}>
        {[...new Set([defaultZone, ...commonZones])].map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <details open={initialRepeatOpen} data-tour="recurrence">
        <summary>
          <Repeat2 size={16} />
          <span>Recurring task</span>
          <small>{rule ? "Enabled" : "Off"}</small>
        </summary>
        <div className="task-schedule-option-body">
          <p className="task-planning-help">
            Completing this task creates the next one. Missed dates are skipped;
            the schedule keeps its original calendar day.
          </p>
          {task.recurrenceNextId && (
            <div className="task-recurrence-successor">
              <p>
                The next occurrence was already created. Change or stop the
                schedule on that task.{!nextTask && " It may be in Trash."}
              </p>
              {nextTask && onOpenTask && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onOpenTask(nextTask.id)}
                >
                  Open next occurrence{" "}
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          <label className="task-option-toggle">
            <input
              type="checkbox"
              checked={!!rule}
              disabled={hasChildren || !!task.recurrenceNextId}
              onChange={(event) =>
                onChange({
                  recurrence: event.target.checked
                    ? {
                        frequency: "weekly",
                        interval: 1,
                        anchorDate:
                          task.dueDate ||
                          task.startDate ||
                          todayInZone(defaultZone),
                        timeZone: defaultZone,
                        untilDate: "",
                      }
                    : null,
                })
              }
            />{" "}
            Repeat this task
          </label>
          {hasChildren && (
            <p className="task-planning-help">
              A task with child tasks cannot repeat. Set a schedule on an
              individual child task instead.
            </p>
          )}
          {rule && (
            <fieldset
              className="task-repeat-fields"
              disabled={!!task.recurrenceNextId}
            >
              <div className="task-meta-grid">
                <label>
                  Repeat every
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={rule.interval}
                    onChange={(event) =>
                      changeRule({ interval: Number(event.target.value) || 1 })
                    }
                  />
                </label>
                <label>
                  Frequency
                  <select
                    value={rule.frequency}
                    onChange={(event) =>
                      changeRule({
                        frequency: event.target
                          .value as RecurrenceRule["frequency"],
                      })
                    }
                  >
                    <option value="daily">Days</option>
                    <option value="weekly">Weeks</option>
                    <option value="monthly">Months</option>
                  </select>
                </label>
              </div>
              <div className="task-meta-grid">
                <label>
                  Schedule start
                  <input
                    type="date"
                    value={rule.anchorDate}
                    onChange={(event) =>
                      changeRule({ anchorDate: event.target.value })
                    }
                  />
                </label>
                <label>
                  Repeat until (optional)
                  <input
                    type="date"
                    min={rule.anchorDate || undefined}
                    value={rule.untilDate || ""}
                    onChange={(event) =>
                      changeRule({ untilDate: event.target.value })
                    }
                  />
                </label>
              </div>
              <label className="task-time-zone">
                Recurrence time zone
                <input
                  list={`${id}-zones`}
                  value={rule.timeZone}
                  maxLength={100}
                  aria-invalid={!validTimeZone(rule.timeZone) || undefined}
                  onChange={(event) =>
                    changeRule({ timeZone: event.target.value })
                  }
                  placeholder="e.g. Europe/Belgrade"
                />
              </label>
              <p className="task-planning-help">
                Month-end schedules return to the original day after a shorter
                month.{" "}
                {next
                  ? `Next date if completed now: ${next}.`
                  : "No later date is available within this schedule."}
              </p>
            </fieldset>
          )}
        </div>
      </details>
      <details open={initialReminderOpen} data-tour="task-reminder">
        <summary>
          <Bell size={16} />
          <span>Reminder</span>
          <small>{reminder ? "Enabled" : "Off"}</small>
        </summary>
        <div className="task-schedule-option-body">
          <p className="task-planning-help">
            Reminders appear while the app is open or when you return. Times use
            the selected time zone.
          </p>
          <label className="task-option-toggle">
            <input
              type="checkbox"
              checked={!!reminder}
              onChange={(event) =>
                onChange({
                  reminder: event.target.checked
                    ? {
                        date:
                          task.dueDate ||
                          task.startDate ||
                          todayInZone(defaultZone),
                        time: "09:00",
                        timeZone: defaultZone,
                      }
                    : null,
                })
              }
            />{" "}
            Remind me about this task
          </label>
          {reminder && (
            <>
              <div className="task-meta-grid">
                <label>
                  Reminder date
                  <input
                    type="date"
                    value={reminder.date}
                    onChange={(event) =>
                      changeReminder({ date: event.target.value })
                    }
                  />
                </label>
                <label>
                  Reminder time
                  <input
                    type="time"
                    value={reminder.time}
                    onChange={(event) =>
                      changeReminder({ time: event.target.value })
                    }
                  />
                </label>
              </div>
              <label className="task-time-zone">
                Reminder time zone
                <input
                  list={`${id}-zones`}
                  value={reminder.timeZone}
                  maxLength={100}
                  aria-invalid={!validTimeZone(reminder.timeZone) || undefined}
                  onChange={(event) =>
                    changeReminder({ timeZone: event.target.value })
                  }
                  placeholder="e.g. Europe/Belgrade"
                />
              </label>
              <p className="task-planning-help">
                If the clock repeats an hour, the reminder uses its first
                occurrence. If the clock skips a time, choose another.
              </p>
              {!reminderInstant && (
                <p className="task-schedule-error" role="status">
                  Choose a valid date, time, and time zone. This local time may
                  be skipped by daylight saving.
                </p>
              )}
            </>
          )}
        </div>
      </details>
    </div>
  );
}

export function taskScheduleError(task: Task): string | null {
  const rule = task.recurrence;
  if (
    rule &&
    (!isCalendarDate(rule.anchorDate) ||
      !validTimeZone(rule.timeZone) ||
      !Number.isInteger(rule.interval) ||
      rule.interval < 1 ||
      rule.interval > 365 ||
      (rule.untilDate &&
        (!isCalendarDate(rule.untilDate) || rule.untilDate < rule.anchorDate)))
  )
    return "Choose a valid schedule start, interval, time zone, and end date.";
  if (task.reminder && !wallTimeToInstant(task.reminder))
    return "Choose a valid reminder date, time, and time zone. The clock may skip that local time during daylight saving.";
  return null;
}
