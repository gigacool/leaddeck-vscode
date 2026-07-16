import assert from "node:assert/strict";
import { test } from "node:test";
import { addWeeks, daysBetween, toDay, toWeek, weekDays } from "../src/model/dates.ts";

test("toWeek — ISO weeks start Monday", () => {
  // 2026-07-13 is a Monday, 2026-07-19 the Sunday that closes the same week.
  assert.equal(toWeek(new Date(2026, 6, 13)), toWeek(new Date(2026, 6, 19)));
  assert.notEqual(toWeek(new Date(2026, 6, 19)), toWeek(new Date(2026, 6, 20)));
});

test("toWeek — week 1 is the week containing the first Thursday", () => {
  // 2027-01-01 is a Friday, so it belongs to 2026's last ISO week.
  assert.equal(toWeek(new Date(2027, 0, 1)), "2026-W53");
  // 2026-01-01 is a Thursday, so it IS week 1.
  assert.equal(toWeek(new Date(2026, 0, 1)), "2026-W01");
});

test("addWeeks — steps and crosses a year boundary", () => {
  assert.equal(addWeeks("2026-W29", 1), "2026-W30");
  assert.equal(addWeeks("2026-W29", -1), "2026-W28");
  assert.equal(addWeeks("2026-W52", 1), "2026-W53");
  assert.equal(addWeeks("2026-W53", 1), "2027-W01");
});

test("addWeeks — the six-week stepper (FR-20) walks back cleanly", () => {
  let w = "2026-W29";
  const seen = [w];
  for (let i = 0; i < 5; i++) {
    w = addWeeks(w, -1);
    seen.push(w);
  }
  assert.deepEqual(seen, [
    "2026-W29",
    "2026-W28",
    "2026-W27",
    "2026-W26",
    "2026-W25",
    "2026-W24",
  ]);
});

test("weekDays — seven days, Monday through Sunday", () => {
  const days = weekDays("2026-W29");
  assert.equal(days.length, 7);
  assert.equal(days[0], "2026-07-13"); // Monday
  assert.equal(days[6], "2026-07-19"); // Sunday
  // Every day is inside the week it names — the anchor matches toWeek's.
  assert.ok(days.every((d) => toWeek(new Date(...ymd(d))) === "2026-W29"));
});

test("weekDays — the first ISO week of a year that starts mid-week", () => {
  // 2026-W01 contains 2026-01-01 (a Thursday); its Monday is 2025-12-29.
  const days = weekDays("2026-W01");
  assert.equal(days[0], "2025-12-29");
  assert.equal(days[6], "2026-01-04");
});

/** Local-calendar (Y, M-1, D) tuple for constructing a Date without UTC drift. */
function ymd(day: string): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number);
  return [y!, m! - 1, d!];
}

test("daysBetween — signed, and a past deadline is negative", () => {
  assert.equal(daysBetween("2026-07-15", "2026-07-20"), 5);
  assert.equal(daysBetween("2026-07-15", "2026-07-15"), 0);
  assert.equal(daysBetween("2026-07-15", "2026-07-10"), -5);
});

test("daysBetween — a DST boundary does not lose a day", () => {
  // Rounding, not flooring, is what makes this hold.
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2);
  assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2);
});

test("toDay — local calendar date, not UTC", () => {
  assert.equal(toDay(new Date(2026, 6, 15, 23, 30)), "2026-07-15");
  assert.equal(toDay(new Date(2026, 0, 5, 0, 30)), "2026-01-05");
});
