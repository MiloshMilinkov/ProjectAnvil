import type { Task } from "./types";
import { wallTimeToInstant } from "./reminder-time";

export interface ReminderPreferences {
  dismissed: string[];
  snoozed: Record<string, number>;
}
export interface ScheduledReminder {
  task: Task;
  key: string;
  instant: number;
}
const instantCache = new Map<string, number | null>();

export function reminderKey(task: Task): string | null {
  const reminder = task.reminder;
  return reminder
    ? JSON.stringify([task.id, reminder.date, reminder.time, reminder.timeZone])
    : null;
}

export function parseReminderPreferences(input: unknown): ReminderPreferences {
  if (!input || typeof input !== "object")
    return { dismissed: [], snoozed: {} };
  const value = input as Partial<ReminderPreferences>;
  return {
    dismissed: Array.isArray(value.dismissed)
      ? value.dismissed
          .filter(
            (key): key is string => typeof key === "string" && key.length < 600,
          )
          .slice(-3000)
      : [],
    snoozed:
      value.snoozed &&
      typeof value.snoozed === "object" &&
      !Array.isArray(value.snoozed)
        ? Object.fromEntries(
            Object.entries(value.snoozed)
              .filter(
                ([key, time]) =>
                  key.length < 600 &&
                  typeof time === "number" &&
                  Number.isSafeInteger(time) &&
                  time > 0 &&
                  time <= 8_640_000_000_000_000,
              )
              .slice(-3000),
          )
        : {},
  };
}

/** Resolve wall times once per schedule, rather than on every reminder tick. */
export function scheduledReminders(
  tasks: Task[],
  personId: string,
): ScheduledReminder[] {
  const scheduled: ScheduledReminder[] = [];
  for (const task of tasks) {
    if (
      task.status === "done" ||
      (task.assigneeId && task.assigneeId !== personId)
    )
      continue;
    const key = reminderKey(task);
    if (!key || !task.reminder) continue;
    if (!instantCache.has(key)) {
      const instant = wallTimeToInstant(task.reminder);
      if (instantCache.size >= 3000)
        instantCache.delete(instantCache.keys().next().value!);
      instantCache.set(key, instant ? Date.parse(instant) : null);
    }
    const instant = instantCache.get(key);
    if (instant !== null && instant !== undefined && Number.isFinite(instant))
      scheduled.push({ task, key, instant });
  }
  return scheduled.sort(
    (a, b) => a.instant - b.instant || a.task.id.localeCompare(b.task.id),
  );
}

export function visibleReminders(
  scheduled: ScheduledReminder[],
  preferences: ReminderPreferences,
  now: number,
) {
  const dismissed = new Set(preferences.dismissed);
  return scheduled
    .filter((item) => !dismissed.has(item.key))
    .map((item) => ({
      ...item,
      at: preferences.snoozed[item.key] || item.instant,
    }))
    .map((item) => ({ ...item, due: item.at <= now }))
    .sort((a, b) => a.at - b.at || a.task.id.localeCompare(b.task.id));
}

export function pruneReminderPreferences(
  preferences: ReminderPreferences,
  tasks: Task[],
): ReminderPreferences {
  const keys = new Set(
    tasks.map(reminderKey).filter((key): key is string => !!key),
  );
  return {
    dismissed: [...new Set(preferences.dismissed)].filter((key) =>
      keys.has(key),
    ),
    snoozed: Object.fromEntries(
      Object.entries(preferences.snoozed).filter(([key]) => keys.has(key)),
    ),
  };
}
