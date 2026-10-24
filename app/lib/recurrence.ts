import type { RecurrenceRule } from "./types";
import { isCalendarDate, todayInZone, validTimeZone } from "./reminder-time";
import {
  addCalendarDays as shiftCalendarDate,
  calendarDayOrdinal,
} from "./task-scheduling";

export function calendarDayDifference(left: string, right: string): number {
  if (!isCalendarDate(left) || !isCalendarDate(right))
    throw new RangeError("Choose valid calendar dates.");
  return calendarDayOrdinal(left)! - calendarDayOrdinal(right)!;
}

export function addCalendarDays(date: string, days: number): string {
  if (!isCalendarDate(date) || !Number.isInteger(days))
    throw new RangeError("Choose a valid calendar date and whole days.");
  const result = shiftCalendarDate(date, days);
  if (!result || !isCalendarDate(result))
    throw new RangeError("The next date is outside the supported calendar.");
  return result;
}

/** Calendar recurrence is anchored to the original date, including month end. */
export function nextRecurrenceDate(
  rule: RecurrenceRule,
  occurrenceDate: string,
  now = new Date(),
): string | null {
  if (!Number.isFinite(now.getTime())) return null;
  if (
    !isCalendarDate(rule.anchorDate) ||
    !isCalendarDate(occurrenceDate) ||
    !validTimeZone(rule.timeZone) ||
    !Number.isInteger(rule.interval) ||
    rule.interval < 1 ||
    rule.interval > 365 ||
    !["daily", "weekly", "monthly"].includes(rule.frequency) ||
    (rule.untilDate && !isCalendarDate(rule.untilDate))
  )
    return null;
  const threshold = [todayInZone(rule.timeZone, now), occurrenceDate]
    .sort()
    .at(-1)!;
  let next: string;
  try {
    if (rule.frequency === "monthly") {
      const anchorYear = Number(rule.anchorDate.slice(0, 4));
      const anchorMonth = Number(rule.anchorDate.slice(5, 7)) - 1;
      const anchorDay = Number(rule.anchorDate.slice(8, 10));
      const thresholdMonth =
        Number(threshold.slice(0, 4)) * 12 + Number(threshold.slice(5, 7)) - 1;
      const anchorIndex = anchorYear * 12 + anchorMonth;
      let occurrence = Math.max(
        0,
        Math.floor((thresholdMonth - anchorIndex) / rule.interval),
      );
      const monthDate = (number: number) => {
        const month = anchorIndex + number * rule.interval;
        const year = Math.floor(month / 12);
        if (year > 9999) return null;
        const monthNumber = (month % 12) + 1;
        const first = `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}-01`;
        const boundary = new Date(`${first}T12:00:00Z`);
        boundary.setUTCMonth(boundary.getUTCMonth() + 1);
        boundary.setUTCDate(0);
        return `${first.slice(0, 8)}${String(Math.min(anchorDay, boundary.getUTCDate())).padStart(2, "0")}`;
      };
      const candidate = monthDate(occurrence);
      if (!candidate) return null;
      if (candidate > threshold) next = candidate;
      else {
        occurrence++;
        const following = monthDate(occurrence);
        if (!following) return null;
        next = following;
      }
    } else {
      const step = rule.interval * (rule.frequency === "weekly" ? 7 : 1);
      const occurrence = Math.max(
        0,
        Math.floor(calendarDayDifference(threshold, rule.anchorDate) / step) +
          1,
      );
      next = addCalendarDays(rule.anchorDate, occurrence * step);
    }
  } catch {
    return null;
  }
  return rule.untilDate && next > rule.untilDate ? null : next;
}
