import * as vscode from "vscode";
import { buildViewModel, type UiState } from "../derive/viewmodel.ts";
import { toDay, toWeek } from "../model/dates.ts";
import type { HostMessage, Mode, WebviewMessage } from "../model/protocol.ts";
import type { Store } from "../store/store.ts";

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
      root: store.root,
      rootKind,
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
    }
  }

  async #resolveCapture(
    m: Extract<WebviewMessage, { type: "resolveCapture" }>,
    now: Date,
  ): Promise<void> {
    const { newTaskId } = await import("../model/ids.ts");
    const { INBOX_PROJECT_ID } = await import("../model/types.ts");

    await this.#store.mutate((d) => {
      const c = d.captures.find((x) => x.id === m.id);
      if (!c) return { touched: [] };

      if (m.to === "bin") {
        c.state = "resolved";
        return { touched: ["captures"] };
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
