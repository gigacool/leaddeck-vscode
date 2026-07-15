import assert from "node:assert/strict";
import { test } from "node:test";
import { collide } from "../src/derive/collide.ts";
import { aProject, aTask, dataset, NOW } from "./fixtures.ts";

function helvetia() {
  const p = aProject({ title: "Helvetia bid" });
  const task = aTask({
    project: p.id,
    title: "Bid: legal sign-off on SLA",
    todoSince: "2026-07-06",
  });
  const d = dataset({ projects: [...dataset().projects, p], tasks: [task] });
  return { p, task, d };
}

test("THE ONE THAT MATTERS — the collision arrives before the word is finished", () => {
  // He types "helvetia leg" mid-sentence, with someone at his desk. The match
  // surfaces unasked. The duplicate cannot happen -- not because he was
  // disciplined, but because it arrived first.
  const { d } = helvetia();
  const hits = collide("helvetia leg", d, NOW);

  assert.ok(hits.length > 0, "expected a collision");
  assert.equal(hits[0]!.title, "Bid: legal sign-off on SLA");
  assert.equal(hits[0]!.context, "Helvetia bid");
});

test("matching spans title AND project — neither word is in the other", () => {
  // "helvetia" is only in the project; "leg" is only in the task title.
  // Matching either alone would miss it.
  const { d } = helvetia();
  assert.equal(collide("helvetia", d, NOW).length > 0, true);
  assert.equal(collide("leg", d, NOW).length > 0, true);
  assert.equal(collide("helvetia leg", d, NOW).length > 0, true);
});

test("every token must hit — a wrong word means no match, not a loose one", () => {
  const { d } = helvetia();
  assert.deepEqual(collide("helvetia unicorn", d, NOW), []);
});

test("each match row carries title + project + computed signal (FR-3)", () => {
  // This is exactly what v1's workaround would have broken: it smeared the
  // query across every row's description, which is where the signal goes.
  // alwaysShow:true makes the poison unnecessary.
  const { d } = helvetia();
  const hit = collide("legal", d, NOW)[0]!;
  assert.equal(hit.title, "Bid: legal sign-off on SLA");
  assert.equal(hit.context, "Helvetia bid");
  assert.ok(hit.signal !== null);
});

test("a project is a peer result, not a lesser one", () => {
  // Note-on-project is one of the three resolutions, all one keystroke.
  const { d } = helvetia();
  const hits = collide("helvetia", d, NOW);
  assert.ok(hits.some((h) => h.kind === "project"));
});

test("dead tasks never collide — they are gone, not hidden", () => {
  const p = aProject({ title: "Helvetia bid" });
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [
      aTask({
        project: p.id,
        title: "Bid: legal sign-off",
        death: { reason: "cancelled", at: "2026-07-01T09:00:00.000Z" },
      }),
    ],
  });
  assert.deepEqual(
    collide("legal", d, NOW).filter((h) => h.kind === "task"),
    [],
  );
});

test("a done task still collides, but ranks below a live one", () => {
  // He might be logging a note about something he finished.
  const p = aProject({ title: "Docs" });
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [
      aTask({ project: p.id, title: "api docs draft", status: "done", doneAt: "2026-07-10T09:00:00.000Z" }),
      aTask({ project: p.id, title: "api docs review" }),
    ],
  });
  const hits = collide("api docs", d, NOW).filter((h) => h.kind === "task");
  assert.equal(hits.length, 2);
  assert.equal(hits[0]!.title, "api docs review");
});

test("exact beats prefix beats substring", () => {
  const p = aProject({ title: "P" });
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [
      aTask({ project: p.id, title: "reporting engine" }),
      aTask({ project: p.id, title: "report" }),
    ],
  });
  const hits = collide("report", d, NOW).filter((h) => h.kind === "task");
  assert.equal(hits[0]!.title, "report");
});

test("tags collide too — they carry the grouping milestones used to", () => {
  const p = aProject({ title: "Stream A", tags: ["transformation"] });
  const d = dataset({ projects: [...dataset().projects, p], tasks: [] });
  assert.ok(collide("transformation", d, NOW).some((h) => h.id === p.id));
});

test("an empty or punctuation-only query surfaces nothing", () => {
  const { d } = helvetia();
  assert.deepEqual(collide("", d, NOW), []);
  assert.deepEqual(collide("   ", d, NOW), []);
  assert.deepEqual(collide("---", d, NOW), []);
});

test("case and punctuation do not matter — he is typing fast", () => {
  const { d } = helvetia();
  assert.ok(collide("HELVETIA", d, NOW).length > 0);
  assert.ok(collide("sign-off", d, NOW).length > 0);
});

test("hits are capped — a QuickPick is not a search results page", () => {
  const p = aProject({ title: "Big" });
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: Array.from({ length: 30 }, (_, i) => aTask({ project: p.id, title: `task ${i}` })),
  });
  assert.ok(collide("task", d, NOW).length <= 6);
});

test("a single letter still collides — the point is matching mid-word", () => {
  const { d } = helvetia();
  assert.ok(collide("h", d, NOW).length > 0);
});
