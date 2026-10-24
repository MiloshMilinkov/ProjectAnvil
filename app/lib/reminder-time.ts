import type { ReminderRule } from "./types";

const formatters = new Map<string, Intl.DateTimeFormat>();
const resolvedInstants = new Map<string, string | null>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const existing = formatters.get(timeZone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  // User-entered zones must not grow an unbounded process-wide cache.
  if (formatters.size >= 100)
    formatters.delete(formatters.keys().next().value!);
  formatters.set(timeZone, created);
  return created;
}

export function validTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 100) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000"))
    return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function localParts(instant: Date, timeZone: string) {
  const parts: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return {
    date: `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    second: parts.second,
  };
}

export function todayInZone(timeZone: string, now = new Date()): string {
  return localParts(now, timeZone).date;
}

/**
 * Resolve a wall-clock reminder without depending on the host computer's zone.
 * A skipped spring-forward time returns null. A repeated fall-back time uses
 * its earlier instant, so one reminder never fires twice in the repeated hour.
 */
export function wallTimeToInstant(reminder: ReminderRule): string | null {
  const { date, time, timeZone } = reminder;
  if (
    !isCalendarDate(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
    !validTimeZone(timeZone)
  )
    return null;
  const key = `${date}|${time}|${timeZone}`;
  if (resolvedInstants.has(key)) return resolvedInstants.get(key)!;
  const localEpoch = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set<number>();
  for (const hours of [-48, -24, -12, 0, 12, 24, 48]) {
    const sample = new Date(localEpoch + hours * 3_600_000);
    if (sample.getUTCFullYear() < 1 || sample.getUTCFullYear() > 9999) continue;
    const local = localParts(sample, timeZone);
    const offset =
      Date.parse(`${local.date}T${local.time}:${local.second}Z`) -
      sample.getTime();
    if (Number.isFinite(offset)) offsets.add(offset);
  }
  const candidates: number[] = [];
  for (const offset of offsets) {
    const instant = localEpoch - offset;
    const local = localParts(new Date(instant), timeZone);
    if (local.date === date && local.time === time && local.second === "00")
      candidates.push(instant);
  }
  const result = candidates.length
    ? new Date(Math.min(...candidates)).toISOString()
    : null;
  if (resolvedInstants.size >= 2048)
    resolvedInstants.delete(resolvedInstants.keys().next().value!);
  resolvedInstants.set(key, result);
  return result;
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
