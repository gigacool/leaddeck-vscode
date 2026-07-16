import type { RailItem, SheetField, SheetVm, SignalVm } from "../model/protocol.ts";
import type { Day, Dataset, Project, Task, Week } from "../model/types.ts";
import { urgencyOf, type UrgencySignal } from "./urgency.ts";

/**
 * The editor sheet. Pure.
 *
 * The whole mechanism here is DEPTH ON DEMAND: a field is absent until asked
 * for, and what is absent shows up on the rail instead. An empty field is a
 * chore; a rail is an offer. That is the entire reason a bare task reads as
 * finished rather than as an accusation of unfinished data entry.
 *
 * Logged risk, accepted: the rail is a discovery bet. If he never notices
 * `＋ deadline`, he will conclude the tool cannot do dates.
 */

export interface ChordMap {
  deadline: string;
  subtasks: string;
  log: string;
  stakeholders: string;
  tags: string;
  commit: string;
  die: string;
}

/** Order is the rail's order. Deliberate: deadline first, death last. */
const RAIL: { field: SheetField; label: string; chord: keyof ChordMap }[] = [
  { field: "deadline", label: "＋ deadline", chord: "deadline" },
  { field: "description", label: "＋ description", chord: "log" },
  { field: "subtasks", label: "＋ subtasks", chord: "subtasks" },
  { field: "log", label: "＋ log note", chord: "log" },
  { field: "stakeholders", label: "＋ stakeholder", chord: "stakeholders" },
  { field: "tags", label: "＋ tag", chord: "tags" },
  { field: "commit", label: "＋ commit to a week", chord: "commit" },
];

/** A project is not a task: no status, no subtasks, no commitment, no log. */
const PROJECT_FIELDS: SheetField[] = ["deadline", "description", "stakeholders", "tags"];

function signalVm(s: UrgencySignal): SignalVm {
  switch (s.kind) {
    case "overdue":
      return { kind: s.kind, text: `${s.days}d over`, tone: "danger" };
    case "due":
      return { kind: s.kind, text: s.days === 0 ? "today" : `now · ${s.days}d`, tone: "danger" };
    case "blocked":
      return { kind: s.kind, text: s.days > 0 ? `blocked ${s.days}d` : "blocked", tone: "danger" };
    case "waiting":
      return { kind: s.kind, text: "waiting", tone: "warn" };
    case "rotting":
      return { kind: s.kind, text: `rotting · idle ${s.days}d`, tone: "warn" };
    case "quiet":
      return { kind: s.kind, text: "quiet", tone: "none" };
  }
}

/**
 * The prose under the signal. Says why, and says that there is no field for it.
 *
 * "There is nothing to compute urgency from, so there is none" — that sentence
 * is the point of the whole no-priority law, and a bare task must say it.
 */
function signalWhy(s: UrgencySignal, deadline: string | null): string {
  switch (s.kind) {
    case "overdue":
      return `deadline ${deadline} passed ${s.days}d ago. There is no field here that sets that.`;
    case "due":
      return `deadline ${deadline} in ${s.days}d. This is why the band says NOW. There is no field here that sets that.`;
    case "blocked":
      return `someone who reports to you owes the move${s.days > 0 ? `, for ${s.days}d` : ""}. Chase them; there is no field to change here.`;
    case "waiting":
      return `${s.who} is waiting on you. You owe a status.`;
    case "rotting":
      return `untouched for ${s.days}d and nobody will remind you. Nothing here marks intent to ignore.`;
    case "quiet":
      return "no deadline, nobody waiting. There is nothing to compute urgency from, so there is none.";
  }
}

function railFor(present: SheetField[], allowed: SheetField[], chords: ChordMap): RailItem[] {
  return RAIL.filter((r) => allowed.includes(r.field) && !present.includes(r.field)).map((r) => ({
    field: r.field,
    label: r.label,
    chord: chords[r.chord],
  }));
}

export function taskSheet(
  task: Task,
  data: Dataset,
  now: Day,
  week: Week,
  chords: ChordMap,
): SheetVm {
  const signal = urgencyOf(task, data, now);
  const project = data.projects.find((p) => p.id === task.project);

  // A field is "on" when it holds something. Nothing else marks it — there is
  // no per-field visibility flag, because that would be a second model of the
  // same fact.
  const present: SheetField[] = [];
  if (task.deadline !== null) present.push("deadline");
  if (task.description.length > 0) present.push("description");
  if (task.subtasks.length > 0) present.push("subtasks");
  if (task.logMessages.length > 0) present.push("log");
  if (task.stakeholders.length > 0) present.push("stakeholders");
  if (task.tags.length > 0) present.push("tags");
  if (task.committed !== null) present.push("commit");

  return {
    kind: "task",
    id: task.id,
    title: task.title,
    crumb: project ? project.title : "",
    status: task.status,
    signal: signalVm(signal),
    signalWhy: signalWhy(signal, task.deadline),
    deadline: task.deadline,
    description: present.includes("description") ? task.description : null,
    subtasks: present.includes("subtasks") ? task.subtasks : null,
    log: present.includes("log") ? task.logMessages : null,
    stakeholders: present.includes("stakeholders")
      ? task.stakeholders.map((ref) => ({
          id: ref.id,
          name: data.stakeholders.find((s) => s.id === ref.id)?.name ?? "?",
          direction: ref.direction,
        }))
      : null,
    tags: present.includes("tags") ? task.tags : null,
    commit: task.committed
      ? { weekOf: task.committed.weekOf, isThisWeek: task.committed.weekOf === week }
      : null,
    // `log` is repeatable, so it stays on the rail even once present.
    rail: railFor(
      present.filter((f) => f !== "log"),
      RAIL.map((r) => r.field),
      chords,
    ),
    death: task.death,
  };
}

/**
 * A project's sheet is SMALL, and that is the point.
 *
 * `Project.status` is dead — "in-progress" was true of 15 of 17 projects, the
 * same failure that killed priority. Milestones are dead — a project has ONE
 * deadline, and multiple deadlines means it is several projects, grouped by
 * tag. Both deletions shrank this surface rather than freeing space to refill.
 */
export function projectSheet(
  project: Project,
  data: Dataset,
  now: Day,
  chords: ChordMap,
): SheetVm {
  const tasks = data.tasks.filter((t) => t.project === project.id && t.death === null);

  // A project has no urgency of its own — it inherits the most urgent of its
  // tasks. Nothing about a project is typed into a signal.
  let signal: UrgencySignal = { kind: "quiet" };
  for (const t of tasks) {
    const s = urgencyOf(t, data, now);
    if (rank(s) < rank(signal)) signal = s;
  }

  const present: SheetField[] = [];
  if (project.deadline !== null) present.push("deadline");
  if (project.description.length > 0) present.push("description");
  if (project.stakeholders.length > 0) present.push("stakeholders");
  if (project.tags.length > 0) present.push("tags");

  const n = tasks.length;
  return {
    kind: "project",
    id: project.id,
    title: project.title,
    crumb: `${n} ${n === 1 ? "task" : "tasks"}`,
    status: null,
    signal: signalVm(signal),
    signalWhy:
      n === 0
        ? "no tasks yet. There is nothing to compute urgency from, so there is none."
        : `${signalWhy(signal, project.deadline)} Inherited from its tasks.`,
    deadline: project.deadline,
    description: present.includes("description") ? project.description : null,
    subtasks: null,
    log: null,
    stakeholders: present.includes("stakeholders")
      ? project.stakeholders.map((ref) => ({
          id: ref.id,
          name: data.stakeholders.find((s) => s.id === ref.id)?.name ?? "?",
          direction: ref.direction,
        }))
      : null,
    tags: present.includes("tags") ? project.tags : null,
    commit: null,
    rail: railFor(present, PROJECT_FIELDS, chords),
    death: null,
  };
}

function rank(s: UrgencySignal): number {
  const order = ["overdue", "due", "blocked", "waiting", "rotting", "quiet"];
  return order.indexOf(s.kind);
}
