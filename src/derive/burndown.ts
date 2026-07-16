import { parseDay, weekDays } from "../model/dates.ts";
import type { Dataset, Day, Task, Week } from "../model/types.ts";

/**
 * FR-21 — a burndown, with its fiction FLAGGED.
 *
 * The remaining line is real and countable: for each day of the committed week,
 * the tasks committed to that week that are still open at the end of that day.
 * `doneAt` is stamped (AD-4), so "still open on Tuesday" is a fact, not a guess.
 *
 * The ideal line is fiction, and says so. There are no estimates in the model,
 * and no field fixes that honestly — a burn RATE needs sizes we never asked
 * for. So the ideal is drawn FLAT and labelled fiction, rather than sloped from
 * a number we would have to invent. A faked slope is exactly the lie FR-21
 * forbids; a flat line that admits it is the honest non-answer.
 */
export interface Burndown {
  /** One point per ISO-week day, Monday first. The real, countable line. */
  remaining: { day: Day; count: number }[];
  /** The flat fiction line's value — the count committed at the week's start. */
  ideal: number;
  /** Baked here so the webview renders it and never composes it (AD-11). */
  idealLabel: string;
  /** Nothing committed ⇒ nothing to burn down. The chart says so, not zero. */
  empty: boolean;
}

const IDEAL_LABEL = "ideal (no estimates — assumed flat · fiction)";

export function burndown(data: Dataset, week: Week): Burndown {
  const committed = data.tasks.filter((t) => t.committed?.weekOf === week && t.death === null);

  const remaining = weekDays(week).map((day) => ({
    day,
    count: committed.filter((t) => openAtEndOf(t, day)).length,
  }));

  return {
    remaining,
    // The fiction sits at the starting height: the whole set, unburned. A
    // descending ideal would be the invented slope the FR refuses.
    ideal: committed.length,
    idealLabel: IDEAL_LABEL,
    empty: committed.length === 0,
  };
}

/**
 * Was this task still open at the END of `day`? Open means not yet done as of
 * that day. `doneAt` is an Instant; a task done anytime on `day` or earlier is
 * closed by end of `day`, so it has burned down.
 */
function openAtEndOf(t: Task, day: Day): boolean {
  if (t.doneAt === null) return true;
  const doneDay = new Date(Date.parse(t.doneAt));
  const endOfDay = parseDay(day);
  endOfDay.setHours(23, 59, 59, 999);
  return doneDay.getTime() > endOfDay.getTime();
}
