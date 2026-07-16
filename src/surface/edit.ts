import type { EntityFile, Project, StakeholderId, Task } from "../model/types.ts";
import { newStakeholderId } from "../model/ids.ts";
import type { SheetField, WebviewMessage } from "../model/protocol.ts";
import type { Store } from "../store/store.ts";
import { toDay, toWeek } from "../model/dates.ts";

/**
 * Sheet mutations.
 *
 * Saves as you type. `⌘S` is not a thing — no dirty state, no save button, no
 * cancel. The webview debounces text input (AD-14); everything here writes
 * immediately.
 *
 * Split out of panel.ts because that file's job is the webview contract, and
 * this file's job is the model. They drift apart otherwise.
 */

export type Target = { kind: "task" | "project"; id: string };

type Edit = Extract<
  WebviewMessage,
  | { type: "setTitle" }
  | { type: "setDescription" }
  | { type: "setDeadline" }
  | { type: "setSheetStatus" }
  | { type: "addField" }
  | { type: "removeField" }
  | { type: "addSubtask" }
  | { type: "setSubtaskText" }
  | { type: "toggleSubtask" }
  | { type: "removeSubtask" }
  | { type: "addLog" }
  | { type: "setLogDate" }
  | { type: "addStakeholder" }
  | { type: "setDirection" }
  | { type: "removeStakeholder" }
  | { type: "addTag" }
  | { type: "removeTag" }
  | { type: "setCommit" }
  | { type: "letItDie" }
  | { type: "undie" }
>;

export async function applyEdit(
  store: Store,
  target: Target,
  m: Edit,
  now: Date,
): Promise<void> {
  await store.mutate((d) => {
    const task = target.kind === "task" ? d.tasks.find((t) => t.id === target.id) : undefined;
    const project =
      target.kind === "project" ? d.projects.find((p) => p.id === target.id) : undefined;
    const entity = task ?? project;
    if (!entity) return { touched: [] };

    const file: EntityFile = target.kind === "task" ? "tasks" : "projects";
    const touched: EntityFile[] = [file];

    switch (m.type) {
      case "setTitle":
        // A title is the one thing that must exist. Refuse to empty it rather
        // than storing a nameless row.
        if (m.value.trim().length > 0) entity.title = m.value;
        break;

      case "setDescription":
        entity.description = m.value;
        break;

      case "setDeadline":
        entity.deadline = m.value;
        break;

      case "setSheetStatus":
        if (!task) break;
        task.status = m.status;
        // Stamps, not computations (AD-4). Nothing else produces these, and
        // with no event log they cannot be recovered later.
        if (m.status === "done") task.doneAt = now.toISOString();
        else {
          task.doneAt = null;
          if (task.todoSince === null) task.todoSince = toDay(now);
        }
        break;

      case "addField":
        addField(entity, m.field, now);
        break;

      case "removeField":
        removeField(entity, m.field);
        break;

      case "addSubtask":
        if (task && m.text.trim().length > 0) task.subtasks.push({ text: m.text, done: false });
        break;

      case "setSubtaskText": {
        const st = task?.subtasks[m.index];
        if (st) st.text = m.text;
        break;
      }

      case "toggleSubtask": {
        const st = task?.subtasks[m.index];
        if (st) st.done = !st.done;
        break;
      }

      case "removeSubtask":
        if (task) task.subtasks.splice(m.index, 1);
        break;

      case "addLog":
        // Newest first. eventDate is auto-stamped AND editable: he logs
        // Tuesday's event on Friday, and an auto-stamp he cannot correct is a
        // lie in the record.
        if (m.message.trim().length > 0) {
          entity.logMessages.unshift({ eventDate: m.eventDate, message: m.message });
        }
        break;

      case "setLogDate": {
        const lg = entity.logMessages[m.index];
        // Nothing records THAT it was corrected. The PRD deferred that trail
        // deliberately: "it's ok to have a history resource but we can/should
        // keep it simple."
        if (lg) lg.eventDate = m.eventDate;
        break;
      }

      case "addStakeholder": {
        const name = m.name.trim();
        if (name.length === 0) break;
        // A stakeholder is a real entity with a generated id (AD-5). Match on
        // name to avoid a duplicate row, but NEVER derive the id from it — that
        // was v1's bug, and it made rename impossible.
        let sh = d.stakeholders.find((s) => s.name.toLowerCase() === name.toLowerCase());
        if (!sh) {
          sh = { id: newStakeholderId(), name };
          d.stakeholders.push(sh);
          // AD-13: the stakeholder is CREATED before the row that CONSUMES it.
          touched.unshift("stakeholders");
        }
        if (!entity.stakeholders.some((r) => r.id === sh!.id)) {
          entity.stakeholders.push({ id: sh.id, direction: m.direction });
        }
        break;
      }

      case "setDirection": {
        const ref = entity.stakeholders.find((r) => r.id === m.id);
        if (ref) ref.direction = m.direction;
        break;
      }

      case "removeStakeholder":
        entity.stakeholders = entity.stakeholders.filter((r) => r.id !== m.id);
        break;

      case "addTag": {
        const tag = m.tag.trim();
        if (tag.length > 0 && !entity.tags.includes(tag)) entity.tags.push(tag);
        break;
      }

      case "removeTag":
        entity.tags = entity.tags.filter((t) => t !== m.tag);
        break;

      case "setCommit":
        // The only real judgment he authors. Everything else is computed.
        if (task) task.committed = m.weekOf === null ? null : { weekOf: m.weekOf };
        break;

      case "letItDie":
        // A distinct ending from `done`. The reason is authored — the one
        // documented exception to "a new typed field is a design failure by
        // default", because nothing computes *why did this die?* and it is the
        // export's raw material.
        if (task) task.death = { reason: m.reason, at: now.toISOString() };
        break;

      case "undie":
        if (task) task.death = null;
        break;
    }

    return { touched };
  });
}

/**
 * The rail is an offer; this accepts it.
 *
 * A field is "on" when it holds something — there is no per-field visibility
 * flag, because that would be a second model of the same fact. So accepting the
 * offer means writing a minimal value.
 */
function addField(entity: Task | Project, field: SheetField, now: Date): void {
  switch (field) {
    case "deadline":
      if (entity.deadline === null) entity.deadline = toDay(now);
      break;
    case "description":
      // A space, so `description.length > 0` reads as present. The user is
      // about to type over it.
      if (entity.description.length === 0) entity.description = " ";
      break;
    case "subtasks":
      if ("subtasks" in entity && entity.subtasks.length === 0) {
        entity.subtasks.push({ text: "", done: false });
      }
      break;
    case "log":
      break; // The webview opens the add-line; nothing is written until he types.
    case "stakeholders":
      break; // Needs a name. The webview opens the add-line.
    case "tags":
      break; // Needs a tag. The webview opens the add-line.
    case "commit":
      if ("committed" in entity && entity.committed === null) {
        entity.committed = { weekOf: toWeek(now) };
      }
      break;
  }
}

function removeField(entity: Task | Project, field: SheetField): void {
  switch (field) {
    case "deadline":
      entity.deadline = null;
      break;
    case "description":
      entity.description = "";
      break;
    case "subtasks":
      if ("subtasks" in entity) entity.subtasks = [];
      break;
    case "log":
      entity.logMessages = [];
      break;
    case "stakeholders":
      entity.stakeholders = [];
      break;
    case "tags":
      entity.tags = [];
      break;
    case "commit":
      if ("committed" in entity) entity.committed = null;
      break;
  }
}

export type { StakeholderId };
