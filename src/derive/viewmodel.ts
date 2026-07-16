import { addWeeks, toWeek } from "../model/dates.ts";
import type {
  BacklogVm,
  BandVm,
  CardVm,
  KanbanVm,
  Mode,
  PipVm,
  ReportVm,
  SheetField,
  SignalVm,
  StripVm,
  ViewModel,
} from "../model/protocol.ts";
import type { Day, Dataset, Task, Week } from "../model/types.ts";
import { ruleBar, shelf } from "./bands.ts";
import { burndown } from "./burndown.ts";
import { projectSheet, taskSheet, type ChordMap } from "./sheet.ts";
import { idleDays, isBlocked, isOpen, urgencyOf, type UrgencySignal } from "./urgency.ts";

/**
 * The view model. Pure — `(data, now, ui) => ViewModel` (AD-3, AD-11).
 *
 * Everything the webview renders is decided here, including the TEXT of every
 * chip. The webview computes nothing; that is what keeps a paint from ever
 * containing two clocks, and what makes the whole render path testable without
 * launching VS Code.
 */

export interface UiState {
  mode: Mode;
  drainOpen: boolean;
  root: string;
  rootKind: "local" | "configured" | "home";
  /** Which sheet is unfolded, if any. UI state — never persisted. */
  open: { kind: "task" | "project"; id: string } | null;
  /**
   * Fields ASKED FOR but still empty — `＋ tag` clicked, nothing typed yet.
   *
   * `tags`, `stakeholders` and `log` cannot be added by writing a placeholder
   * the way `deadline` (today) or `subtasks` (one blank row) can: an empty tag
   * is not a tag, and a nameless stakeholder is not a person. So presence can't
   * be read from stored data alone for these three, and without this the rail
   * buttons were INERT — they mutated nothing, the repaint was identical, and
   * the click did nothing at all.
   *
   * It lives here and not in the webview because the webview holds no state
   * across messages (AD-11). It is intent, not data: never persisted, and it
   * dies with the sheet.
   */
  asked: SheetField[];
  /**
   * FR-20 — how many weeks BACK the report is viewing. 0 is this week; the
   * stepper is bounded at six, so this never exceeds 5. It affects the REPORT
   * only: backlog and kanban are always "now", because stepping them back would
   * be the analytics panel arriving by another door.
   */
  weekOffset: number;
  /**
   * Passed in, never derived. Chords are platform-specific and live in
   * `surface/` — this layer cannot import `vscode` to find out (AD-3).
   */
  captureChord: string;
  chords: ChordMap;
}

const STALE_DAYS = 14;

/**
 * FR-20 — the stepper is bounded at SIX. Offset 0..5 are weeks; the seventh row
 * is `— export —`, not a seventh week. The bound is the feature: six weeks is
 * the horizon of "recent iterations", and anything older is a retrospective he
 * runs on the export, not in the app.
 */
export const STEPPER_WEEKS = 6;

function signalVm(s: UrgencySignal): SignalVm {
  switch (s.kind) {
    case "overdue":
      return { kind: s.kind, text: `${s.days}d over`, tone: "danger" };
    case "due":
      return { kind: s.kind, text: s.days === 0 ? "today" : `${s.days}d`, tone: "danger" };
    case "blocked":
      return { kind: s.kind, text: s.days > 0 ? `blocked ${s.days}d` : "blocked", tone: "danger" };
    case "waiting":
      return { kind: s.kind, text: `waiting`, tone: "warn" };
    case "rotting":
      return { kind: s.kind, text: `idle ${s.days}d`, tone: "warn" };
    case "quiet":
      return { kind: s.kind, text: "—", tone: "none" };
  }
}

function pipState(task: Task, data: Dataset, now: Day): PipVm["state"] {
  if (task.status === "done") return "done";
  if (task.status === "doing") return "doing";
  if (isBlocked(task, data)) return "block";
  const idle = idleDays(task, now);
  if (idle !== null && idle >= STALE_DAYS) return "stale";
  return "todo";
}

function whoVm(task: Task[], data: Dataset): StripVm["who"] {
  for (const t of task) {
    for (const ref of t.stakeholders) {
      const sh = data.stakeholders.find((s) => s.id === ref.id);
      if (!sh) continue;
      return ref.direction === "up"
        ? { glyph: "↑", label: sh.name }
        : { glyph: "↓", label: sh.name };
    }
  }
  return null;
}

const DEFAULT_CHORDS: ChordMap = {
  deadline: "Ctrl+D",
  subtasks: "Ctrl+Shift+S",
  log: "Ctrl+L",
  stakeholders: "Ctrl+Shift+P",
  tags: "Ctrl+T",
  commit: "Ctrl+W",
  die: "Ctrl+Backspace",
};

export function backlogVm(
  data: Dataset,
  now: Day,
  week: Week,
  drainOpen: boolean,
  captureChord = "Ctrl+Alt+L",
  open: UiState["open"] = null,
  chords: ChordMap = DEFAULT_CHORDS,
  asked: SheetField[] = [],
): BacklogVm {
  const bands = shelf(data, now);
  const unsorted = data.captures.filter((c) => c.state === "unsorted");

  const vm: BandVm[] = bands.map((b) => ({
    kind: b.def.kind,
    label: b.def.label,
    predicate: b.def.predicate,
    count: b.def.kind === "unsorted" ? b.captureCount : b.strips.length,
    strips: b.strips.map((s): StripVm => ({
      id: s.project.id,
      title: s.project.title,
      pips: s.tasks
        .filter((t) => t.death === null)
        .map((t): PipVm => ({
          id: t.id,
          title: t.title,
          state: pipState(t, data, now),
          wk: t.committed?.weekOf === week,
        })),
      done: s.done,
      total: s.total,
      signal: signalVm(s.signal),
      who: whoVm(s.tasks.filter(isOpen), data),
    })),
    captures:
      b.def.kind === "unsorted"
        ? unsorted.map((c) => ({
            id: c.id,
            text: c.text,
            ageDays: captureAge(c.capturedAt, now),
          }))
        : [],
    oldestCaptureDays: b.oldestCaptureDays,
  }));

  const shownProjects = vm.reduce((n, b) => n + b.strips.length, 0);
  const totalProjects = data.projects.length;

  let sheet: BacklogVm["sheet"] = null;
  if (open) {
    if (open.kind === "task") {
      const t = data.tasks.find((x) => x.id === open.id);
      if (t) sheet = taskSheet(t, data, now, week, chords, asked);
    } else {
      const p = data.projects.find((x) => x.id === open.id);
      if (p) sheet = projectSheet(p, data, now, chords, asked);
    }
  }

  return {
    bands: vm,
    rule: ruleBar(shownProjects, totalProjects, "they have living work"),
    captureChord,
    sheet,
    drain: drainOpen
      ? {
          captures: unsorted.map((c) => ({
            id: c.id,
            text: c.text,
            ageDays: captureAge(c.capturedAt, now),
          })),
          resolved: data.captures.filter((c) => c.state === "resolved").length,
        }
      : null,
  };
}

function captureAge(capturedAt: string, now: Day): number {
  const t = Date.parse(capturedAt);
  if (Number.isNaN(t)) return 0;
  const d = new Date(t);
  const dayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
  const [ay, am, ad] = dayStr.split("-").map(Number);
  const [by, bm, bd] = now.split("-").map(Number);
  const a = new Date(ay!, am! - 1, ad!).getTime();
  const b = new Date(by!, bm! - 1, bd!).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

/**
 * Kanban — this week's committed work, four fixed columns.
 *
 * `blocked` is a COLUMN, not a status. It is derived from a ↓ stakeholder
 * owing the move, so there is a column but no field.
 */
export function kanbanVm(data: Dataset, now: Day, week: Week): KanbanVm {
  const committed = data.tasks.filter(
    (t) => t.committed?.weekOf === week && t.death === null,
  );
  const projectTitle = new Map(data.projects.map((p) => [p.id, p.title]));

  const card = (t: Task): CardVm => {
    const s = urgencyOf(t, data, now);
    return {
      id: t.id,
      title: t.title,
      project: projectTitle.get(t.project) ?? "",
      signal: signalVm(s),
      tone: s.kind === "overdue" || s.kind === "due" ? "hot" : s.kind === "quiet" ? "cold" : "warm",
      done: t.status === "done",
    };
  };

  const done = committed.filter((t) => t.status === "done");
  const doing = committed.filter((t) => t.status === "doing");
  const blocked = committed.filter((t) => t.status === "todo" && isBlocked(t, data));
  const todo = committed.filter((t) => t.status === "todo" && !isBlocked(t, data));

  return {
    week,
    rule: ruleBar(committed.length, data.tasks.filter((t) => t.death === null).length, `committed: weekOf = ${week}`),
    columns: [
      { key: "committed", label: "Committed", cards: todo.map(card) },
      { key: "doing", label: "In flight", cards: doing.map(card) },
      { key: "blocked", label: "Blocked", cards: blocked.map(card) },
      { key: "done", label: "Done", cards: done.map(card) },
    ],
  };
}

/**
 * Report — the material, in the three parts of the report he already writes.
 *
 * The app assembles what happened / where I'm stuck / next. It does NOT write
 * the prose: ~80% of the report is text the app cannot produce, and the section
 * works precisely to the extent it doesn't help.
 */
export function reportVm(
  data: Dataset,
  now: Day,
  week: Week,
  offset: number,
  reportPath: string,
): ReportVm {
  const projectTitle = new Map(data.projects.map((p) => [p.id, p.title]));
  const name = (t: Task): string => projectTitle.get(t.project) ?? "";

  const inWeek = (instant: string | null): boolean =>
    instant !== null && toWeek(new Date(Date.parse(instant))) === week;

  const happened = data.tasks
    .filter((t) => t.status === "done" && inWeek(t.doneAt))
    .map((t) => ({ id: t.id, title: t.title, project: name(t) }));

  const stuck = data.tasks
    .filter((t) => isOpen(t) && isBlocked(t, data))
    .map((t) => {
      const s = urgencyOf(t, data, now);
      return {
        id: t.id,
        title: t.title,
        project: name(t),
        why: s.kind === "blocked" && s.days > 0 ? `blocked ${s.days}d` : "blocked",
      };
    });

  const nextWeek = addWeeks(week, 1);
  const next = data.tasks
    .filter((t) => t.committed?.weekOf === nextWeek && t.death === null)
    .map((t) => ({ id: t.id, title: t.title, project: name(t) }));

  const atRisk = data.tasks
    .filter(isOpen)
    .map((t) => ({ t, s: urgencyOf(t, data, now) }))
    .filter(({ s }) => s.kind === "overdue" || s.kind === "due" || s.kind === "blocked")
    .slice(0, 3)
    .map(({ t, s }) => ({
      id: t.id,
      title: t.title,
      why: signalVm(s).text,
      tone: (s.kind === "overdue" || s.kind === "due" ? "danger" : "warn") as "danger" | "warn",
    }));

  return {
    week,
    rule: ruleBar(happened.length, data.tasks.length, `doneAt is inside ${week}`),
    atRisk,
    happened,
    stuck,
    next,
    burndown: burndown(data, week),
    stepper: {
      offset,
      label: offsetLabel(offset),
      canForward: offset > 0,
      canBack: offset < STEPPER_WEEKS - 1,
      atFloor: offset === STEPPER_WEEKS - 1,
    },
    reportPath,
  };
}

function offsetLabel(offset: number): string {
  if (offset === 0) return "this week";
  if (offset === 1) return "1 week ago";
  return `${offset} weeks ago`;
}

export function buildViewModel(
  data: Dataset,
  now: Day,
  week: Week,
  ui: UiState,
  reportPath: string,
): ViewModel {
  // FR-20 — the report views a week BACK; backlog and kanban stay on `now`.
  // Stepping the shelf back would be the analytics panel by another door.
  const viewedWeek = addWeeks(week, -ui.weekOffset);
  return {
    mode: ui.mode,
    root: ui.root,
    rootKind: ui.rootKind,
    backlog:
      ui.mode === "backlog"
        ? backlogVm(data, now, week, ui.drainOpen, ui.captureChord, ui.open, ui.chords, ui.asked)
        : null,
    kanban: ui.mode === "kanban" ? kanbanVm(data, now, week) : null,
    report:
      ui.mode === "report" ? reportVm(data, now, viewedWeek, ui.weekOffset, reportPath) : null,
  };
}
