import assert from "node:assert/strict";
import { test } from "node:test";
import { projectSheet } from "../src/derive/sheet.ts";
import { backlogVm } from "../src/derive/viewmodel.ts";
import { INBOX_PROJECT_ID } from "../src/model/types.ts";
import { aProject, aTask, dataset, NOW } from "./fixtures.ts";

const WEEK = "2026-W29";
const CHORDS = {
  deadline: "Alt+D", subtasks: "Alt+S", log: "Alt+L",
  stakeholders: "Alt+P", tags: "Alt+T", commit: "Alt+W", die: "Alt+Backspace",
};

test("an archived project leaves the live bands for ARCHIVED", () => {
  const live = aProject({ title: "Live one" });
  const archived = aProject({ title: "Put away", archived: "2026-07-17T10:00:00.000Z" });
  const d = dataset({
    projects: [...dataset().projects, live, archived],
    tasks: [aTask({ project: live.id }), aTask({ project: archived.id, status: "done", doneAt: "2026-07-15T10:00:00.000Z" })],
  });
  const bands = backlogVm(d, NOW, WEEK, false).bands;
  const archivedBand = bands.find((b) => b.kind === "archived");
  const liveBands = bands.filter((b) => b.kind !== "archived");

  assert.ok(archivedBand, "an ARCHIVED band exists");
  assert.deepEqual(archivedBand!.strips.map((s) => s.title), ["Put away"]);
  // The archived project is in NO live band.
  for (const b of liveBands) assert.ok(!b.strips.some((s) => s.title === "Put away"));
});

test("the ARCHIVED band is folded by default, and opens when asked", () => {
  const archived = aProject({ archived: "2026-07-17T10:00:00.000Z" });
  const d = dataset({ projects: [...dataset().projects, archived], tasks: [] });

  const folded = backlogVm(d, NOW, WEEK, false, undefined, null, undefined, [], [], false);
  assert.equal(folded.bands.find((b) => b.kind === "archived")?.folded, true);

  const open = backlogVm(d, NOW, WEEK, false, undefined, null, undefined, [], [], true);
  assert.equal(open.bands.find((b) => b.kind === "archived")?.folded, false);
});

test("the living-work count excludes archived projects", () => {
  const live = aProject();
  const archived = aProject({ archived: "2026-07-17T10:00:00.000Z" });
  const d = dataset({
    projects: [...dataset().projects, live, archived],
    tasks: [aTask({ project: live.id }), aTask({ project: archived.id })],
  });
  // The rule bar denominator is total NON-archived projects: the archived one
  // is not part of "living work", so it must not inflate the count.
  const b = backlogVm(d, NOW, WEEK, false);
  assert.match(b.rule, /the 1 item/); // one live project shown, archived excluded
});

test("project actions: empty ⇒ delete, finished ⇒ archive, archived ⇒ unarchive", () => {
  // Empty project: deletable, not archivable.
  const empty = aProject();
  const se = projectSheet(empty, dataset({ projects: [empty] }), NOW, CHORDS);
  assert.deepEqual(se.projectActions, { canDelete: true, canArchive: false, isArchived: false });

  // Finished project (a task, all done): archivable, not deletable.
  const fin = aProject();
  const dFin = dataset({
    projects: [fin],
    tasks: [aTask({ project: fin.id, status: "done", doneAt: "2026-07-15T10:00:00.000Z" })],
  });
  const sf = projectSheet(fin, dFin, NOW, CHORDS);
  assert.deepEqual(sf.projectActions, { canDelete: false, canArchive: true, isArchived: false });

  // In-progress project: neither (an open task remains).
  const wip = aProject();
  const dWip = dataset({ projects: [wip], tasks: [aTask({ project: wip.id, status: "todo" })] });
  const sw = projectSheet(wip, dWip, NOW, CHORDS);
  assert.deepEqual(sw.projectActions, { canDelete: false, canArchive: false, isArchived: false });

  // Archived project: unarchive offered.
  const arch = aProject({ archived: "2026-07-17T10:00:00.000Z" });
  const sa = projectSheet(arch, dataset({ projects: [arch] }), NOW, CHORDS);
  assert.equal(sa.projectActions?.isArchived, true);
});

test("the Inbox offers no project actions — it is machinery", () => {
  const d = dataset();
  const inbox = d.projects.find((p) => p.id === INBOX_PROJECT_ID)!;
  const s = projectSheet(inbox, d, NOW, CHORDS);
  assert.deepEqual(s.projectActions, { canDelete: false, canArchive: false, isArchived: false });
});
