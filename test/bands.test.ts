import assert from "node:assert/strict";
import { test } from "node:test";
import { ruleBar, shelf } from "../src/derive/bands.ts";
import { INBOX_PROJECT_ID } from "../src/model/types.ts";
import { aCapture, aProject, aStakeholder, aTask, dataset, daysAgo, daysAhead, NOW } from "./fixtures.ts";

test("the band IS the sort — a project lands by its most urgent open task", () => {
  const p = aProject({ title: "Helvetia bid" });
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [
      aTask({ project: p.id, title: "quiet one" }),
      aTask({ project: p.id, title: "due one", deadline: daysAhead(2) }),
    ],
  });

  const bands = shelf(d, NOW);
  const now = bands.find((b) => b.def.kind === "now");
  assert.ok(now, "expected a NOW band");
  assert.equal(now.strips[0]!.project.title, "Helvetia bid");
});

test("UNSORTED is first — the only row on the shelf whose target is zero", () => {
  const d = dataset({ captures: [aCapture(), aCapture({ id: "cp_00000002" as never })] });
  const bands = shelf(d, NOW);
  assert.equal(bands[0]!.def.kind, "unsorted");
  assert.equal(bands[0]!.captureCount, 2);
});

test("the nag carries the count and the age of the oldest capture (FR-5)", () => {
  const d = dataset({
    captures: [
      aCapture({ capturedAt: "2026-07-09T09:00:00.000Z" }),
      aCapture({ id: "cp_00000002" as never, capturedAt: "2026-07-14T09:00:00.000Z" }),
    ],
  });
  const unsorted = shelf(d, NOW)[0]!;
  assert.equal(unsorted.captureCount, 2);
  assert.equal(unsorted.oldestCaptureDays, 6);
});

test("a CAPTURE is a raw pip on the band; a TASK on Inbox is a strip", () => {
  // The two must not be confused. A band is not a project -- that is what keeps
  // "one pip = one real task" true for every strip. But a capture RESOLVED into
  // a task stops being a capture, so it has to leave the band and appear on the
  // Inbox strip. Skipping Inbox made resolved captures vanish.
  const d = dataset({
    tasks: [aTask({ project: INBOX_PROJECT_ID, title: "resolved into a task" })],
    captures: [aCapture()],
  });
  const bands = shelf(d, NOW);

  const unsorted = bands.find((b) => b.def.kind === "unsorted")!;
  assert.equal(unsorted.captureCount, 1);
  assert.equal(unsorted.strips.length, 0, "a capture is never a strip");

  const inbox = bands.flatMap((b) => b.strips).find((s) => s.project.id === INBOX_PROJECT_ID);
  assert.ok(inbox, "a task with no project must be visible on the Inbox strip");
  assert.equal(inbox.tasks.length, 1);
});

test("an empty Inbox renders no strip — like every other project", () => {
  const d = dataset({ captures: [aCapture()] });
  const inbox = shelf(d, NOW)
    .flatMap((b) => b.strips)
    .find((s) => s.project.id === INBOX_PROJECT_ID);
  assert.equal(inbox, undefined);
});

test("a resolved capture stops nagging", () => {
  const d = dataset({
    captures: [aCapture({ state: "resolved" }), aCapture({ id: "cp_00000002" as never })],
  });
  assert.equal(shelf(d, NOW)[0]!.captureCount, 1);
});

test("an empty Inbox band does not render at all", () => {
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [aTask({ project: p.id })],
  });
  assert.equal(
    shelf(d, NOW).some((b) => b.def.kind === "unsorted"),
    false,
  );
});

test("a ↓ stakeholder puts the project in WAITING ON SOMEONE", () => {
  const sarah = aStakeholder();
  const p = aProject({ title: "Docs migration" });
  const d = dataset({
    projects: [...dataset().projects, p],
    stakeholders: [sarah],
    tasks: [aTask({ project: p.id, stakeholders: [{ id: sarah.id, direction: "down" }] })],
  });

  const waiting = shelf(d, NOW).find((b) => b.def.kind === "waiting");
  assert.ok(waiting);
  assert.equal(waiting.strips[0]!.project.title, "Docs migration");
});

test("a deadline ≤21d out with nothing urgent lands in SOON", () => {
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [aTask({ project: p.id, deadline: daysAhead(14) })],
  });
  const bands = shelf(d, NOW);
  assert.ok(bands.find((b) => b.def.kind === "soon"));
});

test("a project of only done tasks is QUIET, not rotting", () => {
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [
      aTask({ project: p.id, status: "done", doneAt: "2026-07-14T09:00:00.000Z", todoSince: daysAgo(40) }),
    ],
  });
  const bands = shelf(d, NOW);
  assert.ok(bands.find((b) => b.def.kind === "quiet"));
});

test("every band states its predicate — nothing is on screen unexplained", () => {
  for (const b of shelf(dataset({ captures: [aCapture()] }), NOW)) {
    assert.ok(b.def.predicate.length > 0, `${b.def.label} has no predicate`);
  }
});

/*
 * This test asserted the OPPOSITE until 2026-07-16, and that assertion was the
 * dead end: `＋ project` made a project the shelf then refused to draw, and a
 * strip you cannot see is a strip you cannot add a task to. Every road led back
 * to the drain.
 *
 * Nothing ever decided empty projects should hide. FR-9 says "render EVERY
 * project as a strip", and the spine is silent — it was an assumption that
 * reached the test file wearing a law's clothes.
 */
test("a project with no tasks RENDERS — a bare project is a finished project", () => {
  const p = aProject();
  const d = dataset({ projects: [...dataset().projects, p] });
  const bands = shelf(d, NOW);
  assert.equal(bands.length, 1);
  assert.equal(bands[0]!.def.kind, "quiet");
  assert.equal(bands[0]!.strips[0]!.project.id, p.id);
  // It reads quiet, not urgent: there is nothing to compute urgency from.
  assert.equal(bands[0]!.strips[0]!.signal.kind, "quiet");
  assert.equal(bands[0]!.strips[0]!.total, 0);
});

/*
 * Inbox is the ONE exception, and for a reason that does not generalise: it is
 * machinery, not a decision he made. An always-present empty Inbox strip would
 * be a permanent 0/0 row he never chose.
 */
test("the empty Inbox does NOT render — it is machinery, not a project", () => {
  assert.equal(shelf(dataset(), NOW).length, 0);
});

test("the strip's fraction counts done over living tasks — dead ones are not failures", () => {
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [
      aTask({ project: p.id, status: "done", doneAt: "2026-07-14T09:00:00.000Z" }),
      aTask({ project: p.id }),
      aTask({ project: p.id, death: { reason: "cancelled", at: "2026-07-10T09:00:00.000Z" } }),
    ],
  });
  const strip = shelf(d, NOW).flatMap((b) => b.strips)[0]!;
  assert.equal(strip.done, 1);
  assert.equal(strip.total, 2);
});

test("the rule bar names what is hidden, on purpose (FR-11)", () => {
  // Born from: "unclear aspect is weekly tasks displayed (3 out of 17) --
  // why those and not others?"
  assert.equal(
    ruleBar(3, 17, "committed: weekOf = W29"),
    "showing the 3 items where committed: weekOf = W29 · 14 not shown, on purpose",
  );
  assert.equal(ruleBar(5, 5, "x"), "showing the 5 items where x");
  assert.equal(ruleBar(1, 1, "x"), "showing the 1 item where x");
});
