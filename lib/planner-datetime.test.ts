import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPlannerDate,
  plannerDateKey,
  plannerDateTimeInput,
  plannerLocalTimeToIso,
  todayInPlannerTimeZone,
} from "./planner-datetime";

test("uses the Harar timezone for dates, times, and local today", () => {
  assert.equal(todayInPlannerTimeZone(new Date("2026-10-01T22:00:00.000Z")), "2026-10-02");
  assert.equal(plannerDateKey("2026-10-01T22:00:00.000Z"), "2026-10-02");
  assert.equal(plannerDateTimeInput("2026-10-01T17:00:00.000Z"), "2026-10-01T20:00");
  assert.match(formatPlannerDate("2026-10-01T17:00:00.000Z"), /8:00 PM/);
});

test("converts planner wall-clock time in Ethiopia to a UTC timestamp", () => {
  assert.equal(plannerLocalTimeToIso("2026-10-05", "20:00"), "2026-10-05T17:00:00.000Z");
  assert.equal(plannerLocalTimeToIso("2026-10-05", "08:30"), "2026-10-05T05:30:00.000Z");
});

test("rejects invalid planner wall-clock values", () => {
  assert.throws(() => plannerLocalTimeToIso("2026-02-30", "20:00"), /valid date and time/);
  assert.throws(() => plannerLocalTimeToIso("2026-10-05", "25:00"), /valid date and time/);
});
