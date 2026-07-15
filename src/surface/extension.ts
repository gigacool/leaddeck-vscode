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
  );
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
