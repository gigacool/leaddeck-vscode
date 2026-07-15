import type {
  Capture,
  Dataset,
  EntityFile,
  LogMessage,
  Project,
  StakeholderRef,
  Stakeholder,
  Subtask,
  Task,
} from "../model/types.ts";

/**
 * Boundary validation.
 *
 * AD-10: a file that fails to parse or validate halts activation entirely, and
 * is never rewritten or repaired. With no event log, the JSON is the only copy
 * (AD-2) — so this is the rule that makes deleting the replay safe rather than
 * reckless. It must be strict, and it must say exactly what is wrong.
 */

export class ValidationError extends Error {
  readonly file: EntityFile;
  readonly path: string;

  constructor(file: EntityFile, path: string, message: string) {
    super(`${file}.json — ${path}: ${message}`);
    this.name = "ValidationError";
    this.file = file;
    this.path = path;
  }
}

type Ctx = { file: EntityFile; path: string };

const fail = (c: Ctx, msg: string): never => {
  throw new ValidationError(c.file, c.path, msg);
};

const at = (c: Ctx, seg: string | number): Ctx => ({
  file: c.file,
  path: typeof seg === "number" ? `${c.path}[${seg}]` : `${c.path}.${seg}`,
});

function str(v: unknown, c: Ctx): string {
  if (typeof v !== "string") fail(c, `expected string, got ${typeof v}`);
  return v as string;
}

function nonEmpty(v: unknown, c: Ctx): string {
  const s = str(v, c);
  if (s.length === 0) fail(c, "must not be empty");
  return s;
}

function bool(v: unknown, c: Ctx): boolean {
  if (typeof v !== "boolean") fail(c, `expected boolean, got ${typeof v}`);
  return v as boolean;
}

function arr(v: unknown, c: Ctx): unknown[] {
  if (!Array.isArray(v)) fail(c, `expected array, got ${typeof v}`);
  return v as unknown[];
}

function obj(v: unknown, c: Ctx): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    fail(c, `expected object, got ${v === null ? "null" : typeof v}`);
  }
  return v as Record<string, unknown>;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], c: Ctx): T {
  const s = str(v, c);
  if (!allowed.includes(s as T)) {
    fail(c, `expected one of ${allowed.join(" | ")}, got "${s}"`);
  }
  return s as T;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_RE = /^\d{4}-W\d{2}$/;
const ID_RE = (p: string) => new RegExp(`^${p}_[0-9a-f]{8}$`);

function day(v: unknown, c: Ctx): string {
  const s = str(v, c);
  if (!DAY_RE.test(s)) fail(c, `expected YYYY-MM-DD, got "${s}"`);
  return s;
}

function instant(v: unknown, c: Ctx): string {
  const s = str(v, c);
  if (Number.isNaN(Date.parse(s))) fail(c, `expected an ISO 8601 instant, got "${s}"`);
  return s;
}

function id(v: unknown, prefix: string, c: Ctx): string {
  const s = str(v, c);
  // pj_inbox is a *reserved* id, not a derived one (AD-5).
  if (s === "pj_inbox" && prefix === "pj") return s;
  if (!ID_RE(prefix).test(s)) fail(c, `expected a ${prefix}_ id, got "${s}"`);
  return s;
}

function nullable<T>(v: unknown, c: Ctx, f: (v: unknown, c: Ctx) => T): T | null {
  return v === null || v === undefined ? null : f(v, c);
}

function subtask(v: unknown, c: Ctx): Subtask {
  const o = obj(v, c);
  return { text: str(o["text"], at(c, "text")), done: bool(o["done"], at(c, "done")) };
}

function logMessage(v: unknown, c: Ctx): LogMessage {
  const o = obj(v, c);
  return {
    eventDate: day(o["eventDate"], at(c, "eventDate")),
    message: str(o["message"], at(c, "message")),
  };
}

function stakeholderRef(v: unknown, c: Ctx): StakeholderRef {
  const o = obj(v, c);
  return {
    id: id(o["id"], "sh", at(c, "id")) as StakeholderRef["id"],
    direction: oneOf(o["direction"], ["up", "down"] as const, at(c, "direction")),
  };
}

function tags(v: unknown, c: Ctx): string[] {
  return arr(v, c).map((t, i) => nonEmpty(t, at(c, i)));
}

export function validateStakeholder(v: unknown, c: Ctx): Stakeholder {
  const o = obj(v, c);
  return {
    id: id(o["id"], "sh", at(c, "id")) as Stakeholder["id"],
    name: nonEmpty(o["name"], at(c, "name")),
  };
}

export function validateProject(v: unknown, c: Ctx): Project {
  const o = obj(v, c);
  return {
    id: id(o["id"], "pj", at(c, "id")) as Project["id"],
    title: nonEmpty(o["title"], at(c, "title")),
    description: str(o["description"] ?? "", at(c, "description")),
    deadline: nullable(o["deadline"], at(c, "deadline"), day),
    stakeholders: arr(o["stakeholders"] ?? [], at(c, "stakeholders")).map((s, i) =>
      stakeholderRef(s, at(at(c, "stakeholders"), i)),
    ),
    tags: tags(o["tags"] ?? [], at(c, "tags")),
    logMessages: arr(o["logMessages"] ?? [], at(c, "logMessages")).map((m, i) =>
      logMessage(m, at(at(c, "logMessages"), i)),
    ),
  };
}

export function validateTask(v: unknown, c: Ctx): Task {
  const o = obj(v, c);
  const committedRaw = o["committed"];
  let committed: Task["committed"] = null;
  if (committedRaw !== null && committedRaw !== undefined) {
    const co = obj(committedRaw, at(c, "committed"));
    const w = str(co["weekOf"], at(at(c, "committed"), "weekOf"));
    if (!WEEK_RE.test(w)) {
      fail(at(at(c, "committed"), "weekOf"), `expected YYYY-Www, got "${w}"`);
    }
    committed = { weekOf: w };
  }

  const deathRaw = o["death"];
  let death: Task["death"] = null;
  if (deathRaw !== null && deathRaw !== undefined) {
    const dc = at(c, "death");
    const d = obj(deathRaw, dc);
    death = {
      reason: oneOf(
        d["reason"],
        ["outdated", "delegated", "cancelled"] as const,
        at(dc, "reason"),
      ),
      at: instant(d["at"], at(dc, "at")),
    };
  }

  return {
    id: id(o["id"], "tk", at(c, "id")) as Task["id"],
    title: nonEmpty(o["title"], at(c, "title")),
    description: str(o["description"] ?? "", at(c, "description")),
    project: id(o["project"], "pj", at(c, "project")) as Task["project"],
    deadline: nullable(o["deadline"], at(c, "deadline"), day),
    status: oneOf(o["status"], ["todo", "doing", "done"] as const, at(c, "status")),
    subtasks: arr(o["subtasks"] ?? [], at(c, "subtasks")).map((s, i) =>
      subtask(s, at(at(c, "subtasks"), i)),
    ),
    logMessages: arr(o["logMessages"] ?? [], at(c, "logMessages")).map((m, i) =>
      logMessage(m, at(at(c, "logMessages"), i)),
    ),
    stakeholders: arr(o["stakeholders"] ?? [], at(c, "stakeholders")).map((s, i) =>
      stakeholderRef(s, at(at(c, "stakeholders"), i)),
    ),
    tags: tags(o["tags"] ?? [], at(c, "tags")),
    committed,
    todoSince: nullable(o["todoSince"], at(c, "todoSince"), day),
    doneAt: nullable(o["doneAt"], at(c, "doneAt"), instant),
    death,
  };
}

export function validateCapture(v: unknown, c: Ctx): Capture {
  const o = obj(v, c);
  return {
    id: id(o["id"], "cp", at(c, "id")) as Capture["id"],
    text: str(o["text"], at(c, "text")),
    capturedAt: instant(o["capturedAt"], at(c, "capturedAt")),
    state: oneOf(o["state"], ["unsorted", "resolved"] as const, at(c, "state")),
    resolvedTo: nullable(o["resolvedTo"], at(c, "resolvedTo"), (x, cc) =>
      id(x, "tk", cc),
    ) as Capture["resolvedTo"],
  };
}

export function validateFile(file: EntityFile, raw: unknown): unknown[] {
  const c: Ctx = { file, path: "root" };
  const rows = arr(raw, c);
  switch (file) {
    case "projects":
      return rows.map((r, i) => validateProject(r, at(c, i)));
    case "tasks":
      return rows.map((r, i) => validateTask(r, at(c, i)));
    case "captures":
      return rows.map((r, i) => validateCapture(r, at(c, i)));
    case "stakeholders":
      return rows.map((r, i) => validateStakeholder(r, at(c, i)));
  }
}

/**
 * Cross-file integrity. Runs only after all four files parse.
 *
 * AD-10 forbids a partial load precisely so this can exist: `Task.project`
 * cannot be validated against a Project set that never loaded.
 */
export function validateReferences(d: Dataset): void {
  const projectIds = new Set(d.projects.map((p) => p.id));
  const taskIds = new Set(d.tasks.map((t) => t.id));
  const stakeholderIds = new Set(d.stakeholders.map((s) => s.id));

  for (const t of d.tasks) {
    if (!projectIds.has(t.project)) {
      throw new ValidationError(
        "tasks",
        `task ${t.id}`,
        `references project ${t.project}, which does not exist in projects.json`,
      );
    }
    for (const s of t.stakeholders) {
      if (!stakeholderIds.has(s.id)) {
        throw new ValidationError(
          "tasks",
          `task ${t.id}`,
          `references stakeholder ${s.id}, which does not exist in stakeholders.json`,
        );
      }
    }
  }

  for (const p of d.projects) {
    for (const s of p.stakeholders) {
      if (!stakeholderIds.has(s.id)) {
        throw new ValidationError(
          "projects",
          `project ${p.id}`,
          `references stakeholder ${s.id}, which does not exist in stakeholders.json`,
        );
      }
    }
  }

  for (const c of d.captures) {
    if (c.resolvedTo !== null && !taskIds.has(c.resolvedTo)) {
      throw new ValidationError(
        "captures",
        `capture ${c.id}`,
        `references task ${c.resolvedTo}, which does not exist in tasks.json`,
      );
    }
  }
}
