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

/* ---- SHOW ALL: depth-on-demand retired (Cédric's call, 2026-07-17) ---- */

test("SHOW-ALL — a task sheet shows EVERY field, and the rail is empty", () => {
  // The reversal of depth-on-demand: hunting for attributes behind the rail,
  // and a layout that differed task to task, was more chore than offer. Now the
  // sheet is identical every time — every field present, empty ones included.
  const s = sheetOf(aTask());
  for (const f of ["deadline", "description", "subtasks", "log", "stakeholders", "tags", "commit"]) {
    assert.ok(s.fields.includes(f as never), `the sheet does not show ${f}`);
  }
  assert.deepEqual(s.rail, []); // nothing left to offer — it is all shown
});

test("SHOW-ALL — a project shows its four fields, and no task-only ones", () => {
  const p = aProject();
  const s = projectSheet(p, dataset({ projects: [p] }), NOW, CHORDS);
  assert.deepEqual(s.fields.sort(), ["deadline", "description", "stakeholders", "tags"]);
  // A project is not a task: never a status, subtasks, log, or commitment.
  for (const f of ["subtasks", "log", "commit"]) assert.ok(!s.fields.includes(f as never));
  assert.deepEqual(s.rail, []);
});

test("SHOW-ALL — an empty field shows but stays empty in the values", () => {
  // Shown does not mean invented: a bare task's fields are all present in
  // `fields`, but their VALUES are the empty/null state, not fabricated data.
  const s = sheetOf(aTask());
  assert.equal(s.deadline, null); // shown as an empty date, not a made-up one
  assert.deepEqual(s.tags, []); // shown as an empty tag row, no tags invented
  assert.equal(s.commit, null); // shown as "commit to this week?", not committed
});

test("SHOW-ALL — a filled field carries its value, same as before", () => {
  const s = sheetOf(aTask({ deadline: daysAhead(3), tags: ["ops"] }));
  assert.equal(s.deadline, daysAhead(3));
  assert.deepEqual(s.tags, ["ops"]);
});

test("FR-24 — a bare task reads QUIET, and says there is nothing to compute from", () => {
  const s = sheetOf(aTask());
  assert.equal(s.signal.kind, "quiet");
  assert.equal(s.signal.tone, "none");
  // The no-priority law, said out loud. A bare task must not read as an
  // omission he still owes the tool.
  assert.match(s.signalWhy, /nothing to compute urgency from/);
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
