import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/**
 * AD-6 — one storage root, resolved once, by existence alone.
 *
 * The wrong dataset looks exactly like an empty backlog. That is the only error
 * class here with no visible symptom, which is why `present` means the
 * directory EXISTS and its contents are never consulted: a root that resolved
 * differently when empty would BE the silent switch this rule exists to prevent.
 */

export type RootKind = "local" | "configured" | "home";

export interface ResolvedRoot {
  /** Absolute. This — never the configured string — is what the header renders (AD-7). */
  path: string;
  kind: RootKind;
}

export interface RootInputs {
  /** `workspaceFolders[0]` only. A `.leaddeck` elsewhere in a multi-root workspace is ignored. */
  firstWorkspaceFolder: string | null;
  /** `leaddeck.storagePath`. Empty or whitespace counts as unset. */
  configuredPath: string | null;
  home?: string;
  exists?: (p: string) => boolean;
}

function expandHome(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(home, p.slice(2));
  return p;
}

export function resolveRoot(inputs: RootInputs): ResolvedRoot {
  const home = inputs.home ?? homedir();
  const exists = inputs.exists ?? existsSync;

  if (inputs.firstWorkspaceFolder) {
    const local = join(inputs.firstWorkspaceFolder, ".leaddeck");
    if (exists(local)) return { path: resolve(local), kind: "local" };
  }

  const configured = inputs.configuredPath?.trim();
  if (configured) {
    const expanded = expandHome(configured, home);
    const abs = isAbsolute(expanded) ? expanded : resolve(expanded);
    return { path: resolve(abs), kind: "configured" };
  }

  return { path: resolve(join(home, "LeadDeck")), kind: "home" };
}

export function describeRoot(root: ResolvedRoot): string {
  return root.kind === "local" ? ".leaddeck (local)" : root.path;
}
