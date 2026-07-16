import type { Day, Instant, Week } from "./types.ts";

/**
 * Three kinds of date, never interchanged (Consistency Conventions).
 *
 * Every function here takes its time as an argument. AD-3: only `surface/`
 * reads the clock — once per paint, once per intent — and passes it down.
 */

export function toDay(d: Date): Day {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function toInstant(d: Date): Instant {
  return d.toISOString();
}

export function parseDay(day: Day): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

/**
 * ISO 8601 week: weeks start Monday, and week 1 is the one containing the first
 * Thursday of the year.
 */
export function toWeek(d: Date): Week {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Thursday of this week decides the year.
  const dayNum = (t.getDay() + 6) % 7;
  t.setDate(t.getDate() - dayNum + 3);
  const isoYear = t.getFullYear();
  const firstThursday = new Date(isoYear, 0, 4);
  const firstDayNum = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3);
  const week = 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from: Day, to: Day): number {
  const a = parseDay(from);
  const b = parseDay(to);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * The seven days of an ISO week, Monday first. Used by the burndown (FR-21) to
 * plot a point per day. Derived from the week's Thursday-anchored Monday, the
 * same anchor `addWeeks` uses — one definition of "which Monday", not two.
 */
export function weekDays(week: Week): Day[] {
  const [yStr, wStr] = week.split("-W");
  const y = Number(yStr);
  const w = Number(wStr);
  const jan4 = new Date(y, 0, 4);
  const jan4DayNum = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(y, 0, 4 - jan4DayNum);
  const monday = new Date(week1Monday);
  monday.setDate(monday.getDate() + (w - 1) * 7);
  const days: Day[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    days.push(toDay(d));
  }
  return days;
}

export function addWeeks(week: Week, delta: number): Week {
  const [yStr, wStr] = week.split("-W");
  const y = Number(yStr);
  const w = Number(wStr);
  // Anchor on the Thursday of the given ISO week, then step in 7-day jumps.
  const jan4 = new Date(y, 0, 4);
  const jan4DayNum = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(y, 0, 4 - jan4DayNum);
  const target = new Date(week1Monday);
  target.setDate(target.getDate() + (w - 1 + delta) * 7);
  return toWeek(target);
}
