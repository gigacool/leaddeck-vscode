import { daysBetween } from "../model/dates.ts";
import type { Day, Dataset, Task } from "../model/types.ts";

/**
 * Urgency. Computed, never typed.
 *
 * There is no field to argue with — this file IS the priority system, and it
 * takes no input from the user. Priority died because with 10–20 projects
 * everything becomes "high": a signal that doesn't discriminate stops being a
 * signal.
 *
 * Every function here is `(model, now) => value`. Pure. No `vscode`, no `fs`,
 * no clock of its own (AD-3) — the surface reads the clock once per paint and
 * passes it down. That is what makes this testable rather than aspirational.
 */

/** Untouched this long and it is rotting. */
const STALE_DAYS = 14;

/** Deadline within this window and it is due. */
const DUE_DAYS = 5;

export type UrgencySignal =
  | { kind: "due"; days: number }
  | { kind: "overdue"; days: number }
  | { kind: "blocked"; days: number }
  | { kind: "waiting"; who: string }
  | { kind: "rotting"; days: number }
  | { kind: "quiet" };

/**
 * `blocked` is DERIVED, not stored (the Kanban's fourth column and the `block`
 * pip both read this). A task is blocked when a `↓` stakeholder owes the move:
 * they report to him, so the next step is theirs, not his.
 *
 * Keeping this computed is the same law that killed priority — the column
 * exists, but there is no field to set.
 */
export function isBlocked(task: Task, data: Dataset): boolean {
  if (task.status === "done" || task.death !== null) return false;
  if (task.status === "doing") return false;
  return task.stakeholders.some((s) => {
    if (s.direction !== "down") return false;
    return data.stakeholders.some((sh) => sh.id === s.id);
  });
}

/** `↑` — I report to them, so I owe a status. This is half of urgency. */
export function owesAStatusTo(task: Task, data: Dataset): string | null {
  for (const ref of task.stakeholders) {
    if (ref.direction !== "up") continue;
    const sh = data.stakeholders.find((s) => s.id === ref.id);
    if (sh) return sh.name;
  }
  return null;
}

/**
 * Days a task has sat untouched. Reads `todoSince` — a STAMPED field, not a
 * computed one (AD-4). With no event log there is nothing to derive it from.
 */
export function idleDays(task: Task, now: Day): number | null {
  if (task.todoSince === null) return null;
  if (task.status === "done" || task.death !== null) return null;
  return daysBetween(task.todoSince, now);
}

/**
 * The one signal. Ordered by what should pull his eye first.
 *
 * A task with nothing to compute from reads `quiet` — "there is nothing to
 * compute urgency from, so there is none". That is why a bare task looks
 * finished rather than accusing.
 */
export function urgencyOf(task: Task, data: Dataset, now: Day): UrgencySignal {
  if (task.deadline !== null) {
    const days = daysBetween(now, task.deadline);
    if (days < 0) return { kind: "overdue", days: Math.abs(days) };
    if (days <= DUE_DAYS) return { kind: "due", days };
  }

  if (isBlocked(task, data)) {
    const idle = idleDays(task, now);
    return { kind: "blocked", days: idle ?? 0 };
  }

  const who = owesAStatusTo(task, data);
  if (who !== null) return { kind: "waiting", who };

  const idle = idleDays(task, now);
  if (idle !== null && idle >= STALE_DAYS) return { kind: "rotting", days: idle };

  return { kind: "quiet" };
}

/**
 * Rank for sorting within a band. Lower sorts first.
 *
 * Deliberately NOT exposed as a number anywhere in the UI. The moment a score
 * is visible it becomes a thing to argue with, and arguing with it is what
 * priority was.
 */
export function urgencyRank(signal: UrgencySignal): number {
  switch (signal.kind) {
    case "overdue":
      return 0;
    case "due":
      return 1;
    case "blocked":
      return 2;
    case "waiting":
      return 3;
    case "rotting":
      return 4;
    case "quiet":
      return 5;
  }
}

export const isOpen = (task: Task): boolean =>
  task.status !== "done" && task.death === null;
