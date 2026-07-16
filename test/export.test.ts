import assert from "node:assert/strict";
import { test } from "node:test";
import { exportBundle } from "../src/derive/export.ts";
import type { Week } from "../src/model/types.ts";
import { aCapture, aProject, aStakeholder, aTask, dataset } from "./fixtures.ts";

const WEEK = "2026-W29" as Week;

test("FR-22 — the bundle carries the four entities verbatim, and the week", () => {
  const task = aTask();
  const project = aProject();
  const capture = aCapture();
  const who = aStakeholder();
  const data = dataset({
    projects: [project],
    tasks: [task],
    captures: [capture],
    stakeholders: [who],
  });

  const b = exportBundle(data, WEEK);

  assert.equal(b.exportedFor, WEEK);
  // Verbatim — the same rows, not a reshaped copy.
  assert.deepEqual(b.tasks, [task]);
  assert.deepEqual(b.projects, [project]);
  assert.deepEqual(b.captures, [capture]);
  assert.deepEqual(b.stakeholders, [who]);
});

/*
 * The FR-22 law in executable form: the app owes DATA, not opinions. The export
 * is the raw entities and a week stamp — nothing derived. If someone adds a
 * signal, a band, a burndown number, or any "helpful" summary, the export has
 * started becoming v1's analytics panel, and this key count breaks first.
 */
test("FR-22 — the bundle has EXACTLY five keys: the four files plus the stamp", () => {
  const b = exportBundle(dataset(), WEEK);
  assert.deepEqual(Object.keys(b).sort(), [
    "captures",
    "exportedFor",
    "projects",
    "stakeholders",
    "tasks",
  ]);
});

test("FR-22 — an empty deck still exports (the Inbox is a real row)", () => {
  const b = exportBundle(dataset(), WEEK);
  assert.equal(b.tasks.length, 0);
  assert.equal(b.captures.length, 0);
  // The Inbox project is always present — export never omits it as a special case.
  assert.equal(b.projects.length, 1);
});
