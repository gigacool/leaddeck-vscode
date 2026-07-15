import * as vscode from "vscode";
import { collide, type Collision } from "../derive/collide.ts";
import { toDay } from "../model/dates.ts";
import { newCaptureId } from "../model/ids.ts";
import type { Store } from "../store/store.ts";

/**
 * Capture — the two-second gesture.
 *
 * Someone is at his desk, mid-sentence. He hits the keybinding, types, and the
 * collision surfaces BEFORE the word is finished. Then Esc, and he never left
 * the conversation.
 *
 * The default posture is not *create* — it is *what does this touch?*
 */

interface Item extends vscode.QuickPickItem {
  hit?: Collision;
  action: "note-task" | "note-project" | "new-capture";
}

/**
 * VS Code's QuickPick ALWAYS re-filters items against the typed value. There is
 * no `matchOnLabel: false`, and the custom-filter request has sat in Backlog
 * since 2020.
 *
 * v1's workaround was to poison every item's `description` with the query string
 * so the mandatory filter passed everything through — at the cost of smearing
 * the query across every row, in exactly the slot FR-3 needs for the computed
 * signal.
 *
 * `alwaysShow` is stable API and does the same job cleanly: the filter stops
 * hiding our items, so `derive/collide` owns MEMBERSHIP. Sort order is still
 * VS Code's until `sortByLabel` stabilizes — that gap is logged, not hidden.
 */
export function captureCommand(store: Store, onChange: () => void): vscode.Disposable {
  return vscode.commands.registerCommand("leaddeck.capture", async () => {
    const qp = vscode.window.createQuickPick<Item>();
    qp.placeholder = "capture — or type to find what this touches";
    qp.matchOnDescription = false;
    qp.matchOnDetail = false;

    const refresh = (value: string): void => {
      const text = value.trim();
      if (text.length === 0) {
        qp.items = [];
        return;
      }

      const now = toDay(new Date());
      const hits = collide(text, store.data, now);

      const items: Item[] = hits.map((h) => ({
        label: h.kind === "task" ? `$(circle-outline) ${h.title}` : `$(folder) ${h.title}`,
        // title + project + computed signal. The signal keeps this slot; the
        // query does not go here.
        description: [h.context, h.signal && h.signal.kind !== "quiet" ? signalText(h) : ""]
          .filter(Boolean)
          .join("  ·  "),
        alwaysShow: true,
        hit: h,
        action: h.kind === "task" ? "note-task" : "note-project",
      }));

      // All three resolutions are peers. Create is not privileged.
      items.push({
        label: `$(inbox) "${text}"`,
        description: "new capture — decide later",
        alwaysShow: true,
        action: "new-capture",
      });

      qp.items = items;
    };

    qp.onDidChangeValue(refresh);

    qp.onDidAccept(() => {
      const picked = qp.selectedItems[0];
      const text = qp.value.trim();
      qp.hide();
      if (!picked || text.length === 0) return;
      void resolve(store, picked, text).then(onChange);
    });

    qp.onDidHide(() => qp.dispose());
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

async function resolve(store: Store, item: Item, text: string): Promise<void> {
  const now = new Date();
  const day = toDay(now);

  await store.mutate((d) => {
    switch (item.action) {
      case "note-task": {
        const t = d.tasks.find((x) => x.id === item.hit!.id);
        if (!t) return { touched: [] };
        // eventDate is auto-stamped AND editable: he logs Tuesday's event on
        // Friday, and an auto-stamp he cannot correct is a lie in the record.
        t.logMessages.unshift({ eventDate: day, message: text });
        return { touched: ["tasks"] };
      }
      case "note-project": {
        const p = d.projects.find((x) => x.id === item.hit!.id);
        if (!p) return { touched: [] };
        p.logMessages.unshift({ eventDate: day, message: text });
        return { touched: ["projects"] };
      }
      case "new-capture": {
        // A Capture is NOT a Task. Raw text, a timestamp, no project.
        // No sigils are parsed — structure at capture time is what he skips
        // under pressure.
        d.captures.push({
          id: newCaptureId(),
          text,
          capturedAt: now.toISOString(),
          state: "unsorted",
          resolvedTo: null,
        });
        return { touched: ["captures"] };
      }
    }
  });
}
