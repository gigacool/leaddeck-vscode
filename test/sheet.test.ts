import assert from "node:assert/strict";
import { test } from "node:test";
import { projectSheet, taskSheet, type ChordMap } from "../src/derive/sheet.ts";
import { aProject, aStakeholder, aTask, dataset, daysAgo, daysAhead, NOW } from "./fixtures.ts";

/**
 * The sheet. These tests exist to pin FR-23–29 — the laws the code cannot state
 * about itself.
 *
 * The one they all serve: DEPTH ON DEMAND. A field is absent until asked for,
 * and what is absent goes on the rail instead. An empty field is a chore; a
 * rail is an offer. That is the whole reason a bare task reads as finished
 * rather than as an accusation of unfinished data entry.
 */

const WEEK = "2026-W29";

const CHORDS: ChordMap = {
  deadline: "Alt+D",
  subtasks: "Alt+S",
  log: "Alt+L",
  stakeholders: "Alt+P",
  tags: "Alt+T",
  commit: "Alt+W",
  die: "Alt+Backspace",
};

const sheetOf = (task: Parameters<typeof taskSheet>[0], data = dataset({ tasks: [task] })) =>
  taskSheet(task, data, NOW, WEEK, CHORDS);

/* ---- FR-24: a bare task is a finished task ---- */

test("FR-24 — a bare task has NO fields; every one of them is on the rail", () => {
  const s = sheetOf(aTask());

  // Not one empty field. `null` is the sheet saying "the rail still offers it".
  assert.equal(s.deadline, null);
  assert.equal(s.description, null);
  assert.equal(s.subtasks, null);
  assert.equal(s.log, null);
  assert.equal(s.stakeholders, null);
  assert.equal(s.tags, null);
  assert.equal(s.commit, null);

  // And each is offered, rather than simply gone.
  const offered = s.rail.map((r) => r.field);
  for (const f of ["deadline", "description", "subtasks", "log", "stakeholders", "tags", "commit"]) {
    assert.ok(offered.includes(f as never), `the rail does not offer ${f}`);
  }
});

test("FR-24 — a bare task reads QUIET, and says there is nothing to compute from", () => {
  const s = sheetOf(aTask());
  assert.equal(s.signal.kind, "quiet");
  assert.equal(s.signal.tone, "none");
  // The no-priority law, said out loud. A bare task must not read as an
  // omission he still owes the tool.
  assert.match(s.signalWhy, /nothing to compute urgency from/);
});

/* ---- FR-25: depth on demand ---- */

test("FR-25 — a field that is ON leaves the rail; the offer is spent", () => {
  const s = sheetOf(aTask({ deadline: daysAhead(3) }));
  assert.equal(s.deadline, daysAhead(3));
  assert.ok(!s.rail.some((r) => r.field === "deadline"));
});

test("FR-25 — `log` is the ONE field that stays on the rail once present", () => {
  // Every other field is a thing you have or don't. A log is a list you keep
  // adding to, so spending its offer would strand him after the first note.
  const s = sheetOf(aTask({ logMessages: [{ eventDate: NOW, message: "sarah pinged" }] }));
  assert.equal(s.log?.length, 1);
  assert.ok(s.rail.some((r) => r.field === "log"));
});

/*
 * THE INERT RAIL — found in the first real run, invisible to every test.
 *
 * `＋ tag` / `＋ stakeholder` / `＋ log note` write NOTHING when clicked: an
 * empty tag is not a tag, and a nameless stakeholder is not a person. So
 * presence-from-stored-data alone left them absent, the repaint was identical,
 * and three of the seven rail buttons did nothing at all.
 *
 * `asked` carries the intent. It is the same question ("is this field on?"),
 * answered by data where data can answer it and by intent where it cannot.
 */
test("＋ tag OPENS the tag row — the rail button is not inert", () => {
  const bare = sheetOf(aTask());
  assert.equal(bare.tags, null); // not asked, not present

  const asked = taskSheet(aTask(), dataset(), NOW, WEEK, CHORDS, ["tags"]);
  assert.deepEqual(asked.tags, []); // asked: an EMPTY row, ready to type into
  assert.ok(!asked.rail.some((r) => r.field === "tags")); // the offer is spent
});

test("＋ stakeholder opens an empty row without inventing a person", () => {
  const asked = taskSheet(aTask(), dataset(), NOW, WEEK, CHORDS, ["stakeholders"]);
  assert.deepEqual(asked.stakeholders, []);
  // Crucially: asking did NOT create a stakeholder. AD-5 — no id from a name.
  assert.equal(asked.signal.kind, "quiet");
});

test("＋ log note opens the add-line, and log STAYS on the rail", () => {
  const asked = taskSheet(aTask(), dataset(), NOW, WEEK, CHORDS, ["log"]);
  assert.deepEqual(asked.log, []);
  assert.ok(asked.rail.some((r) => r.field === "log"));
});

test("asked is intent, not data: a project's rail opens the same way", () => {
  const p = aProject();
  const s = projectSheet(p, dataset({ projects: [p] }), NOW, CHORDS, ["tags"]);
  assert.deepEqual(s.tags, []);
});

test("FR-25 — the rail carries a platform-resolved chord, never a Mac glyph on Windows", () => {
  // `derive/` cannot reach `vscode` to know the platform, so the chord is passed
  // in. Printing ⌘W on Windows would be a lie — and ⌘W is *close the window*.
  const s = sheetOf(aTask());
  assert.equal(s.rail.find((r) => r.field === "deadline")?.chord, "Alt+D");
  for (const r of s.rail) assert.ok(r.chord.length > 0, `${r.field} has no chord`);
});

test("FR-25 — the rail's ORDER is deliberate: deadline first", () => {
  const s = sheetOf(aTask());
  assert.equal(s.rail[0]?.field, "deadline");
});

/* ---- FR-28: computed signals are read-only ---- */

test("FR-28 — an overdue task states its signal AND that no field sets it", () => {
  const s = sheetOf(aTask({ deadline: daysAgo(4) }));
  assert.equal(s.signal.kind, "overdue");
  assert.equal(s.signal.tone, "danger");
  assert.match(s.signal.text, /4d over/);
  // The sentence that stops him hunting for the priority dropdown.
  assert.match(s.signalWhy, /no field here that sets that/);
});

test("FR-28 — the signal's TEXT is decided here; the webview renders, never computes", () => {
  // A deadline today reads "today", not "0d" — and that decision lives in this
  // layer, not in a template.
  assert.match(sheetOf(aTask({ deadline: NOW })).signal.text, /today/);
});

/* ---- FR-27: stakeholders carry a direction ---- */

test("FR-27 — a stakeholder renders with its name resolved, never its id", () => {
  // AD-5: the id is opaque and is NEVER the name. v1's bug was exactly this —
  // `stakeholderIdFromMention()` made the id BE the name, so a rename was
  // impossible. The sheet must resolve, not print.
  const sh = aStakeholder({ name: "Sarah" });
  const t = aTask({ stakeholders: [{ id: sh.id, direction: "up" }] });
  const s = taskSheet(t, dataset({ tasks: [t], stakeholders: [sh] }), NOW, WEEK, CHORDS);

  assert.equal(s.stakeholders?.[0]?.name, "Sarah");
  assert.equal(s.stakeholders?.[0]?.direction, "up");
  assert.notEqual(s.stakeholders?.[0]?.id, "Sarah");
});

test("FR-27 — ↑ waiting is a WARN; it pushes toward NOW without being a deadline", () => {
  const sh = aStakeholder({ name: "Sarah" });
  const t = aTask({ stakeholders: [{ id: sh.id, direction: "up" }] });
  const s = taskSheet(t, dataset({ tasks: [t], stakeholders: [sh] }), NOW, WEEK, CHORDS);
  assert.equal(s.signal.kind, "waiting");
  assert.equal(s.signal.tone, "warn");
  assert.match(s.signalWhy, /waiting on you/);
});

test("FR-27 — ↓ blocked tells him WHO to chase, not what to edit", () => {
  const sh = aStakeholder({ name: "Tom" });
  const t = aTask({ stakeholders: [{ id: sh.id, direction: "down" }] });
  const s = taskSheet(t, dataset({ tasks: [t], stakeholders: [sh] }), NOW, WEEK, CHORDS);
  assert.equal(s.signal.kind, "blocked");
  assert.match(s.signalWhy, /Chase them; there is no field to change here/);
});

/* ---- the commitment: the only judgment he authors ---- */

test("the sheet marks whether the commitment is THIS week", () => {
  assert.equal(sheetOf(aTask({ committed: { weekOf: WEEK } })).commit?.isThisWeek, true);
  assert.equal(sheetOf(aTask({ committed: { weekOf: "2026-W30" } })).commit?.isThisWeek, false);
});

/* ---- FR-29: death ---- */

test("FR-29 — death carries an AUTHORED reason; nothing computes why", () => {
  const s = sheetOf(aTask({ death: { reason: "delegated", at: "2026-07-14T09:00:00.000Z" } }));
  assert.equal(s.death?.reason, "delegated");
});

test("FR-29 — a project cannot carry a task's shape: no status, no subtasks, no commit", () => {
  const p = aProject();
  const s = projectSheet(p, dataset({ projects: [p] }), NOW, CHORDS);

  // A project isn't a task. `Project.status` is dead — "in-progress" was true of
  // 15 of 17 projects, the same failure that killed priority.
  assert.equal(s.status, null);
  assert.equal(s.subtasks, null);
  assert.equal(s.commit, null);

  // And the rail must not offer what a project cannot have.
  const offered = s.rail.map((r) => r.field);
  for (const f of ["subtasks", "commit", "log"]) {
    assert.ok(!offered.includes(f as never), `the project rail wrongly offers ${f}`);
  }
});

/* ---- the project sheet ---- */

test("a project INHERITS its urgency from its tasks; nothing types it in", () => {
  const p = aProject();
  const data = dataset({
    projects: [p],
    tasks: [aTask({ project: p.id }), aTask({ project: p.id, deadline: daysAgo(2) })],
  });
  const s = projectSheet(p, data, NOW, CHORDS);

  assert.equal(s.signal.kind, "overdue"); // the most urgent of its tasks wins
  assert.match(s.signalWhy, /Inherited from its tasks/);
});

test("a project's crumb counts its LIVING tasks — dead work is gone, not hidden", () => {
  const p = aProject();
  const data = dataset({
    projects: [p],
    tasks: [
      aTask({ project: p.id }),
      aTask({ project: p.id, death: { reason: "cancelled", at: "2026-07-10T09:00:00.000Z" } }),
    ],
  });
  assert.equal(projectSheet(p, data, NOW, CHORDS).crumb, "1 task");
});

test("an empty project says so, rather than reading as urgent", () => {
  const p = aProject();
  const s = projectSheet(p, dataset({ projects: [p] }), NOW, CHORDS);
  assert.equal(s.signal.kind, "quiet");
  assert.match(s.signalWhy, /no tasks yet/);
});

test("a task's crumb is its project's title — the sheet says where it lives", () => {
  const p = aProject({ title: "Helvetia bid" });
  const t = aTask({ project: p.id });
  assert.equal(taskSheet(t, dataset({ projects: [p], tasks: [t] }), NOW, WEEK, CHORDS).crumb, "Helvetia bid");
});
