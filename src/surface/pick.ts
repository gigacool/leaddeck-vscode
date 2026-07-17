import * as vscode from "vscode";
import { collide, type Collision } from "../derive/collide.ts";
import { toDay } from "../model/dates.ts";
import type { Dataset } from "../model/types.ts";

/**
 * "Which existing thing is this about?"
 *
 * The same question capture asks in its 2s window, asked again in the drain —
 * so it uses the same engine (`derive/collide`) and the same QuickPick shape.
 * Two pickers over the same question would drift into two answers.
 *
 * The difference is only WHEN: capture asks before the thing exists as a
 * record; the drain asks about a capture already on the shelf. That is a
 * different moment, not a different question, so it is not a different surface.
 */

interface Item extends vscode.QuickPickItem {
  hit: Collision;
}

export interface NoteTarget {
  kind: "task" | "project";
  id: string;
}

/**
 * `alwaysShow: true` defeats the QuickPick's mandatory filter so `collide` owns
 * MEMBERSHIP (see capture.ts — v1 poisoned `description` to the same end, at
 * the cost of the slot FR-3 needs for the signal). Sort order stays VS Code's
 * until `sortByLabel` stabilizes; logged, not hidden.
 */
export function pickNoteTarget(data: Dataset, seed: string): Promise<NoteTarget | null> {
  return new Promise((resolve) => {
    const qp = vscode.window.createQuickPick<Item>();
    // The capture's text is the QUESTION, so it stays on screen as the title
    // rather than in the input. Seeding the input with it looked helpful and was
    // not: `collide` demands EVERY token hit, so a whole sentence matches almost
    // nothing — and when it did match, it found the task that capture had just
    // become. He types the one word he means instead.
    qp.title = seed;
    qp.placeholder = "what does this touch?";
    qp.matchOnDescription = false;
    qp.matchOnDetail = false;

    const row = (h: Collision): Item => ({
      label: h.kind === "task" ? `$(circle-outline) ${h.title}` : `$(folder) ${h.title}`,
      description: [h.context, h.signal && h.signal.kind !== "quiet" ? signalText(h) : ""]
        .filter(Boolean)
        .join("  ·  "),
      alwaysShow: true,
      hit: h,
    });

    const now = toDay(new Date());

    const everything = (): Item[] => [
      ...data.tasks
        .filter((t) => t.death === null && t.status !== "done")
        .map((t) =>
          row({
            kind: "task",
            id: t.id,
            title: t.title,
            context: data.projects.find((p) => p.id === t.project)?.title ?? "",
            signal: null,
            score: 0,
          }),
        ),
      ...data.projects.map((p) =>
        row({ kind: "project", id: p.id, title: p.title, context: "", signal: null, score: 0 }),
      ),
    ];

    const refresh = (value: string): void => {
      const text = value.trim();
      // Empty input shows everything alive, not nothing. Capture opens blank
      // because he is mid-sentence and about to type; here he is already
      // looking, and an empty picker reads as "there is nothing to note on".
      qp.items = text.length === 0 ? everything() : collide(text, data, now).map(row);
    };

    refresh("");
    qp.onDidChangeValue(refresh);

    let done = false;
    qp.onDidAccept(() => {
      const picked = qp.selectedItems[0];
      if (!picked) return;
      done = true;
      qp.hide();
      resolve({ kind: picked.hit.kind, id: picked.hit.id });
    });

    // Esc resolves null, and the capture stays UNSORTED — nothing is consumed
    // by a resolution he backed out of. Leaving it is fine; that is the drain.
    qp.onDidHide(() => {
      qp.dispose();
      if (!done) resolve(null);
    });

    qp.show();
  });
}

/**
 * "Which project is this task's home?" — asked when a capture resolves to a
 * task (B3). Projects only (a task lives in a project, never in another task),
 * Inbox included and first, so the fast path stays one keystroke. Returns the
 * chosen project id, or null on Esc — the host then defaults to the Inbox.
 *
 * A plain project list is small enough that VS Code's native filter is right;
 * `collide` earns its place when tasks and projects compete in one list, not
 * here.
 */
export function pickProject(data: Dataset, seed: string): Promise<string | null> {
  interface P extends vscode.QuickPickItem {
    id: string;
  }
  return new Promise((resolve) => {
    const qp = vscode.window.createQuickPick<P>();
    qp.title = seed;
    qp.placeholder = "which project? (Esc → Inbox)";
    // Inbox first — it is the default home, and the one he reaches for most.
    const inbox = data.projects.find((p) => p.id === "pj_inbox");
    const rest = data.projects.filter((p) => p.id !== "pj_inbox");
    qp.items = [
      ...(inbox ? [{ label: "$(inbox) Inbox", id: inbox.id }] : []),
      ...rest.map((p) => ({ label: `$(folder) ${p.title}`, id: p.id })),
    ];

    let done = false;
    qp.onDidAccept(() => {
      const picked = qp.selectedItems[0];
      if (!picked) return;
      done = true;
      qp.hide();
      resolve(picked.id);
    });
    qp.onDidHide(() => {
      qp.dispose();
      if (!done) resolve(null); // Esc → the host uses the Inbox
    });
    qp.show();
  });
}

function signalText(h: Collision): string {
  const s = h.signal;
  if (!s) return "";
  switch (s.kind) {
    case "overdue":
      return `${s.days}d over`;
    case "due":
      return `${s.days}d`;
    case "blocked":
      return s.days > 0 ? `blocked ${s.days}d` : "blocked";
    case "waiting":
      return `waiting on ${s.who}`;
    case "rotting":
      return `idle ${s.days}d`;
    case "quiet":
      return "";
  }
}
