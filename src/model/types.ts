/**
 * The model. Imports nothing.
 *
 * Every field here is AUTHORED or STAMPED. Nothing derived lives in this file —
 * urgency, bands and `blocked` are computed per paint from these fields plus
 * `now` (AD-4), and never stored.
 */

/** `YYYY-MM-DD`. No time component. */
export type Day = string;

/** ISO week, `YYYY-Www`. */
export type Week = string;

/** ISO 8601 with offset. */
export type Instant = string;

export type ProjectId = `pj_${string}`;
export type TaskId = `tk_${string}`;
export type CaptureId = `cp_${string}`;
export type StakeholderId = `sh_${string}`;

/** The Inbox is a real Project row with a reserved id — not a special case (AD-1). */
export const INBOX_PROJECT_ID = "pj_inbox" as ProjectId;

/**
 * `blocked` is deliberately absent. A task is blocked when a `↓` stakeholder
 * owes the move — that is derived, not stored, so there is no field to argue
 * with. Same law that killed priority.
 */
export type TaskStatus = "todo" | "doing" | "done";

/** Authored, required, and the export's raw material. Nothing computes *why*. */
export type DeathReason = "outdated" | "delegated" | "cancelled";

export interface Death {
  reason: DeathReason;
  at: Instant;
}

/** `↑` I report to them — I owe a status. `↓` they report to me — they owe me. */
export type Direction = "up" | "down";

export interface StakeholderRef {
  id: StakeholderId;
  direction: Direction;
}

export interface Subtask {
  text: string;
  done: boolean;
}

export interface LogMessage {
  /** Auto-stamped from the paint's `now`, and editable: he logs Tuesday's event on Friday. */
  eventDate: Day;
  message: string;
}

export interface Stakeholder {
  id: StakeholderId;
  /** Editable. The id is never derived from this, and this is never derived from the id (AD-5). */
  name: string;
}

export interface Project {
  id: ProjectId;
  title: string;
  description: string;
  /** Single. Multiple deadlines means it is several projects, grouped by tag. */
  deadline: Day | null;
  stakeholders: StakeholderRef[];
  /** Carries the grouping load milestones used to. */
  tags: string[];
  logMessages: LogMessage[];
}

export interface Task {
  id: TaskId;
  title: string;
  description: string;
  /** Required. The Inbox is the null project. */
  project: ProjectId;
  deadline: Day | null;
  status: TaskStatus;
  /** Flat, one level. */
  subtasks: Subtask[];
  /** Newest first. */
  logMessages: LogMessage[];
  stakeholders: StakeholderRef[];
  tags: string[];
  /** The only real judgment he authors. Replaces priority. */
  committed: { weekOf: Week } | null;
  /**
   * STAMPED, not computed (AD-4). With no event log there is nothing to derive
   * this from — it records a transition `now` cannot reconstruct. Feeds urgency.
   */
  todoSince: Day | null;
  /** STAMPED. Feeds FR-16 (what happened) and FR-21. */
  doneAt: Instant | null;
  /** A distinct ending from `done`. Never rendered as failure. */
  death: Death | null;
}

export type CaptureState = "unsorted" | "resolved";

/**
 * A Capture is NOT a Task — a Task requires a project, a Capture has none.
 * `{id, text, capturedAt, state}` plus `resolvedTo`, which exists so a crashed
 * multi-file write self-heals on load (AD-13).
 */
export interface Capture {
  id: CaptureId;
  /** Raw. No sigils are parsed — structure at capture time is what he skips under pressure. */
  text: string;
  capturedAt: Instant;
  state: CaptureState;
  /**
   * Set only by the new-task resolution. The other three (note-on-task,
   * note-on-project, bin-with-reason) leave this null and just set `state`.
   */
  resolvedTo: TaskId | null;
}

/** The whole dataset. It fits in memory — that fact is the architecture. */
export interface Dataset {
  projects: Project[];
  tasks: Task[];
  captures: Capture[];
  stakeholders: Stakeholder[];
}

export type EntityFile = "projects" | "tasks" | "captures" | "stakeholders";

export const ENTITY_FILES: readonly EntityFile[] = [
  "projects",
  "tasks",
  "captures",
  "stakeholders",
];
