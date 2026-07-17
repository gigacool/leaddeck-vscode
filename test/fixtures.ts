import { newProjectId, newStakeholderId, newTaskId } from "../src/model/ids.ts";
import {
  INBOX_PROJECT_ID,
  type Capture,
  type Dataset,
  type Project,
  type Stakeholder,
  type Task,
} from "../src/model/types.ts";

export const NOW = "2026-07-15";

export function aTask(over: Partial<Task> = {}): Task {
  return {
    id: newTaskId(),
    title: "Ship API docs",
    description: "",
    project: INBOX_PROJECT_ID,
    deadline: null,
    status: "todo",
    subtasks: [],
    logMessages: [],
    stakeholders: [],
    tags: [],
    committed: null,
    todoSince: NOW,
    doneAt: null,
    death: null,
    ...over,
  };
}

export function aProject(over: Partial<Project> = {}): Project {
  return {
    id: newProjectId(),
    title: "Helvetia bid",
    description: "",
    deadline: null,
    stakeholders: [],
    tags: [],
    logMessages: [],
    archived: null,
    ...over,
  };
}

export function aStakeholder(over: Partial<Stakeholder> = {}): Stakeholder {
  return { id: newStakeholderId(), name: "Sarah", ...over };
}

export function aCapture(over: Partial<Capture> = {}): Capture {
  return {
    id: "cp_00000001" as Capture["id"],
    text: "sarah asked about api docs status",
    capturedAt: "2026-07-15T09:14:00.000Z",
    state: "unsorted",
    resolvedTo: null,
    ...over,
  };
}

export function dataset(over: Partial<Dataset> = {}): Dataset {
  const inbox: Project = {
    id: INBOX_PROJECT_ID,
    title: "Inbox",
    description: "",
    deadline: null,
    stakeholders: [],
    tags: [],
    logMessages: [],
    archived: null,
  };
  return {
    projects: [inbox],
    tasks: [],
    captures: [],
    stakeholders: [],
    ...over,
  };
}

/** `now` minus n days, as a Day. */
export function daysAgo(n: number): string {
  const d = new Date(2026, 6, 15);
  d.setDate(d.getDate() - n);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function daysAhead(n: number): string {
  return daysAgo(-n);
}
