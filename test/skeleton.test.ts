import assert from "node:assert/strict";
import { test } from "node:test";
import { reportSkeleton } from "../src/derive/skeleton.ts";
import type { ReportVm } from "../src/model/protocol.ts";
import type { Burndown } from "../src/derive/burndown.ts";
import type { Week } from "../src/model/types.ts";

const WEEK = "2026-W29" as Week;
const NO_BURN: Burndown = { remaining: [], ideal: 0, idealLabel: "", empty: true };

function report(over: Partial<ReportVm> = {}): ReportVm {
  return {
    week: WEEK,
    rule: "",
    atRisk: [],
    happened: [],
    stuck: [],
    next: [],
    burndown: NO_BURN,
    stepper: { offset: 0, label: "this week", canBack: true, canForward: false, atFloor: false },
    reportPath: "/r/w.md",
    ...over,
  } as ReportVm;
}

const t = (id: string, title: string, project: string) => ({ id: id as never, title, project });

test("the skeleton names the week and all three sections", () => {
  const md = reportSkeleton(report(), WEEK);
  assert.match(md, /^# 2026-W29/);
  assert.match(md, /## What happened/);
  assert.match(md, /## Where I'm stuck/);
  assert.match(md, /## Next week/);
});

test("finished tasks are grouped under ### Project, in first-seen order", () => {
  const md = reportSkeleton(
    report({
      happened: [
        t("1", "ship the deck", "COMEX"),
        t("2", "fix the login", "Platform"),
        t("3", "review the slides", "COMEX"),
      ],
    }),
    WEEK,
  );
  // COMEX seen first, then Platform — order follows first appearance, not sort.
  assert.ok(md.indexOf("### COMEX") < md.indexOf("### Platform"));
  // Both COMEX tasks sit under the one heading, not two.
  assert.equal((md.match(/### COMEX/g) ?? []).length, 1);
  assert.match(md, /### COMEX\n- ship the deck — \n- review the slides — /);
  assert.match(md, /### Platform\n- fix the login — /);
});

test("every task line ends in the em-dash-and-space he writes after", () => {
  const md = reportSkeleton(report({ happened: [t("1", "ship it", "Inbox")] }), WEEK);
  assert.ok(md.includes("- ship it — "));
});

test("an empty section reads as a quiet placeholder, not a bare heading", () => {
  const md = reportSkeleton(report(), WEEK);
  // Three placeholders — nothing happened, nothing stuck, nothing next.
  assert.equal((md.match(/_\(nothing this week\)_/g) ?? []).length, 3);
});

test("stuck and next are laid out the same way as happened", () => {
  const md = reportSkeleton(
    report({
      stuck: [{ ...t("1", "legal sign-off", "Helvetia"), why: "blocked 9d" }],
      next: [t("2", "kickoff", "NewBiz")],
    }),
    WEEK,
  );
  assert.match(md, /## Where I'm stuck\n\n### Helvetia\n- legal sign-off — /);
  assert.match(md, /## Next week\n\n### NewBiz\n- kickoff — /);
});

test("a task with no project title falls under Inbox, never a blank heading", () => {
  const md = reportSkeleton(report({ happened: [t("1", "orphan", "")] }), WEEK);
  assert.match(md, /### Inbox\n- orphan — /);
  assert.doesNotMatch(md, /### \n/); // no empty heading
});
