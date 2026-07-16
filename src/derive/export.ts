import type { Capture, Dataset, Project, Stakeholder, Task, Week } from "../model/types.ts";

/**
 * FR-22 — the raw data, and nothing else.
 *
 * The app owes data, not opinions. This bundle is the four entity files
 * verbatim, stamped with the week it was taken. There is deliberately NO
 * derived field here — no signal, no band, no urgency, no burndown number. A
 * summary is an opinion, and the moment this grows one it has become v1's
 * analytics panel, which is the exact thing FR-22 exists to replace.
 *
 * It is pure so the "raw, never shaped" law is a test, not a hope: adding a
 * computed field to the export breaks `test/export.test.ts` on the key count.
 */
export interface ExportBundle {
  exportedFor: Week;
  projects: Project[];
  tasks: Task[];
  captures: Capture[];
  stakeholders: Stakeholder[];
}

export function exportBundle(data: Dataset, week: Week): ExportBundle {
  return {
    exportedFor: week,
    projects: data.projects,
    tasks: data.tasks,
    captures: data.captures,
    stakeholders: data.stakeholders,
  };
}
