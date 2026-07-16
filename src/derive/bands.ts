import { daysBetween, toDay } from "../model/dates.ts";
import { INBOX_PROJECT_ID, type Day, type Dataset, type Project, type Task } from "../model/types.ts";
import { isOpen, urgencyOf, urgencyRank, type UrgencySignal } from "./urgency.ts";

/**
 * Bands. The band IS the sort — you never set it.
 *
 * There is no manual reorder and no drag-to-band. A band's header states its
 * predicate and count, so nothing is ever on screen without a stated reason.
 */

export type BandKind = "unsorted" | "now" | "soon" | "waiting" | "rotting" | "quiet";

export interface BandDef {
  kind: BandKind;
  label: string;
  /** Rendered in mono next to the count. If you can't say why, it isn't a band. */
  predicate: string;
}

export const BANDS: readonly BandDef[] = [
  // First on the shelf, and the only row whose target value is ZERO.
  // Everything below it is managed; this one is emptied.
  { kind: "unsorted", label: "UNSORTED", predicate: "captured, not yet sorted" },
  { kind: "now", label: "NOW", predicate: "deadline ≤5d, or overdue" },
  { kind: "soon", label: "SOON", predicate: "deadline ≤21d" },
  { kind: "waiting", label: "WAITING ON SOMEONE", predicate: "a person owes the move" },
  { kind: "rotting", label: "ROTTING", predicate: "untouched ≥14d" },
  { kind: "quiet", label: "QUIET", predicate: "nothing to compute from" },
];

const SOON_DAYS = 21;

export interface ProjectStrip {
  project: Project;
  /** One pip per real task. Never aggregates — no "+12 more". */
  tasks: Task[];
  signal: UrgencySignal;
  done: number;
  total: number;
}

export interface Band {
  def: BandDef;
  strips: ProjectStrip[];
  /** Populated only for `unsorted`, which carries captures rather than strips. */
  captureCount: number;
  oldestCaptureDays: number | null;
}

/**
 * A project's signal is its most urgent open task. A project has no status of
 * its own — `Project.status` was killed because "in-progress" was true of 15 of
 * 17 projects, the same failure that killed priority.
 */
export function stripSignal(tasks: Task[], data: Dataset, now: Day): UrgencySignal {
  const open = tasks.filter(isOpen);
  if (open.length === 0) return { kind: "quiet" };
  let best: UrgencySignal = { kind: "quiet" };
  for (const t of open) {
    const s = urgencyOf(t, data, now);
    if (urgencyRank(s) < urgencyRank(best)) best = s;
  }
  return best;
}

function bandFor(signal: UrgencySignal, tasks: Task[], data: Dataset, now: Day): BandKind {
  switch (signal.kind) {
    case "overdue":
    case "due":
      return "now";
    case "blocked":
    case "waiting":
      return "waiting";
    case "rotting":
      return "rotting";
    case "quiet":
      break;
  }
  // Quiet, but a deadline is on the horizon.
  const soon = tasks.some((t) => {
    if (!isOpen(t) || t.deadline === null) return false;
    const s = urgencyOf(t, data, now);
    if (s.kind !== "quiet") return false;
    return daysUntil(t.deadline, now) <= SOON_DAYS;
  });
  return soon ? "soon" : "quiet";
}

const daysUntil = (deadline: Day, now: Day): number => daysBetween(now, deadline);

/**
 * A capture's age in whole days.
 *
 * `capturedAt` is an instant and `now` is a Day — mixing them in millisecond
 * arithmetic is wrong, because `Date.parse("2026-07-15")` is UTC midnight while
 * the instant carries a real time of day. Compare calendar days instead: a
 * capture from Thursday morning is "1d" on Friday morning, whatever the hour.
 */
function captureAgeDays(capturedAt: string, now: Day): number {
  const t = Date.parse(capturedAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, daysBetween(toDay(new Date(t)), now));
}

/**
 * The shelf: every project as a strip, grouped into computed bands.
 *
 * Two different things sit near each other here and must not be confused:
 *
 *   - The UNSORTED BAND carries raw pips for CAPTURES — things that are not yet
 *     tasks. A band is not a project, which is what keeps "one pip = one real
 *     task" true for every strip and keeps Capture out of the Task model.
 *   - The INBOX STRIP carries real TASKS that have no project yet. It is an
 *     ordinary strip and renders like any other.
 *
 * A capture resolved into a task stops being a capture and becomes a task on
 * `pj_inbox` — so it must leave the band and appear on the strip. Skipping the
 * Inbox project here made resolved captures vanish into a project nothing drew.
 * Like every strip, it disappears when it holds no living work.
 */
export function shelf(data: Dataset, now: Day): Band[] {
  const byKind = new Map<BandKind, ProjectStrip[]>();
  for (const def of BANDS) byKind.set(def.kind, []);

  for (const project of data.projects) {
    const tasks = data.tasks.filter((t) => t.project === project.id);

    // An empty project is DRAWN, not dropped — but only if he made it. A bare
    // project is a finished project, and a project that vanishes the instant it
    // is created is a dead end: you cannot add a task to a strip that is not on
    // the shelf. Inbox is the one exception: it is machinery, not a decision, so
    // it appears only when it holds something.
    if (tasks.length === 0 && project.id === INBOX_PROJECT_ID) continue;

    const signal = stripSignal(tasks, data, now);
    const strip: ProjectStrip = {
      project,
      tasks: [...tasks].sort(
        (a, b) =>
          urgencyRank(urgencyOf(a, data, now)) - urgencyRank(urgencyOf(b, data, now)),
      ),
      signal,
      done: tasks.filter((t) => t.status === "done").length,
      total: tasks.filter((t) => t.death === null).length,
    };
    byKind.get(bandFor(signal, tasks, data, now))!.push(strip);
  }

  for (const strips of byKind.values()) {
    strips.sort((a, b) => urgencyRank(a.signal) - urgencyRank(b.signal));
  }

  const unsorted = data.captures.filter((c) => c.state === "unsorted");
  const oldest = unsorted.reduce<number | null>((acc, c) => {
    const days = captureAgeDays(c.capturedAt, now);
    return acc === null || days > acc ? days : acc;
  }, null);

  return BANDS.map((def) => ({
    def,
    strips: byKind.get(def.kind)!,
    captureCount: def.kind === "unsorted" ? unsorted.length : 0,
    oldestCaptureDays: def.kind === "unsorted" ? oldest : null,
  })).filter((b) => b.strips.length > 0 || b.captureCount > 0);
}

/**
 * The rule bar's text. Mandatory on any filtered surface.
 *
 * Born from a real failure: "unclear aspect is weekly tasks displayed (3 out of
 * 17) — why those and not others?". The rule must be visible, not inferred.
 */
export function ruleBar(shown: number, total: number, predicate: string): string {
  const hidden = total - shown;
  const tail = hidden > 0 ? ` · ${hidden} not shown, on purpose` : "";
  return `showing the ${shown} ${shown === 1 ? "item" : "items"} where ${predicate}${tail}`;
}
