import type { CaptureId, ProjectId, StakeholderId, TaskId } from "./types.ts";

/**
 * Generated, opaque, 8 hex chars.
 *
 * AD-5: no id is ever derived from a name, and no name is ever derived from an
 * id. v1 made the stakeholder id BE the slugified name (`p_sarah`), so a
 * stakeholder could never be renamed without orphaning every reference, and
 * "jean-luc" and "jeanluc" silently forked.
 *
 * Uses the Web Crypto API rather than `node:crypto`, because `model/` imports
 * nothing — the layer is shared by the extension host (Node) and the webview
 * (browser), and the two tsconfigs enforce that. `globalThis.crypto` is present
 * in both.
 */
function suffix(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const newProjectId = (): ProjectId => `pj_${suffix()}`;
export const newTaskId = (): TaskId => `tk_${suffix()}`;
export const newCaptureId = (): CaptureId => `cp_${suffix()}`;
export const newStakeholderId = (): StakeholderId => `sh_${suffix()}`;
