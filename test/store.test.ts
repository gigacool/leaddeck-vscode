import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { newCaptureId, newTaskId } from "../src/model/ids.ts";
import { INBOX_PROJECT_ID, type Capture, type Task } from "../src/model/types.ts";
import { Store } from "../src/store/store.ts";
import { ValidationError } from "../src/store/validate.ts";

async function tmpRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "leaddeck-test-"));
}

const readJson = async (root: string, file: string): Promise<unknown> =>
  JSON.parse(await readFile(join(root, `${file}.json`), "utf8"));

function aTask(over: Partial<Task> = {}): Task {
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
    todoSince: "2026-07-15",
    doneAt: null,
    death: null,
    ...over,
  };
}

function aCapture(over: Partial<Capture> = {}): Capture {
  return {
    id: newCaptureId(),
    text: "sarah asked about api docs status",
    capturedAt: "2026-07-15T09:14:00.000Z",
    state: "unsorted",
    resolvedTo: null,
    ...over,
  };
}

test("AD-6 — a root that does not exist starts empty; that is not a halt", async (t) => {
  const root = await tmpRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = await Store.open({ root });

  assert.deepEqual(await readJson(root, "tasks"), []);
  assert.deepEqual(await readJson(root, "captures"), []);
  // The Inbox is a real row with a reserved id, not a special case in code.
  assert.equal(store.data.projects.length, 1);
  assert.equal(store.data.projects[0]!.id, INBOX_PROJECT_ID);
});

test("AD-10 — malformed JSON halts and names the file; it is NEVER repaired", async (t) => {
  const root = await tmpRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, "tasks.json"), "{ not json", "utf8");
  await assert.rejects(Store.open({ root }), /tasks\.json is not valid JSON/);

  // Untouched. With no event log the JSON is the only copy — the app has no
  // repair path (AD-2 removed it) and must not invent one.
  assert.equal(await readFile(join(root, "tasks.json"), "utf8"), "{ not json");
});

test("AD-10 — a bad field halts with the exact path", async (t) => {
  const root = await tmpRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(
    join(root, "tasks.json"),
    JSON.stringify([{ ...aTask(), status: "blocked" }]),
    "utf8",
  );
  // `blocked` is derived, never stored — the Kanban column is computed.
  await assert.rejects(Store.open({ root }), (e: Error) => {
    assert.ok(e instanceof ValidationError);
    assert.match(e.message, /status/);
    assert.match(e.message, /todo \| doing \| done/);
    return true;
  });
});

test("AD-10 — partial load is forbidden: a dangling project ref halts", async (t) => {
  const root = await tmpRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, "projects.json"), JSON.stringify([]), "utf8");
  await writeFile(
    join(root, "tasks.json"),
    JSON.stringify([aTask({ project: "pj_deadbeef" as Task["project"] })]),
    "utf8",
  );
  await writeFile(join(root, "captures.json"), "[]", "utf8");
  await writeFile(join(root, "stakeholders.json"), "[]", "utf8");

  await assert.rejects(Store.open({ root }), /does not exist in projects\.json/);
});

test("AD-13 — creators are written before consumers", async (t) => {
  const root = await tmpRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = await Store.open({ root });
  const order: string[] = [];
  const spy = await Store.open({
    root,
    write: async (r, file, rows) => {
      order.push(file);
      const { writeEntityFile } = await import("../src/store/files.ts");
      return writeEntityFile(r, file, rows);
    },
  });
  void store;

  const task = aTask();
  await spy.mutate((d) => {
    d.tasks.push(task);
    d.captures.push(aCapture({ state: "resolved", resolvedTo: task.id }));
    // Deliberately name them consumer-first — the store must reorder.
    return { touched: ["captures", "tasks"] };
  });

  assert.deepEqual(order, ["tasks", "captures"]);
});

/*
 * FR-8's note destination has the same AD-13 shape as resolve-to-task, and it
 * gets it for free: `captures` is last in WRITE_ORDER, so the note is written
 * into tasks.json BEFORE the capture is marked resolved.
 *
 * A crash between the two leaves the note written and the capture still
 * unsorted — he re-resolves and gets a duplicate note, which is visible and
 * fixable. The other order loses the text entirely, silently.
 */
test("AD-13 — a capture resolved to a NOTE writes the note before consuming it", async (t) => {
  const root = await tmpRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const order: string[] = [];
  const store = await Store.open({
    root,
    write: async (r, file, rows) => {
      order.push(file);
      const { writeEntityFile } = await import("../src/store/files.ts");
      return writeEntityFile(r, file, rows);
    },
  });

  const task = aTask();
  const capture = aCapture();
  await store.mutate((d) => {
    d.tasks.push(task);
    d.captures.push(capture);
    return { touched: ["tasks", "captures"] };
  });
  order.length = 0;

  await store.mutate((d) => {
    const c = d.captures.find((x) => x.id === capture.id)!;
    const t2 = d.tasks.find((x) => x.id === task.id)!;
    t2.logMessages.unshift({ eventDate: "2026-07-16", message: c.text });
    c.state = "resolved";
    return { touched: ["captures", "tasks"] }; // named consumer-first on purpose
  });

  assert.deepEqual(order, ["tasks", "captures"]);
  const tasks = (await readJson(root, "tasks")) as Task[];
  assert.equal(tasks[0]!.logMessages[0]!.message, capture.text);
});

test("AD-13 — a crash between the two writes leaves an ORPHAN, never a void", async (t) => {
  const root = await tmpRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = await Store.open({ root });
  const task = aTask({ title: "Draft the COMEX deck" });
  const capture = aCapture({ text: "comex deck - need Q3 numbers" });

  // Resolve the capture into a task, then crash after tasks.json lands but
  // before captures.json does. This is the exact window AD-13 exists for.
  await store.mutate((d) => {
    d.captures.push(capture);
    return { touched: ["captures"] };
  });

  const crashing = await Store.open({
    root,
    write: async (r, file, rows) => {
      if (file === "captures") throw new Error("power cut");
      const { writeEntityFile } = await import("../src/store/files.ts");
      return writeEntityFile(r, file, rows);
    },
  });

  await assert.rejects(
    crashing.mutate((d) => {
      d.tasks.push(task);
      const c = d.captures.find((x) => x.id === capture.id)!;
      c.state = "resolved";
      c.resolvedTo = task.id;
      return { touched: ["tasks", "captures"] };
    }),
    /power cut/,
  );

  // On disk: the task exists, the capture still says unsorted. An orphan.
  const captures = (await readJson(root, "captures")) as Capture[];
  assert.equal(captures[0]!.state, "unsorted");
  const tasks = (await readJson(root, "tasks")) as Task[];
  assert.equal(tasks.length, 1);

  // The orphan self-heals on the next load, keyed on resolvedTo.
  // Had the order been reversed, the capture would be GONE and the task
  // never written: silent data loss.
  const recovered = await Store.open({ root });
  assert.equal(recovered.data.captures[0]!.state, "unsorted");
  assert.equal(recovered.data.tasks.length, 1);
});

test("AD-13 — self-heal marks a capture whose resolvedTo task landed", async (t) => {
  const root = await tmpRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const task = aTask();
  await writeFile(
    join(root, "projects.json"),
    JSON.stringify([
      {
        id: INBOX_PROJECT_ID,
        title: "Inbox",
        description: "",
        deadline: null,
        stakeholders: [],
        tags: [],
        logMessages: [],
      },
    ]),
    "utf8",
  );
  await writeFile(join(root, "tasks.json"), JSON.stringify([task]), "utf8");
  // The crash window: resolvedTo is set, but state never made it to disk.
  await writeFile(
    join(root, "captures.json"),
    JSON.stringify([aCapture({ state: "unsorted", resolvedTo: task.id })]),
    "utf8",
  );
  await writeFile(join(root, "stakeholders.json"), "[]", "utf8");

  const store = await Store.open({ root });
  assert.equal(store.data.captures[0]!.state, "resolved");

  // And the heal is persisted, not just in memory.
  const onDisk = (await readJson(root, "captures")) as Capture[];
  assert.equal(onDisk[0]!.state, "resolved");
});

test("AD-8 — a self-write is suppressed; a foreign write is not", async (t) => {
  const root = await tmpRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = await Store.open({ root });
  let lastMtime = 0;
  const spy = await Store.open({
    root,
    write: async (r, file, rows) => {
      const { writeEntityFile } = await import("../src/store/files.ts");
      lastMtime = await writeEntityFile(r, file, rows);
      return lastMtime;
    },
  });
  void store;

  await spy.mutate((d) => {
    d.tasks.push(aTask());
    return { touched: ["tasks"] };
  });

  assert.equal(spy.isSelfWrite("tasks", lastMtime), true);
  // Consumed — a second event for the same write is foreign.
  assert.equal(spy.isSelfWrite("tasks", lastMtime), false);
  // A file we never wrote is always foreign.
  assert.equal(spy.isSelfWrite("projects", lastMtime), false);
});

test("AD-8 — a foreign write reloads the file WHOLE, never merged", async (t) => {
  const root = await tmpRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const windowA = await Store.open({ root });
  const windowB = await Store.open({ root });

  await windowA.mutate((d) => {
    d.tasks.push(aTask({ title: "From window A" }));
    return { touched: ["tasks"] };
  });

  assert.equal(windowB.data.tasks.length, 0);
  await windowB.reloadFile("tasks");
  assert.equal(windowB.data.tasks.length, 1);
  assert.equal(windowB.data.tasks[0]!.title, "From window A");
});

test("mutations serialize; the chain survives a failure", async (t) => {
  const root = await tmpRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = await Store.open({ root });
  await assert.rejects(
    store.mutate(() => {
      throw new Error("boom");
    }),
    /boom/,
  );

  // The next mutation still runs — a failed write must not wedge the store.
  await store.mutate((d) => {
    d.tasks.push(aTask({ title: "still works" }));
    return { touched: ["tasks"] };
  });
  assert.equal(store.data.tasks.length, 1);
});

test("AD-2 — no index, no cache, no log: only the four entity files exist", async (t) => {
  const root = await tmpRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const store = await Store.open({ root });
  await store.mutate((d) => {
    d.tasks.push(aTask());
    return { touched: ["tasks"] };
  });

  const { readdir } = await import("node:fs/promises");
  const entries = (await readdir(root)).sort();
  assert.deepEqual(entries, [
    ".gitignore",
    "captures.json",
    "projects.json",
    "stakeholders.json",
    "tasks.json",
  ]);
});
