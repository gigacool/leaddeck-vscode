import { randomBytes } from "node:crypto";
import type { CaptureId, ProjectId, StakeholderId, TaskId } from "./types.ts";

/**
 * Generated, opaque, 8 chars.
 *
 * AD-5: no id is ever derived from a name, and no name is ever derived from an
 * id. v1 made the stakeholder id BE the slugified name (`p_sarah`), so a
 * stakeholder could never be renamed without orphaning every reference, and
 * "jean-luc" and "jeanluc" silently forked.
 */
function suffix(): string {
  return randomBytes(4).toString("hex");
}

export const newProjectId = (): ProjectId => `pj_${suffix()}`;
export const newTaskId = (): TaskId => `tk_${suffix()}`;
export const newCaptureId = (): CaptureId => `cp_${suffix()}`;
export const newStakeholderId = (): StakeholderId => `sh_${suffix()}`;
