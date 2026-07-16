import * as vscode from "vscode";
import { exportBundle } from "../derive/export.ts";
import type { ChordMap } from "../derive/sheet.ts";
import { buildViewModel, type UiState } from "../derive/viewmodel.ts";
import { toDay, toWeek } from "../model/dates.ts";
import type { HostMessage, Mode, WebviewMessage } from "../model/protocol.ts";
import type { Store } from "../store/store.ts";
import { applyEdit } from "./edit.ts";

/**
 * The rail's chord hints, resolved per platform.
 *
 * EXPERIENCE.md writes every chord in Mac notation, but on Windows those map to
 * chords VS Code already owns: Ctrl+W closes the editor, Ctrl+L expands the
 * selection, Ctrl+F opens find. `⌘W` for "commit to a week" is the worst case —
 * it would close the window.
 *
 * These are HINTS ONLY today: the rail's buttons are clickable, and no
 * `contributes.keybindings` entry binds them yet. Printing a chord that does
 * nothing is a lie, so the Windows set below is what will be bound — chosen to
 * avoid the collisions rather than to mirror the Mac notation.
 */
function chordsFor(platform: NodeJS.Platform): ChordMap {
  return platform === "darwin"
    ? {
        deadline: "⌘D",
        subtasks: "⌘⇧S",
        log: "⌘L",
        stakeholders: "⌘⇧P",
        tags: "⌘T",
        commit: "⌘W",
        die: "⌘⌫",
      }
    : {
        deadline: "Alt+D",
        subtasks: "Alt+S",
        log: "Alt+L",
        stakeholders: "Alt+P",
        tags: "Alt+T",
        commit: "Alt+W",
        die: "Alt+Backspace",
      };
}

/**
 * The ONE webview.
 *
 * Three modes behind a segmented switch — not three panels. v1 aggregated five
 * panels and died of it; the whole discipline here is refusing that.
 *
 * The host owns all logic. It hands the webview a COMPLETE view model per paint
 * and receives intent back (AD-11).
 */
export class Workbench {
  private static current: Workbench | undefined;

  #panel: vscode.WebviewPanel;
  #store: Store;
  #ui: UiState;
  #reportDir: string;
  #disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, store: Store, ui: UiState, reportDir: string) {
    this.#panel = panel;
    this.#store = store;
    this.#ui = ui;
    this.#reportDir = reportDir;

    panel.webview.onDidReceiveMessage(
      (m: WebviewMessage) => void this.#onMessage(m),
      undefined,
      this.#disposables,
    );
    panel.onDidDispose(() => this.dispose(), undefined, this.#disposables);
  }

  static show(
    ctx: vscode.ExtensionContext,
    store: Store,
    rootKind: UiState["rootKind"],
    reportDir: string,
  ): Workbench {
    if (Workbench.current) {
      Workbench.current.#panel.reveal(vscode.ViewColumn.One);
      return Workbench.current;
    }

    const panel = vscode.window.createWebviewPanel(
      "leaddeck.workbench",
      "LeadDeck",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        // AD-12: assets are external files, served from cspSource. That is also
        // what removes the need for a nonce — nothing is inline.
        localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, "media")],
      },
    );

    const wb = new Workbench(panel, store, {
      mode: "backlog",
      drainOpen: false,
      open: null,
      asked: [],
      root: store.root,
      rootKind,
      // Platform-resolved here, because only this layer knows the platform.
      // EXPERIENCE.md writes every chord in Mac notation; Cédric is on Windows,
      // where Ctrl+F / Ctrl+W / Ctrl+L are already VS Code's.
      captureChord: process.platform === "darwin" ? "⌘⌥L" : "Ctrl+Alt+L",
      chords: chordsFor(process.platform),
    }, reportDir);
    panel.webview.html = wb.#html(ctx);
    Workbench.current = wb;
    return wb;
  }

  #html(ctx: vscode.ExtensionContext): string {
    const w = this.#panel.webview;
    const css = w.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, "media", "main.css"));
    const js = w.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, "media", "main.js"));

    // No inline script, so no nonce. `default-src 'none'` plus cspSource for
    // scripts and styles is the whole policy. v1 shipped 'unsafe-inline'.
    const csp = [
      `default-src 'none'`,
      `style-src ${w.cspSource}`,
      `script-src ${w.cspSource}`,
      `font-src ${w.cspSource}`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${css}" rel="stylesheet">
<title>LeadDeck</title>
</head>
<body>
<div id="app"></div>
<script src="${js}"></script>
</body>
</html>`;
  }

  /** Every paint reads the clock ONCE and passes it down (AD-3). */
  render(): void {
    const now = new Date();
    const vm = buildViewModel(
      this.#store.data,
      toDay(now),
      toWeek(now),
      this.#ui,
      this.#reportPath(now),
    );
    const msg: HostMessage = { type: "render", vm };
    void this.#panel.webview.postMessage(msg);
  }

  #reportPath(now: Date): string {
    return `${this.#reportDir}/${toWeek(now)}.md`;
  }

  async #onMessage(m: WebviewMessage): Promise<void> {
    const now = new Date();
    switch (m.type) {
      case "ready":
        this.render();
        return;

      case "setMode":
        // Nothing carries across the switch. The swap is total and cheap.
        this.#ui = { ...this.#ui, mode: m.mode as Mode, drainOpen: false };
        this.render();
        return;

      case "openDrain":
        this.#ui = { ...this.#ui, drainOpen: true };
        this.render();
        return;

      case "closeDrain":
        this.#ui = { ...this.#ui, drainOpen: false };
        this.render();
        return;

      case "resolveCapture":
        await this.#resolveCapture(m, now);
        this.render();
        return;

      case "setStatus":
        await this.#setStatus(m, now);
        this.render();
        return;

      case "commit":
      case "uncommit":
        await this.#setCommit(m.id, m.type === "commit" ? toWeek(now) : null);
        this.render();
        return;

      case "openReport":
        await this.#openReport(now);
        return;

      case "pull":
        await this.#pull(m.id, now);
        return;

      case "export":
        await this.#export(now);
        return;

      case "openSheet":
        // `asked` is per-sheet intent and dies with it: `＋ tag` on one task
        // must not open a blank tag row on the next one he clicks.
        this.#ui = { ...this.#ui, open: { kind: m.kind, id: m.id }, asked: [] };
        this.render();
        return;

      case "closeSheet":
        // Esc closes; nothing is lost, because nothing was ever unsaved.
        this.#ui = { ...this.#ui, open: null, asked: [] };
        this.render();
        return;

      case "newProject":
        await this.#newProject();
        this.render();
        return;

      case "newTask":
        await this.#newTask(m.project, now);
        this.render();
        return;

      default: {
        // Every remaining message is a sheet edit. Saves as you type.
        const open = this.#ui.open;
        if (!open) return;

        // The rail's click is INTENT, and for tags/stakeholders/log there is
        // nothing to write yet — an empty tag is not a tag. Record the ask so
        // the field renders; `applyEdit` still runs, because the fields that
        // CAN take a placeholder (deadline, subtasks) are written there.
        if (m.type === "addField" && !this.#ui.asked.includes(m.field)) {
          this.#ui = { ...this.#ui, asked: [...this.#ui.asked, m.field] };
        }
        // `− remove tag` must retract the ask too, or the row he just dismissed
        // comes straight back on the next paint.
        if (m.type === "removeField") {
          this.#ui = { ...this.#ui, asked: this.#ui.asked.filter((f) => f !== m.field) };
        }

        await applyEdit(this.#store, open, m, now);
        this.render();
        return;
      }
    }
  }

  /**
   * A bare project is a finished project. No name prompt, no wizard, no
   * required fields — it is born empty and the sheet opens on its title.
   */
  async #newProject(): Promise<void> {
    const { newProjectId } = await import("../model/ids.ts");
    const id = newProjectId();
    await this.#store.mutate((d) => {
      d.projects.push({
        id,
        title: "Untitled project",
        description: "",
        deadline: null,
        stakeholders: [],
        tags: [],
        logMessages: [],
      });
      return { touched: ["projects"] };
    });
    this.#ui = { ...this.#ui, open: { kind: "project", id } };
  }

  /**
   * A bare task is a finished task — same law as `＋ project`, one level down.
   *
   * It is born with a project, which is the whole difference from a capture: no
   * inbox, no drain, no "what is this?" — he is looking at the strip, so the
   * answer is already on screen.
   */
  async #newTask(project: string, now: Date): Promise<void> {
    const { newTaskId } = await import("../model/ids.ts");
    const id = newTaskId();
    await this.#store.mutate((d) => {
      if (!d.projects.some((p) => p.id === project)) return { touched: [] };
      d.tasks.push({
        id,
        title: "",
        description: "",
        project: project as never,
        deadline: null,
        status: "todo",
        subtasks: [],
        logMessages: [],
        stakeholders: [],
        tags: [],
        committed: null,
        // A stamp, not a computation (AD-4).
        todoSince: toDay(now),
        doneAt: null,
        death: null,
      });
      return { touched: ["tasks"] };
    });
    // The sheet opens on it, focused on the title — an untitled task is not a
    // thing he must go find and name later.
    this.#ui = { ...this.#ui, open: { kind: "task", id } };
  }

  async #resolveCapture(
    m: Extract<WebviewMessage, { type: "resolveCapture" }>,
    now: Date,
  ): Promise<void> {
    const { newTaskId } = await import("../model/ids.ts");
    const { INBOX_PROJECT_ID } = await import("../model/types.ts");

    /*
     * FR-8's note destinations. The picker runs BEFORE the mutation, because it
     * can be cancelled — and a capture consumed by a resolution he backed out
     * of would be work destroyed by an Esc.
     */
    let target: { kind: "task" | "project"; id: string } | null = null;
    if (m.to === "note") {
      const capture = this.#store.data.captures.find((x) => x.id === m.id);
      if (!capture) return;
      const { pickNoteTarget } = await import("./pick.ts");
      target = await pickNoteTarget(this.#store.data, capture.text);
      if (!target) return; // Esc — the capture stays unsorted. Leaving it is fine.
    }

    await this.#store.mutate((d) => {
      const c = d.captures.find((x) => x.id === m.id);
      if (!c) return { touched: [] };

      if (m.to === "bin") {
        c.state = "resolved";
        return { touched: ["captures"] };
      }

      if (m.to === "note" && target) {
        // The capture's text BECOMES the log message — it is already the note.
        // eventDate is auto-stamped and editable on the sheet: he logs Tuesday's
        // event on Friday, and a stamp he cannot correct is a lie in the record.
        const entry = { eventDate: toDay(now), message: c.text };
        if (target.kind === "task") {
          const t = d.tasks.find((x) => x.id === target!.id);
          if (!t) return { touched: [] };
          t.logMessages.unshift(entry);
          c.state = "resolved";
          return { touched: ["tasks", "captures"] };
        }
        const p = d.projects.find((x) => x.id === target!.id);
        if (!p) return { touched: [] };
        p.logMessages.unshift(entry);
        c.state = "resolved";
        return { touched: ["projects", "captures"] };
      }

      // AD-13: the task is CREATED before the capture is CONSUMED. A crash
      // between the two leaves an orphan, never a void.
      const id = newTaskId();
      d.tasks.push({
        id,
        title: c.text,
        description: "",
        project: INBOX_PROJECT_ID,
        deadline: null,
        status: "todo",
        subtasks: [],
        logMessages: [],
        stakeholders: [],
        tags: [],
        committed: null,
        // A stamp, not a computation (AD-4). Nothing else can produce it, and
        // urgency reads it.
        todoSince: toDay(now),
        doneAt: null,
        death: null,
      });
      c.state = "resolved";
      c.resolvedTo = id;
      return { touched: ["tasks", "captures"] };
    });
  }

  async #setStatus(
    m: Extract<WebviewMessage, { type: "setStatus" }>,
    now: Date,
  ): Promise<void> {
    await this.#store.mutate((d) => {
      const t = d.tasks.find((x) => x.id === m.id);
      if (!t) return { touched: [] };
      t.status = m.status;
      // Stamps, not computations (AD-4). Nothing else can produce these.
      if (m.status === "done") t.doneAt = now.toISOString();
      else {
        t.doneAt = null;
        if (t.todoSince === null) t.todoSince = toDay(now);
      }
      return { touched: ["tasks"] };
    });
  }

  async #setCommit(id: string, weekOf: string | null): Promise<void> {
    await this.#store.mutate((d) => {
      const t = d.tasks.find((x) => x.id === id);
      if (!t) return { touched: [] };
      t.committed = weekOf === null ? null : { weekOf };
      return { touched: ["tasks"] };
    });
  }

  /**
   * The report is a real TextDocument in his own folder — his archive, in his
   * voice. The app never parses it back (AD-9).
   */
  async #openReport(now: Date): Promise<vscode.TextEditor> {
    const uri = vscode.Uri.file(this.#reportPath(now));
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      const week = toWeek(now);
      const skeleton = `# ${week}\n\n## What happened\n\n## Where I'm stuck\n\n## Next week\n`;
      await vscode.workspace.fs.writeFile(uri, Buffer.from(skeleton, "utf8"));
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    return vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  }

  /**
   * THE STANDING LAW — pull inserts a stub, never a sentence.
   *
   * A title and a cursor. Nothing more. ~80% of the report is prose the app
   * cannot produce, and the section works precisely to the extent it doesn't
   * help. Test any change here: does it reduce what he types? If yes, refuse it
   * — even though reducing typing always looks like an improvement.
   */
  async #pull(id: string, now: Date): Promise<void> {
    const task = this.#store.data.tasks.find((t) => t.id === id);
    if (!task) return;

    const editor = await this.#openReport(now);
    // Insert at the cursor. Never read, parse, or seek within the file (AD-9).
    await editor.edit((b) => b.insert(editor.selection.active, `- ${task.title} — `));
    const end = editor.selection.active;
    editor.selection = new vscode.Selection(end, end);
    await vscode.window.showTextDocument(editor.document, editor.viewColumn);
  }

  /**
   * FR-22 — the app owes data, not opinions.
   *
   * The whole dataset, verbatim, as one JSON bundle he chooses the home of.
   * No shaping, no summary, no chart — a summary is an opinion, and this is the
   * feature that replaces v1's analytics panel by refusing to be one. What he
   * does with it (a spreadsheet, a script, a diff against last month) is his,
   * outside the app.
   */
  async #export(now: Date): Promise<void> {
    const bundle = exportBundle(this.#store.data, toWeek(now));
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${this.#reportDir}/leaddeck-export-${toWeek(now)}.json`),
      filters: { JSON: ["json"] },
      saveLabel: "Export",
    });
    // Cancelled — no dialog, no file. An export he backed out of is not a file
    // written somewhere he did not choose.
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(bundle, null, 2), "utf8"));
    await vscode.commands.executeCommand("revealFileInOS", target);
  }

  dispose(): void {
    Workbench.current = undefined;
    this.#panel.dispose();
    for (const d of this.#disposables) d.dispose();
    this.#disposables = [];
  }

  /** A foreign write landed (AD-8). Repaint. */
  onExternalChange(): void {
    this.render();
  }
}
