import type { BandKind } from "../derive/bands.ts";
import type { UrgencySignal } from "../derive/urgency.ts";
import type { CaptureId, ProjectId, TaskId } from "./types.ts";

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
   * Rendered in mono, so it is a computed fact. Platform-resolved — the chords
   * differ per OS, and `derive/` cannot reach `vscode` to know which.
   */
  captureChord: string;
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
   * The drain's resolutions. `project` promotes the capture into a new Project
   * — organizing IS deciding what a thing is, and "it's a new thing" is one of
   * the answers. It lives here rather than on its own surface, because the
   * fourth mode is how v1 became five panels.
   */
  | { type: "resolveCapture"; id: CaptureId; to: "task" | "project" | "bin"; reason?: string }
  | { type: "setStatus"; id: TaskId; status: "todo" | "doing" | "done" }
  | { type: "commit"; id: TaskId }
  | { type: "uncommit"; id: TaskId }
  | { type: "openReport" }
  | { type: "pull"; id: TaskId };
