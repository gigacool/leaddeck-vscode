import {
  ENTITY_FILES,
  INBOX_PROJECT_ID,
  type Capture,
  type Dataset,
  type EntityFile,
  type Project,
  type Stakeholder,
  type Task,
} from "../model/types.ts";
import { ensureDir, ensureGitignore, readEntityFile, writeEntityFile } from "./files.ts";
import { validateFile, validateReferences } from "./validate.ts";

/**
 * The in-memory document store.
 *
 * The whole dataset fits in memory — 17 projects, ~63 tasks. That single fact
 * is what lets this exist without an index, a cache, a query engine or a replay.
 *
 * Contrast v1, which replayed its entire event log AND stat'd every task file
 * after every single mutation.
 */

/**
 * AD-13 — write order is a RULE, not a preference.
 *
 * AD-1 puts entities in separate files, AD-10 makes writes atomic *per file*,
 * and AD-2 forbids the journal a two-phase commit would need. So a mutation
 * spanning files cannot be atomic — and one order silently destroys data.
 *
 * Write the file that CREATES before the file that CONSUMES: a crash then
 * leaves an orphan (a resolved capture still marked unsorted), never a void
 * (a consumed capture whose task was never written). The orphan self-heals on
 * load, keyed on `Capture.resolvedTo`.
 */
const WRITE_ORDER: readonly EntityFile[] = [
  "stakeholders",
  "projects",
  "tasks",
  "captures",
];

export interface StoreDeps {
  root: string;
  /** Injected so the write path is testable without a real disk. */
  read?: typeof readEntityFile;
  write?: typeof writeEntityFile;
}

interface Pending {
  gen: number;
  mtimeMs: number;
}

export class Store {
  #data: Dataset = { projects: [], tasks: [], captures: [], stakeholders: [] };
  #gen = 0;
  /** AD-8: echo suppression by write-generation, not by path alone or content hash. */
  #pending = new Map<EntityFile, Pending[]>();
  #chain: Promise<unknown> = Promise.resolve();
  #read: typeof readEntityFile;
  #write: typeof writeEntityFile;

  readonly root: string;

  private constructor(deps: StoreDeps) {
    this.root = deps.root;
    this.#read = deps.read ?? readEntityFile;
    this.#write = deps.write ?? writeEntityFile;
  }

  static async open(deps: StoreDeps): Promise<Store> {
    const store = new Store(deps);
    await store.load();
    return store;
  }

  get data(): Readonly<Dataset> {
    return this.#data;
  }

  /**
   * AD-10: a bad file halts activation entirely — partial load is forbidden.
   * Three quarters of a dataset is the wrong-dataset symptom AD-6 exists to kill.
   */
  async load(): Promise<void> {
    await ensureDir(this.root);

    const next: Dataset = { projects: [], tasks: [], captures: [], stakeholders: [] };
    let anyMissing = false;

    for (const file of ENTITY_FILES) {
      const hit = await this.#read(this.root, file);
      if (hit === null) {
        anyMissing = true;
        continue;
      }
      // Throws ValidationError, which the surface turns into a halt.
      const rows = validateFile(file, hit.raw);
      switch (file) {
        case "projects":
          next.projects = rows as Project[];
          break;
        case "tasks":
          next.tasks = rows as Task[];
          break;
        case "captures":
          next.captures = rows as Capture[];
          break;
        case "stakeholders":
          next.stakeholders = rows as Stakeholder[];
          break;
      }
    }

    validateReferences(next);
    this.#data = next;

    const healed = this.#healOrphans();

    // AD-6: a live root that does not exist is created with its files at [].
    // This is the only sanctioned empty start, and is NOT an AD-10 halt.
    if (anyMissing || !this.#hasInbox()) {
      this.#ensureInbox();
      await this.#writeFiles([...ENTITY_FILES]);
      await ensureGitignore(this.root);
    } else if (healed.length > 0) {
      await this.#writeFiles(healed);
    }
  }

  #hasInbox(): boolean {
    return this.#data.projects.some((p) => p.id === INBOX_PROJECT_ID);
  }

  /** The Inbox is a real row with a reserved id — not a special case in code (AD-1). */
  #ensureInbox(): void {
    if (this.#hasInbox()) return;
    this.#data.projects.unshift({
      id: INBOX_PROJECT_ID,
      title: "Inbox",
      description: "",
      deadline: null,
      stakeholders: [],
      tags: [],
      logMessages: [],
      archived: null,
    });
  }

  /**
   * AD-13's self-heal. A capture whose `resolvedTo` task exists was consumed —
   * the crash landed between the two writes. Mark it and move on.
   */
  #healOrphans(): EntityFile[] {
    const taskIds = new Set(this.#data.tasks.map((t) => t.id));
    let healed = false;
    for (const c of this.#data.captures) {
      if (c.state === "unsorted" && c.resolvedTo !== null && taskIds.has(c.resolvedTo)) {
        c.state = "resolved";
        healed = true;
      }
    }
    return healed ? ["captures"] : [];
  }

  /**
   * The one mutation path. Serialized: one human, one window, no interleaving.
   *
   * `touched` names the files the mutation changed; they are written in
   * WRITE_ORDER, creators first.
   */
  mutate<T>(fn: (data: Dataset) => { touched: EntityFile[]; result?: T }): Promise<T> {
    const run = async (): Promise<T> => {
      const { touched, result } = fn(this.#data);
      await this.#writeFiles(touched);
      return result as T;
    };
    const next = this.#chain.then(run, run);
    // Keep the chain alive on failure; the error still surfaces to the caller.
    this.#chain = next.catch(() => undefined);
    return next;
  }

  async #writeFiles(touched: EntityFile[]): Promise<void> {
    const ordered = WRITE_ORDER.filter((f) => touched.includes(f));
    for (const file of ordered) {
      const gen = ++this.#gen;
      const rows = this.#rowsFor(file);
      const mtimeMs = await this.#write(this.root, file, rows);
      const list = this.#pending.get(file) ?? [];
      list.push({ gen, mtimeMs });
      this.#pending.set(file, list);
    }
  }

  #rowsFor(file: EntityFile): unknown[] {
    switch (file) {
      case "projects":
        return this.#data.projects;
      case "tasks":
        return this.#data.tasks;
      case "captures":
        return this.#data.captures;
      case "stakeholders":
        return this.#data.stakeholders;
    }
  }

  /**
   * AD-8 — is this watcher event our own echo?
   *
   * Cleared only when an event arrives with `mtime >= ` the write's completion
   * mtime. An event with no pending entry is FOREIGN: reload that file whole,
   * replace it in memory entirely, re-render. Never merge.
   */
  isSelfWrite(file: EntityFile, mtimeMs: number): boolean {
    const list = this.#pending.get(file);
    if (!list || list.length === 0) return false;
    const i = list.findIndex((p) => mtimeMs >= p.mtimeMs);
    if (i === -1) return false;
    list.splice(0, i + 1);
    return true;
  }

  /** A foreign write replaces the file wholly. Memory is never ahead of disk. */
  async reloadFile(file: EntityFile): Promise<void> {
    const hit = await this.#read(this.root, file);
    if (hit === null) return;
    const rows = validateFile(file, hit.raw);
    switch (file) {
      case "projects":
        this.#data.projects = rows as Project[];
        break;
      case "tasks":
        this.#data.tasks = rows as Task[];
        break;
      case "captures":
        this.#data.captures = rows as Capture[];
        break;
      case "stakeholders":
        this.#data.stakeholders = rows as Stakeholder[];
        break;
    }
    validateReferences(this.#data);
  }
}
