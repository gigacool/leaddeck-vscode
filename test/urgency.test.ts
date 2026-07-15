import assert from "node:assert/strict";
import { test } from "node:test";
import { idleDays, isBlocked, urgencyOf } from "../src/derive/urgency.ts";
import { aProject, aStakeholder, aTask, dataset, daysAgo, daysAhead, NOW } from "./fixtures.ts";

test("a bare task reads QUIET — nothing to compute from, so there is none", () => {
  // This is why a bare task looks finished rather than accusing him.
  const task = aTask({ todoSince: null });
  const d = dataset({ tasks: [task] });
  assert.equal(urgencyOf(task, d, NOW).kind, "quiet");
});

test("a deadline inside 5 days is DUE; beyond it is not", () => {
  const due = aTask({ deadline: daysAhead(3) });
  const notYet = aTask({ deadline: daysAhead(9) });
  const d = dataset({ tasks: [due, notYet] });

  const s = urgencyOf(due, d, NOW);
  assert.equal(s.kind, "due");
  assert.equal(s.kind === "due" && s.days, 3);
  assert.equal(urgencyOf(notYet, d, NOW).kind, "quiet");
});

test("a past deadline is OVERDUE, and reports days elapsed as a positive number", () => {
  const task = aTask({ deadline: daysAgo(4) });
  const d = dataset({ tasks: [task] });
  const s = urgencyOf(task, d, NOW);
  assert.equal(s.kind, "overdue");
  assert.equal(s.kind === "overdue" && s.days, 4);
});

test("BLOCKED is DERIVED from a ↓ stakeholder — there is no blocked status", () => {
  // The Kanban's fourth column and the `block` pip both read this. The column
  // exists; the field does not. Same law that killed priority.
  const sarah = aStakeholder({ name: "Sarah" });
  const task = aTask({ stakeholders: [{ id: sarah.id, direction: "down" }] });
  const d = dataset({ tasks: [task], stakeholders: [sarah] });

  assert.equal(isBlocked(task, d), true);
  assert.equal(urgencyOf(task, d, NOW).kind, "blocked");
});

test("a ↑ stakeholder means I owe a status — WAITING, not blocked", () => {
  // Direction is half of urgency: ↑ pushes toward NOW, ↓ tells him who to chase.
  const boss = aStakeholder({ name: "Marc" });
  const task = aTask({ stakeholders: [{ id: boss.id, direction: "up" }] });
  const d = dataset({ tasks: [task], stakeholders: [boss] });

  assert.equal(isBlocked(task, d), false);
  const s = urgencyOf(task, d, NOW);
  assert.equal(s.kind, "waiting");
  assert.equal(s.kind === "waiting" && s.who, "Marc");
});

test("a task in flight is not blocked — he is the one moving it", () => {
  const sarah = aStakeholder();
  const task = aTask({
    status: "doing",
    stakeholders: [{ id: sarah.id, direction: "down" }],
  });
  const d = dataset({ tasks: [task], stakeholders: [sarah] });
  assert.equal(isBlocked(task, d), false);
});

test("done and dead tasks are never blocked and never idle", () => {
  const sarah = aStakeholder();
  const done = aTask({ status: "done", doneAt: "2026-07-14T10:00:00.000Z" });
  const dead = aTask({ death: { reason: "delegated", at: "2026-07-14T10:00:00.000Z" } });
  const d = dataset({ tasks: [done, dead], stakeholders: [sarah] });

  assert.equal(isBlocked(done, d), false);
  assert.equal(isBlocked(dead, d), false);
  assert.equal(idleDays(done, NOW), null);
  assert.equal(idleDays(dead, NOW), null);
});

test("untouched 14d+ is ROTTING", () => {
  const rotting = aTask({ todoSince: daysAgo(20) });
  const fresh = aTask({ todoSince: daysAgo(3) });
  const d = dataset({ tasks: [rotting, fresh] });

  const s = urgencyOf(rotting, d, NOW);
  assert.equal(s.kind, "rotting");
  assert.equal(s.kind === "rotting" && s.days, 20);
  assert.equal(urgencyOf(fresh, d, NOW).kind, "quiet");
});

test("a deadline outranks rot — the date wins over the age", () => {
  const task = aTask({ todoSince: daysAgo(30), deadline: daysAhead(2) });
  const d = dataset({ tasks: [task] });
  assert.equal(urgencyOf(task, d, NOW).kind, "due");
});

test("THE LAW — urgency takes no input; there is no override", () => {
  // If the formula puts something in QUIET that he knows is hot, there is
  // nothing to do about it. That is the no-priority law, and the cost is
  // accepted deliberately: a field to argue with is what priority WAS.
  const task = aTask({ todoSince: null });
  const d = dataset({ tasks: [task] });

  // The signature is the proof: (task, data, now). No user input, anywhere.
  assert.equal(urgencyOf(task, d, NOW).kind, "quiet");
  assert.equal(urgencyOf.length, 3);
});

test("AD-3 — the clock is an argument; the same task reads differently at a later now", () => {
  // Pure: no Date.now() anywhere in derive/. This is what makes urgency
  // testable without mocking the clock or waiting a day.
  const task = aTask({ deadline: "2026-07-20" });
  const d = dataset({ tasks: [task] });

  assert.equal(urgencyOf(task, d, "2026-07-18").kind, "due");
  assert.equal(urgencyOf(task, d, "2026-07-01").kind, "quiet");
  assert.equal(urgencyOf(task, d, "2026-07-25").kind, "overdue");
});

test("a stakeholder ref pointing at nobody does not fabricate a signal", () => {
  const task = aTask({ stakeholders: [{ id: "sh_deadbeef" as never, direction: "down" }] });
  const d = dataset({ tasks: [task], stakeholders: [] });
  assert.equal(isBlocked(task, d), false);
});

test("idleDays reads the STAMPED todoSince (AD-4), not a derivation", () => {
  // With no event log there is nothing to derive this from. The stamp is the
  // sanctioned exception, and this is the field that would have made FR-16/21
  // render empty had it been treated as computed.
  const task = aTask({ todoSince: daysAgo(6) });
  assert.equal(idleDays(task, NOW), 6);
  assert.equal(idleDays(aTask({ todoSince: null }), NOW), null);
});

void aProject;
