import assert from "node:assert/strict";
import { test } from "node:test";
import { burndown } from "../src/derive/burndown.ts";
import type { Week } from "../src/model/types.ts";
import { aTask, dataset } from "./fixtures.ts";

// 2026-W29 is Mon 2026-07-13 .. Sun 2026-07-19.
const WEEK = "2026-W29" as Week;
const committed = { weekOf: WEEK };

test("FR-21 — the remaining line has one point per day, Monday first", () => {
  const b = burndown(dataset(), WEEK);
  assert.equal(b.remaining.length, 7);
  assert.equal(b.remaining[0]!.day, "2026-07-13"); // Monday
  assert.equal(b.remaining[6]!.day, "2026-07-19"); // Sunday
});

test("FR-21 — an open committed task stays counted all week", () => {
  const data = dataset({ tasks: [aTask({ committed, doneAt: null })] });
  const b = burndown(data, WEEK);
  assert.deepEqual(b.remaining.map((p) => p.count), [1, 1, 1, 1, 1, 1, 1]);
});

test("FR-21 — a task burns down the day it is done, not before", () => {
  // Done Wednesday 2026-07-15 midday.
  const data = dataset({
    tasks: [aTask({ committed, status: "done", doneAt: "2026-07-15T12:00:00.000Z" })],
  });
  const b = burndown(data, WEEK);
  // Open Mon/Tue, gone from Wed onward.
  assert.deepEqual(b.remaining.map((p) => p.count), [1, 1, 0, 0, 0, 0, 0]);
});

test("FR-21 — a task done at the LAST instant of its day is closed by end of day", () => {
  // Exactly 23:59:59.999 local on Tuesday — the boundary. Constructed the same
  // way the code builds end-of-day, so the test is timezone-agnostic (a raw ISO
  // instant would move relative to the boundary as the machine's offset changed)
  // AND it pins the `>` comparison: with `>=` this instant would read as open.
  const lastInstant = new Date(2026, 6, 14);
  lastInstant.setHours(23, 59, 59, 999);
  const data = dataset({
    tasks: [aTask({ committed, status: "done", doneAt: lastInstant.toISOString() })],
  });
  const b = burndown(data, WEEK);
  assert.equal(b.remaining[1]!.count, 0); // Tuesday: burned down, done that day
  assert.equal(b.remaining[0]!.count, 1); // Monday: still open
});

test("FR-21 — a DEAD task is not on the chart: death is not a burndown", () => {
  const data = dataset({
    tasks: [aTask({ committed, death: { reason: "cancelled", at: "2026-07-14T09:00:00.000Z" } })],
  });
  const b = burndown(data, WEEK);
  assert.ok(b.empty);
  assert.deepEqual(b.remaining.map((p) => p.count), [0, 0, 0, 0, 0, 0, 0]);
});

test("FR-21 — a task committed to ANOTHER week is not counted", () => {
  const data = dataset({ tasks: [aTask({ committed: { weekOf: "2026-W30" as Week } })] });
  const b = burndown(data, WEEK);
  assert.ok(b.empty);
});

/*
 * The FR-21 honesty law, executable. The ideal is FLAT at the starting count —
 * never a slope, because there are no estimates and a slope would be invented.
 * And it carries the fiction caption. If someone "improves" the chart into a
 * descending target, both assertions break.
 */
test("FR-21 — the ideal is FLAT at the start count, and labelled fiction", () => {
  const data = dataset({
    tasks: [aTask({ committed }), aTask({ committed }), aTask({ committed })],
  });
  const b = burndown(data, WEEK);
  assert.equal(b.ideal, 3); // the whole committed set, unburned — flat, not sloped
  assert.match(b.idealLabel, /fiction/);
  assert.match(b.idealLabel, /no estimates/);
});

test("FR-21 — nothing committed reads empty, never a chart of zeros pretending", () => {
  const b = burndown(dataset(), WEEK);
  assert.ok(b.empty);
  assert.equal(b.ideal, 0);
});
