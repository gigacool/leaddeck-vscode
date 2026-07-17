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
    view.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 12px 12px 8px; font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground); }
  .act {
    display: flex; align-items: center; gap: 9px; width: 100%;
    text-align: left; margin: 0 0 8px; padding: 8px 11px;
    background: var(--vscode-button-secondaryBackground, #313131);
    color: var(--vscode-button-secondaryForeground, #ccc);
    border: 1px solid transparent; border-radius: 4px; cursor: pointer; font: inherit;
  }
  .act.pri { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .act:hover { background: var(--vscode-button-secondaryHoverBackground, #3c3c3c); }
  .act.pri:hover { background: var(--vscode-button-hoverBackground); }
  .act:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .ico { font-size: 15px; line-height: 1; width: 16px; text-align: center; flex: 0 0 auto; }
  .lbl { flex: 1; }
  .kbd { font-family: var(--vscode-editor-font-family, monospace); font-size: 10px; opacity: .7; white-space: nowrap; }
  .sep { height: 1px; background: var(--vscode-widget-border, #454545); margin: 4px 0 12px; opacity: .5; }
</style></head><body>
  <button class="act pri" onclick="go('leaddeck.open')">
    <span class="ico">▤</span><span class="lbl">Open workbench</span><span class="kbd" id="k-open"></span>
  </button>
  <button class="act" onclick="go('leaddeck.capture')">
    <span class="ico">⚡</span><span class="lbl">Capture a thought</span><span class="kbd" id="k-cap"></span>
  </button>
  <div class="sep"></div>
  <script>
    const vscode = acquireVsCodeApi();
    function go(cmd) { vscode.postMessage({ cmd }); }
    const mac = navigator.platform.toLowerCase().includes('mac');
    document.getElementById('k-open').textContent = mac ? '⌘⌥O' : 'Ctrl+Alt+O';
    document.getElementById('k-cap').textContent = mac ? '⌘⌥L' : 'Ctrl+Alt+L';
  </script>
</body></html>`;
    view.webview.onDidReceiveMessage((m: { cmd?: string }) => {
      if (m.cmd === "leaddeck.open" || m.cmd === "leaddeck.capture") {
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
