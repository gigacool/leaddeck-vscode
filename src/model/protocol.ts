import type { BandKind } from "../derive/bands.ts";
import type { Burndown } from "../derive/burndown.ts";
import type { UrgencySignal } from "../derive/urgency.ts";
import type { CaptureId, ProjectId, StakeholderId, TaskId } from "./types.ts";

/**
 * The one postMessage envelope. Shared by both sides — this file is the reason
 * the protocol is checked at compile time rather than hoped for.
 *
 * v1 had `onMessage(msg: any)` with a bare switch over ~20 string literals, and
 * never messaged the webview at all: it replaced the entire HTML on every
 * change and paid for it with a focus-loss workaround.
 *
 * Direction is strict (AD-11):
 *   host → webview:  a complete ViewModel. Never a delta, never a patch.
 *   webview → host:  INTENT. Never a mutation.
 */

export type Mode = "backlog" | "kanban" | "report";

/** What the webview renders. Everything here is already derived. */
export interface PipVm {
  id: TaskId;
  title: string;
  state: "todo" | "doing" | "done" | "stale" | "block" | "raw";
  /** Committed to the shown week — the `.wk` outline. */
  wk: boolean;
}

export interface StripVm {
  id: ProjectId;
  title: string;
  pips: PipVm[];
  done: number;
  total: number;
  signal: SignalVm;
  /** `↑ Sarah` / `↓ 6 reports` / `—`. Direction is half of urgency. */
  who: { glyph: "↑" | "↓" | "—"; label: string } | null;
  /**
   * Whether the readable task list is unfolded. Now a CLICK toggles it (not
   * hover), and the state persists across paints — so it lives in the view
   * model, not in a `:hover` the DOM forgets. A11y over density: eyes that tire
   * need the titles to stay open, not to vanish when the cursor moves.
   */
  open: boolean;
}

/** A signal is already rendered to text here — the webview never computes. */
export interface SignalVm {
  kind: UrgencySignal["kind"];
  /** `2d`, `idle 6d`, `—`. Mono, always. */
  text: string;
  tone: "danger" | "warn" | "subtle" | "none";
}

export interface BandVm {
  kind: BandKind;
  label: string;
  /** Stated, never inferred. A band without one is not a band. */
  predicate: string;
  count: number;
  strips: StripVm[];
  /** Unsorted only: captures are raw pips on the BAND, with no strip. */
  captures: { id: CaptureId; text: string; ageDays: number }[];
  oldestCaptureDays: number | null;
}

export interface BacklogVm {
  bands: BandVm[];
  rule: string;
  /** The drain is a SUB-STATE of backlog, never a sibling mode. */
  drain: DrainVm | null;
  /**
   * The editor. A SHEET that unfolds in the shelf's own flow — not a region,
   * not an overlay, not a tab. The 2-column split was rejected: halving the
   * width stops the pips fitting, and it is the shape that produced v1's five
   * panels.
   */
  sheet: SheetVm | null;
  /**
   * Rendered in mono, so it is a computed fact. Platform-resolved — the chords
   * differ per OS, and `derive/` cannot reach `vscode` to know which.
   */
  captureChord: string;
}

/**
 * What is on the sheet. Fields are ABSENT until asked for — an empty field is a
 * chore, a rail is an offer. That is why a bare task reads as finished.
 */
export type SheetField =
  | "deadline"
  | "description"
  | "subtasks"
  | "log"
  | "stakeholders"
  | "tags"
  | "commit";

export interface RailItem {
  field: SheetField;
  label: string;
  /** Platform-resolved in `surface/`, rendered in mono. */
  chord: string;
}

export interface SheetVm {
  kind: "task" | "project";
  id: TaskId | ProjectId;
  title: string;
  /** `COMEX workshop › build the deck` for a task; `18 tasks` for a project. */
  crumb: string;
  /** A task's status. A project has none — a project isn't a task. */
  status: "todo" | "doing" | "done" | null;
  /** Read-only, labelled `computed`. NEVER a control. */
  signal: SignalVm;
  /** Why the signal says what it says, in prose. Also read-only. */
  signalWhy: string;
  /** Present only when the field is on. `null` means the rail still offers it. */
  deadline: string | null;
  description: string | null;
  subtasks: { text: string; done: boolean }[] | null;
  log: { eventDate: string; message: string }[] | null;
  stakeholders: { id: StakeholderId; name: string; direction: "up" | "down" }[] | null;
  tags: string[] | null;
  /** The only real judgment he authors. `weekOf` when committed. */
  commit: { weekOf: string; isThisWeek: boolean } | null;
  /**
   * Which fields the sheet SHOWS, regardless of whether they hold a value. When
   * "show all" is on (Cédric's call — depth-on-demand was more chore than
   * offer), this is every field the kind allows, so the layout is identical
   * from one task to the next. A field shown but empty renders its empty state;
   * `null` in the value fields above then means "empty", not "hidden".
   */
  fields: SheetField[];
  /** What is NOT shown yet — empty when the sheet shows all fields. */
  rail: RailItem[];
  /** A task can die. So can a project. Both carry a reason. */
  death: { reason: string; at: string } | null;
}

export interface DrainVm {
  captures: { id: CaptureId; text: string; ageDays: number }[];
  resolved: number;
}

export interface CardVm {
  id: TaskId;
  title: string;
  project: string;
  signal: SignalVm;
  tone: "hot" | "warm" | "cold";
  done: boolean;
}

export interface KanbanVm {
  week: string;
  rule: string;
  columns: { key: "committed" | "doing" | "blocked" | "done"; label: string; cards: CardVm[] }[];
}

export interface ReportVm {
  week: string;
  rule: string;
  atRisk: { id: TaskId; title: string; why: string; tone: "danger" | "warn" | "death" }[];
  happened: { id: TaskId; title: string; project: string }[];
  stuck: { id: TaskId; title: string; project: string; why: string }[];
  next: { id: TaskId; title: string; project: string }[];
  /** FR-21 — the week's burndown, with its ideal line flagged fiction. */
  burndown: Burndown;
  /**
   * FR-20 — step back through iterations, BOUNDED at six. `back` walks one week
   * older, `forward` one newer; both are false at the ends. The seventh row is
   * NOT a seventh week — it is `— export —`, because the honest answer to
   * "further back than six" is a data extract he retrospects himself, not a
   * deeper analytics view. This is the exact tripwire: no range, no filter, no
   * compare. If this grows one, the stepper is deleted, not extended.
   */
  stepper: {
    /** 0 = this week … up to 5 = five weeks back. */
    offset: number;
    /** `this week` / `1 week ago` / … — stated, so the depth is never guessed. */
    label: string;
    canBack: boolean;
    canForward: boolean;
    /** True at the oldest step: the row past here reads `— export —`. */
    atFloor: boolean;
  };
  /** The path of the real file he writes in. The app never parses it back. */
  reportPath: string;
}

export interface ViewModel {
  mode: Mode;
  /** AD-7: the resolved absolute path, always on screen. Never dismissible. */
  root: string;
  rootKind: "local" | "configured" | "home";
  backlog: BacklogVm | null;
  kanban: KanbanVm | null;
  report: ReportVm | null;
}

/** host → webview. One message. Always whole. */
export type HostMessage = { type: "render"; vm: ViewModel };

/** webview → host. Intent only — the webview never writes. */
export type WebviewMessage =
  | { type: "ready" }
  | { type: "setMode"; mode: Mode }
  | { type: "openDrain" }
  | { type: "closeDrain" }
  /**
   * FR-8's destinations. `note` needs a target, so it is asked for rather than
   * acted on: the webview cannot pick, so the host opens a QuickPick over
   * `derive/collide` — the SAME engine capture uses, because it is the same
   * question ("what does this touch?") at a later moment.
   *
   * There is deliberately no "create a new project" here — `＋ project` is how a
   * project is made; the drain lands a capture on things that already exist or
   * bins it.
   */
  | { type: "resolveCapture"; id: CaptureId; to: "task" | "note" | "bin"; reason?: string }
  | { type: "setStatus"; id: TaskId; status: "todo" | "doing" | "done" }
  | { type: "commit"; id: TaskId }
  | { type: "uncommit"; id: TaskId }
  | { type: "openReport" }
  /**
   * FR-17 — `⧉ copy` puts the report text on the clipboard for an email. The
   * ONLY sharing that exists. Reading the file to copy it is not AD-9 parsing —
   * it derives no state from the text, it just hands the bytes to the clipboard.
   */
  | { type: "copyReport" }
  /**
   * Pre-fill the week's report file from the material on screen, grouped by
   * project. Replaces the old per-line `pull`: retyping titles one by one was
   * friction with no payoff (his words at the first real run). The useful
   * friction — writing the prose — stays; the app just does the copying.
   *
   * Explicit, never automatic, and it NEVER overwrites: if the file already has
   * content, it is opened as-is. AD-9 still holds — generated from memory,
   * written once, never read back.
   */
  | { type: "prefillReport" }
  /**
   * FR-20 — step the report one week older (`-1`) or newer (`+1`). The host
   * clamps to 0..5; the webview never computes the bound, it only asks. There
   * is deliberately no "jump to week N" — a picker is the range control the
   * tripwire forbids.
   */
  | { type: "stepReport"; delta: -1 | 1 }
  /**
   * FR-22 — export the raw data, then get out of the way. The app owes data,
   * not opinions: this writes the four entity files as one JSON bundle to a
   * path he picks, for retrospection he runs himself, outside the app. It is
   * NOT an analytics view — that is precisely what v1 was and this replaces.
   */
  | { type: "export" }
  /* ---- the sheet ---- */
  | { type: "openSheet"; kind: "task" | "project"; id: TaskId | ProjectId }
  | { type: "closeSheet" }
  /** Unfold / fold a project's task list. A click, and it persists (a11y). */
  | { type: "toggleStrip"; id: ProjectId }
  | { type: "newProject" }
  /**
   * A task born ON a strip, with a project from birth.
   *
   * Capture-resolution is the OTHER way a task is born, and it was the only one
   * — which made the drain the sole road onto the shelf. But capture is the 2s
   * interrupt; deliberately adding work to a project you are looking at is a
   * different gesture, and routing it through the inbox would make him capture a
   * thing he already knows the home of.
   */
  | { type: "newTask"; project: ProjectId }
  /**
   * Saves as you type. `⌘S` is not a thing, there is no dirty state, and there
   * is no save button anywhere in any editor. Text input debounces in the
   * webview (AD-14) — it is the one place the webview leads.
   */
  | { type: "setTitle"; value: string }
  | { type: "setDescription"; value: string }
  | { type: "setDeadline"; value: string | null }
  | { type: "setSheetStatus"; status: "todo" | "doing" | "done" }
  /** Adds the field to the sheet. The rail is an offer; this accepts it. */
  | { type: "addField"; field: SheetField }
  | { type: "removeField"; field: SheetField }
  | { type: "addSubtask"; text: string }
  | { type: "setSubtaskText"; index: number; text: string }
  | { type: "toggleSubtask"; index: number }
  | { type: "removeSubtask"; index: number }
  /** `eventDate` is auto-stamped AND editable — an auto-stamp he cannot correct is a lie in the record. */
  | { type: "addLog"; message: string; eventDate: string }
  | { type: "setLogDate"; index: number; eventDate: string }
  | { type: "addStakeholder"; name: string; direction: "up" | "down" }
  | { type: "setDirection"; id: StakeholderId; direction: "up" | "down" }
  | { type: "removeStakeholder"; id: StakeholderId }
  | { type: "addTag"; tag: string }
  | { type: "removeTag"; tag: string }
  | { type: "setCommit"; weekOf: string | null }
  /** Death is a distinct ending from done. The reason is required and authored. */
  | { type: "letItDie"; reason: "outdated" | "delegated" | "cancelled" }
  | { type: "undie" };
