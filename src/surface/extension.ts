import { join } from "node:path";
import * as vscode from "vscode";
import { ENTITY_FILES, type EntityFile } from "../model/types.ts";
import { describeRoot, resolveRoot, type ResolvedRoot } from "../store/root.ts";
import { Store } from "../store/store.ts";
import { captureCommand } from "./capture.ts";
import { Workbench } from "./panel.ts";

/**
 * The extension entry. The only layer that touches `vscode`.
 *
 * Entry point is a command + keybinding, deliberately: an Activity Bar icon
 * cannot open an editor webview, and the sidebar's width fights the shelf —
 * 17 projects and 63 tasks have to fit above the fold, and density is the
 * feature.
 */

let store: Store | undefined;
let workbench: Workbench | undefined;

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const root = resolveStorageRoot();

  try {
    store = await Store.open({ root: root.path });
  } catch (e) {
    // AD-10 — a bad file halts activation ENTIRELY. The webview is never
    // registered. Partial load is forbidden: three quarters of a dataset is the
    // wrong-dataset symptom, and there is no event log to rebuild from, so the
    // JSON is the only copy. Never repaired, never rewritten.
    const msg = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(`LeadDeck did not start — ${msg}`, { modal: true });
    return;
  }

  const reportDir = join(root.path, "reports");
  const show = (): Workbench => {
    workbench = Workbench.show(ctx, store!, root.kind, reportDir);
    return workbench;
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand("leaddeck.open", () => {
      show().render();
    }),
    captureCommand(store, () => workbench?.onExternalChange()),
    vscode.commands.registerCommand("leaddeck.celebrate", () => {
      // Open the workbench if it isn't, so the confetti has a full canvas.
      show().render();
      workbench?.celebrate();
      void vscode.window.showInformationMessage("Nice — a small win is still a win. 🎉");
    }),
    watch(root),
    ...statusBar(),
    vscode.window.registerWebviewViewProvider("leaddeck.launcher", new LauncherView()),
    // Restore the workbench on restart — VS Code reopens the panel and hands it
    // back here, so it comes back with the other editors instead of vanishing.
    vscode.window.registerWebviewPanelSerializer("leaddeck.workbench", {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
        if (!store) return;
        workbench = Workbench.revive(ctx, panel, store, root.kind, reportDir);
        workbench.render();
      },
    }),
  );
}

/**
 * Two status-bar buttons — a permanent, always-visible way in that fits a
 * way of working the command palette does not. They only LAUNCH the commands;
 * the workbench is still an editor webview (it cannot live in the status bar),
 * and capture is still the native QuickPick.
 */
function statusBar(): vscode.Disposable[] {
  const capture = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  capture.text = "$(zap) Capture";
  capture.tooltip = "LeadDeck: capture a thought (Ctrl+Alt+L)";
  capture.command = "leaddeck.capture";
  capture.show();

  const open = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  open.text = "$(checklist) LeadDeck";
  open.tooltip = "LeadDeck: open the workbench (Ctrl+Alt+O)";
  open.command = "leaddeck.open";
  open.show();

  return [capture, open];
}

/**
 * The Activity Bar entry. An activity-bar icon CANNOT open an editor webview
 * directly (that is why the workbench is a command), so this is a tiny sidebar
 * view whose two buttons run the same commands. It is the discoverable front
 * door; the keybindings and status bar remain the fast paths.
 */
class LauncherView implements vscode.WebviewViewProvider {
  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true };
    // Styled after the Source Control view: NO background of its own — it
    // inherits the side-bar's, so it never reads as an aggressive black block.
    // Grey intro copy, then full-width centred buttons like "Initialize
    // Repository". Nothing here sets a body background.
    view.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  :root { color-scheme: light dark; }
  html, body { background: var(--vscode-sideBar-background, transparent); }
  body { margin: 0; padding: 14px 16px; font-family: var(--vscode-font-family); font-size: 13px; line-height: 1.5; color: var(--vscode-foreground); }
  p { margin: 0 0 14px; color: var(--vscode-descriptionForeground); }
  .btn {
    display: block; width: 100%; text-align: center;
    margin: 0 0 16px; padding: 5px 12px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px;
    cursor: pointer; font: inherit;
  }
  .btn:hover { background: var(--vscode-button-hoverBackground); }
  .btn:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .kbd { font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; opacity: .7; }
  .btn.celebrate { background: transparent; color: var(--vscode-foreground); border: 1px dashed var(--vscode-widget-border, #555); }
  .btn.celebrate:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.15)); }
  #confetti { position: fixed; inset: 0; pointer-events: none; z-index: 10; }
</style></head><body>
  <canvas id="confetti"></canvas>
  <p>Your board, and quick capture. Open the workbench to see projects, the week, and the report.</p>
  <button class="btn" onclick="go('leaddeck.open')">Open workbench</button>
  <p>Jot a thought without leaving what you're doing — it lands unsorted for you to file later.</p>
  <button class="btn" onclick="go('leaddeck.capture')">Capture a thought</button>
  <p><span class="kbd" id="k-open"></span> · <span class="kbd" id="k-cap"></span></p>
  <hr style="border:none;border-top:1px solid var(--vscode-widget-border,#454545);opacity:.5;margin:6px 0 14px">
  <p>A small win is still a win.</p>
  <button class="btn celebrate" onclick="celebrate(); go('leaddeck.celebrate')">🎉 Celebrate</button>
  <script>
    const vscode = acquireVsCodeApi();
    function go(cmd) { vscode.postMessage({ cmd }); }
    const mac = navigator.platform.toLowerCase().includes('mac');
    document.getElementById('k-open').textContent = mac ? '⌘⌥O open' : 'Ctrl+Alt+O open';
    document.getElementById('k-cap').textContent = mac ? '⌘⌥L capture' : 'Ctrl+Alt+L capture';

    // Confetti — vanilla canvas, no dependency (the strict CSP blocks any CDN).
    // A burst of coloured pieces that fall, spin, and fade. Runs a few seconds.
    const cv = document.getElementById('confetti');
    const ctx = cv.getContext('2d');
    const COLOURS = ['#f94144','#f3722c','#f9c74f','#90be6d','#43aa8b','#577590','#c77dff'];
    let pieces = [], raf = 0;
    function size() { cv.width = cv.clientWidth; cv.height = cv.clientHeight; }
    function celebrate() {
      size();
      const N = 120;
      for (let i = 0; i < N; i++) {
        pieces.push({
          x: cv.width / 2 + (Math.random() - 0.5) * cv.width * 0.4,
          y: cv.height * 0.35 + (Math.random() - 0.5) * 40,
          vx: (Math.random() - 0.5) * 6,
          vy: Math.random() * -7 - 3,
          g: 0.18 + Math.random() * 0.1,
          w: 5 + Math.random() * 5, h: 8 + Math.random() * 6,
          rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
          life: 90 + Math.random() * 50,
          c: COLOURS[(Math.random() * COLOURS.length) | 0],
        });
      }
      if (!raf) tick();
    }
    function tick() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      pieces = pieces.filter((p) => p.life > 0 && p.y < cv.height + 20);
      for (const p of pieces) {
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life--;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 40));
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (pieces.length) { raf = requestAnimationFrame(tick); }
      else { ctx.clearRect(0, 0, cv.width, cv.height); raf = 0; }
    }
  </script>
</body></html>`;
    view.webview.onDidReceiveMessage((m: { cmd?: string }) => {
      if (
        m.cmd === "leaddeck.open" ||
        m.cmd === "leaddeck.capture" ||
        m.cmd === "leaddeck.celebrate"
      ) {
        void vscode.commands.executeCommand(m.cmd);
      }
    });
  }
}

/**
 * AD-6 — resolved ONCE, at activation. Exactly one root is live for the session.
 * Never merged, never a read-time fallback chain.
 */
function resolveStorageRoot(): ResolvedRoot {
  const folders = vscode.workspace.workspaceFolders;
  return resolveRoot({
    // Only workspaceFolders[0] is consulted. A .leaddeck elsewhere in a
    // multi-root workspace is ignored, and the header chip is the disclosure.
    firstWorkspaceFolder: folders?.[0]?.uri.fsPath ?? null,
    configuredPath:
      vscode.workspace.getConfiguration("leaddeck").get<string>("storagePath") ?? null,
  });
}

/**
 * AD-8 — a global root means the same data opens in EVERY window, so
 * multi-window is the normal case, not an edge case. v1 assumed one window and
 * had no cross-process protection at all.
 *
 * Non-recursive, never `**`: recursive watchers are subject to the user's
 * `files.watcherExclude`, and the flat four-file layout makes avoiding them
 * free. `reports/` is not watched — it is write-only to the app (AD-9).
 */
function watch(root: ResolvedRoot): vscode.Disposable {
  const pattern = new vscode.RelativePattern(vscode.Uri.file(root.path), "*.json");
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  const onChange = async (uri: vscode.Uri): Promise<void> => {
    const file = fileOf(uri);
    if (!file || !store) return;

    const stat = await vscode.workspace.fs.stat(uri).then(
      (s) => s,
      () => undefined,
    );
    if (!stat) return;

    // Our own write echoing back. Cleared by write-generation, not by path
    // alone and not by content hash.
    if (store.isSelfWrite(file, stat.mtime)) return;

    // Foreign: reload that file WHOLE and repaint. Never merge.
    try {
      await store.reloadFile(file);
      workbench?.onExternalChange();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`LeadDeck — ${file}.json changed and is now invalid: ${msg}`);
    }
  };

  watcher.onDidChange((uri) => void onChange(uri));
  watcher.onDidCreate((uri) => void onChange(uri));
  return watcher;
}

function fileOf(uri: vscode.Uri): EntityFile | null {
  const name = uri.path.split("/").pop()?.replace(/\.json$/, "");
  return ENTITY_FILES.find((f) => f === name) ?? null;
}

export function deactivate(): void {
  workbench?.dispose();
  workbench = undefined;
  store = undefined;
}

export { describeRoot };
