import assert from "node:assert/strict";
import { test } from "node:test";
import { backlogVm, buildViewModel, kanbanVm, reportVm } from "../src/derive/viewmodel.ts";
import type { UiState } from "../src/derive/viewmodel.ts";
import { addWeeks } from "../src/model/dates.ts";
import { aCapture, aProject, aStakeholder, aTask, dataset, daysAgo, daysAhead, NOW } from "./fixtures.ts";

const WEEK = "2026-W29";
const CHORDS = {
  deadline: "Alt+D",
  subtasks: "Alt+S",
  log: "Alt+L",
  stakeholders: "Alt+P",
  tags: "Alt+T",
  commit: "Alt+W",
  die: "Alt+Backspace",
};

const ui = (over: Partial<UiState> = {}): UiState => ({
  mode: "backlog",
  drainOpen: false,
  open: null,
  asked: [],
  weekOffset: 0,
  root: "/home/cedric/LeadDeck",
  rootKind: "home",
  captureChord: "Ctrl+Alt+L",
  chords: CHORDS,
  ...over,
});

test("AD-11 — one mode is built per paint; the others are null", () => {
  // The webview is handed the COMPLETE view model for the active mode. Never a
  // delta, never a patch, and never three modes at once.
  const d = dataset();
  const vm = buildViewModel(d, NOW, WEEK, ui({ mode: "kanban" }), "/r/2026-W29.md");
  assert.equal(vm.backlog, null);
  assert.ok(vm.kanban);
  assert.equal(vm.report, null);
});

test("AD-7 — the resolved root is in every view model, whatever the mode", () => {
  for (const mode of ["backlog", "kanban", "report"] as const) {
    const vm = buildViewModel(dataset(), NOW, WEEK, ui({ mode }), "/r/w.md");
    assert.equal(vm.root, "/home/cedric/LeadDeck");
    assert.equal(vm.rootKind, "home");
  }
});

test("the drain is a SUB-STATE of backlog, not a mode", () => {
  // It rides inside BacklogVm. There is no fourth mode -- the fourth mode is
  // how v1 became five panels.
  const d = dataset({ captures: [aCapture()] });
  assert.equal(backlogVm(d, NOW, WEEK, false).drain, null);
  assert.ok(backlogVm(d, NOW, WEEK, true).drain);
});

test("the drain shows ALL captures at once — no queue, no countdown", () => {
  const captures = Array.from({ length: 11 }, (_, i) =>
    aCapture({ id: `cp_0000000${i}` as never }),
  );
  const d = dataset({ captures });
  const drain = backlogVm(d, NOW, WEEK, true).drain!;
  assert.equal(drain.captures.length, 11);
});

test("resolve 3, leave 8 — the count reads 8, and nothing is abandoned", () => {
  const captures = Array.from({ length: 11 }, (_, i) =>
    aCapture({ id: `cp_0000000${i}` as never, state: i < 3 ? "resolved" : "unsorted" }),
  );
  const d = dataset({ captures });
  const b = backlogVm(d, NOW, WEEK, true);
  assert.equal(b.drain!.captures.length, 8);
  assert.equal(b.bands[0]!.count, 8);
});

test("a capture resolved to a task becomes VISIBLE — the first-run bug", () => {
  // Found by actually running it: capture worked, the task was written, and the
  // shelf drew nothing. A task on pj_inbox is a real task and must appear.
  const d = dataset({
    tasks: [aTask({ project: "pj_inbox" as never, title: "comex deck — Q3 numbers" })],
  });
  const pips = backlogVm(d, NOW, WEEK, false).bands.flatMap((b) => b.strips.flatMap((s) => s.pips));
  assert.equal(pips.length, 1);
  assert.equal(pips[0]!.title, "comex deck — Q3 numbers");
});

test("the rule bar counts the Inbox strip too — the denominator must not lie", () => {
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [aTask({ project: "pj_inbox" as never }), aTask({ project: p.id })],
  });
  // 2 projects with living work, 2 shown: nothing is hidden, so the bar must
  // not claim otherwise.
  assert.match(backlogVm(d, NOW, WEEK, false).rule, /showing the 2 items/);
  assert.doesNotMatch(backlogVm(d, NOW, WEEK, false).rule, /not shown/);
});

test("every band carries a stated predicate — the webview never invents one", () => {
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [aTask({ project: p.id, deadline: daysAhead(1) })],
    captures: [aCapture()],
  });
  for (const b of backlogVm(d, NOW, WEEK, false).bands) {
    assert.ok(b.predicate.length > 0, `${b.label} has no predicate`);
  }
});

test("a pip carries its title — you hover, because 9px cannot be read", () => {
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [aTask({ project: p.id, title: "Ship API docs" })],
  });
  const pip = backlogVm(d, NOW, WEEK, false).bands.flatMap((b) => b.strips)[0]!.pips[0]!;
  assert.equal(pip.title, "Ship API docs");
});

test("one pip = one real task; it NEVER aggregates", () => {
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: Array.from({ length: 23 }, () => aTask({ project: p.id })),
  });
  const strip = backlogVm(d, NOW, WEEK, false).bands.flatMap((b) => b.strips)[0]!;
  assert.equal(strip.pips.length, 23);
});

test("a dead task has no pip — dead is not hidden work, it is gone", () => {
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [
      aTask({ project: p.id }),
      aTask({ project: p.id, death: { reason: "delegated", at: "2026-07-10T09:00:00.000Z" } }),
    ],
  });
  const strip = backlogVm(d, NOW, WEEK, false).bands.flatMap((b) => b.strips)[0]!;
  assert.equal(strip.pips.length, 1);
});

test("the .wk outline marks THIS week only", () => {
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [
      aTask({ project: p.id, committed: { weekOf: WEEK } }),
      aTask({ project: p.id, committed: { weekOf: "2026-W30" } }),
      aTask({ project: p.id }),
    ],
  });
  const pips = backlogVm(d, NOW, WEEK, false).bands.flatMap((b) => b.strips)[0]!.pips;
  assert.equal(pips.filter((p) => p.wk).length, 1);
});

test("a blocked task renders a block pip — derived, never stored", () => {
  const sarah = aStakeholder();
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    stakeholders: [sarah],
    tasks: [aTask({ project: p.id, stakeholders: [{ id: sarah.id, direction: "down" }] })],
  });
  const pip = backlogVm(d, NOW, WEEK, false).bands.flatMap((b) => b.strips)[0]!.pips[0]!;
  assert.equal(pip.state, "block");
});

test("KANBAN's fourth column is COMPUTED — blocked is not a status", () => {
  const sarah = aStakeholder();
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    stakeholders: [sarah],
    tasks: [
      aTask({ project: p.id, committed: { weekOf: WEEK }, title: "plain todo" }),
      aTask({
        project: p.id,
        committed: { weekOf: WEEK },
        title: "waiting on Sarah",
        stakeholders: [{ id: sarah.id, direction: "down" }],
      }),
    ],
  });

  const k = kanbanVm(d, NOW, WEEK);
  const blocked = k.columns.find((c) => c.key === "blocked")!;
  const committed = k.columns.find((c) => c.key === "committed")!;
  assert.equal(blocked.cards.length, 1);
  assert.equal(blocked.cards[0]!.title, "waiting on Sarah");
  assert.equal(committed.cards.length, 1);
});

test("KANBAN is scoped to the committed week and says so", () => {
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [
      aTask({ project: p.id, committed: { weekOf: WEEK } }),
      aTask({ project: p.id, committed: { weekOf: "2026-W30" } }),
      aTask({ project: p.id }),
    ],
  });
  const k = kanbanVm(d, NOW, WEEK);
  assert.equal(k.columns.reduce((n, c) => n + c.cards.length, 0), 1);
  assert.match(k.rule, /committed: weekOf = 2026-W29/);
});

test("KANBAN's columns are fixed — four, in order, not configurable", () => {
  const k = kanbanVm(dataset(), NOW, WEEK);
  assert.deepEqual(
    k.columns.map((c) => c.key),
    ["committed", "doing", "blocked", "done"],
  );
});

test("REPORT — what happened is doneAt inside the week, nothing else", () => {
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [
      aTask({ project: p.id, title: "this week", status: "done", doneAt: "2026-07-15T10:00:00.000Z" }),
      aTask({ project: p.id, title: "last week", status: "done", doneAt: "2026-07-08T10:00:00.000Z" }),
      aTask({ project: p.id, title: "not done" }),
    ],
  });
  const r = reportVm(d, NOW, WEEK, 0, "/r/w.md");
  assert.equal(r.happened.length, 1);
  assert.equal(r.happened[0]!.title, "this week");
});

test("REPORT — 'where I'm stuck' is where a person owes the move", () => {
  const sarah = aStakeholder({ name: "Sarah" });
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    stakeholders: [sarah],
    tasks: [
      aTask({
        project: p.id,
        title: "legal sign-off",
        todoSince: daysAgo(9),
        stakeholders: [{ id: sarah.id, direction: "down" }],
      }),
    ],
  });
  const r = reportVm(d, NOW, WEEK, 0, "/r/w.md");
  assert.equal(r.stuck.length, 1);
  assert.equal(r.stuck[0]!.why, "blocked 9d");
});

test("REPORT — 'next' is next week's commitments, not this week's", () => {
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [
      aTask({ project: p.id, title: "this week", committed: { weekOf: WEEK } }),
      aTask({ project: p.id, title: "next week", committed: { weekOf: "2026-W30" } }),
    ],
  });
  const r = reportVm(d, NOW, WEEK, 0, "/r/w.md");
  assert.equal(r.next.length, 1);
  assert.equal(r.next[0]!.title, "next week");
});

test("REPORT — the file is named, never parsed", () => {
  // AD-9: the app inserts stubs at the cursor and never reads it back. The
  // ViewModel carries a PATH, not content -- that is the architecture visible
  // in the type.
  const r = reportVm(dataset(), NOW, WEEK, 0, "/home/cedric/LeadDeck/reports/2026-W29.md");
  assert.equal(r.reportPath, "/home/cedric/LeadDeck/reports/2026-W29.md");
  assert.equal("content" in r, false);
});

test("REPORT — at risk is capped; it is a section, not a list of everything", () => {
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: Array.from({ length: 9 }, (_, i) =>
      aTask({ project: p.id, title: `late ${i}`, deadline: daysAgo(i + 1) }),
    ),
  });
  assert.equal(reportVm(d, NOW, WEEK, 0, "/r/w.md").atRisk.length, 3);
});

test("FR-20 — at offset 0 the stepper is at the newest edge, not the floor", () => {
  const s = reportVm(dataset(), NOW, WEEK, 0, "/r/w.md").stepper;
  assert.equal(s.offset, 0);
  assert.equal(s.label, "this week");
  assert.equal(s.canForward, false); // there is no week newer than now
  assert.equal(s.canBack, true);
  assert.equal(s.atFloor, false);
});

test("FR-20 — the stepper is BOUNDED at six: the sixth week is the floor", () => {
  // Offset 5 is the sixth week (0..5). No week seven — the row past here is
  // export. This is the tripwire in a test: if the bound grows, this breaks.
  const s = reportVm(dataset(), NOW, addWeeks(WEEK, -5), 5, "/r/w.md").stepper;
  assert.equal(s.offset, 5);
  assert.equal(s.label, "5 weeks ago");
  assert.equal(s.canBack, false); // cannot step to a seventh week
  assert.equal(s.canForward, true);
  assert.equal(s.atFloor, true); // the — export — row is offered here, and only here
});

test("FR-20 — stepping back moves the REPORT's week; backlog stays on now", () => {
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [
      // Done this week (W29) and two weeks ago (W27).
      aTask({ project: p.id, title: "this week", status: "done", doneAt: "2026-07-15T10:00:00.000Z" }),
      aTask({ project: p.id, title: "two weeks ago", status: "done", doneAt: "2026-07-01T10:00:00.000Z" }),
    ],
  });

  const back = buildViewModel(d, NOW, WEEK, ui({ mode: "report", weekOffset: 2 }), "/r/W27.md");
  assert.equal(back.report!.week, addWeeks(WEEK, -2)); // 2026-W27
  assert.equal(back.report!.happened.length, 1);
  assert.equal(back.report!.happened[0]!.title, "two weeks ago");

  // The shelf never steps back — it is always now, or stepping it would be the
  // analytics panel by another door.
  const shelf = buildViewModel(d, NOW, WEEK, ui({ mode: "backlog", weekOffset: 2 }), "/r/w.md");
  assert.notEqual(shelf.backlog, null);
});

test("a signal's TEXT is decided here — the webview renders, it never computes", () => {
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [aTask({ project: p.id, deadline: daysAhead(2) })],
  });
  const sig = backlogVm(d, NOW, WEEK, false).bands.flatMap((b) => b.strips)[0]!.signal;
  assert.equal(sig.text, "2d");
  assert.equal(sig.tone, "danger");
});

test("a deadline today reads 'today', not '0d'", () => {
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [aTask({ project: p.id, deadline: NOW })],
  });
  const sig = backlogVm(d, NOW, WEEK, false).bands.flatMap((b) => b.strips)[0]!.signal;
  assert.equal(sig.text, "today");
});

test("a quiet strip reads — , never a fabricated number", () => {
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    tasks: [aTask({ project: p.id, todoSince: null })],
  });
  const sig = backlogVm(d, NOW, WEEK, false).bands.flatMap((b) => b.strips)[0]!.signal;
  assert.equal(sig.text, "—");
  assert.equal(sig.tone, "none");
});

test("direction renders as glyph AND name — never colour alone", () => {
  const boss = aStakeholder({ name: "Marc" });
  const p = aProject();
  const d = dataset({
    projects: [...dataset().projects, p],
    stakeholders: [boss],
    tasks: [aTask({ project: p.id, stakeholders: [{ id: boss.id, direction: "up" }] })],
  });
  const who = backlogVm(d, NOW, WEEK, false).bands.flatMap((b) => b.strips)[0]!.who;
  assert.deepEqual(who, { glyph: "↑", label: "Marc" });
});
