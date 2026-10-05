import assert from "node:assert/strict";
import test from "node:test";
import { calculateFocusMinutesToday } from "./focus-metrics";

test("counts completed and valid active session overlap in the local day", () => {
  const now = new Date("2026-10-05T09:30:00.000Z");
  const sessions = [
    {
      status: "completed",
      startedAt: "2026-10-04T20:30:00.000Z",
      endedAt: "2026-10-04T22:00:00.000Z",
    },
    {
      status: "active",
      startedAt: "2026-10-05T09:00:00.000Z",
    },
    {
      status: "completed",
      startedAt: "2026-10-05T07:00:00.000Z",
      endedAt: "2026-10-05T08:30:00.000Z",
    },
  ];

  assert.equal(calculateFocusMinutesToday(sessions, "Africa/Addis_Ababa", now), 180);
});

test("ignores malformed, unfinished, future, stale, and excessive focus records", () => {
  const now = new Date("2026-10-05T12:00:00.000Z");
  const sessions = [
    { status: "completed", startedAt: "invalid", endedAt: "2026-10-05T11:00:00.000Z" },
    { status: "completed", startedAt: "2026-10-05T10:00:00.000Z" },
    { status: "completed", startedAt: "2026-10-05T10:00:00.000Z", endedAt: "2026-10-05T09:00:00.000Z" },
    { status: "completed", startedAt: "2026-10-05T10:00:00.000Z", endedAt: "2026-10-06T10:00:00.000Z" },
    { status: "active", startedAt: "2026-10-05T13:00:00.000Z" },
    { status: "active", startedAt: "2026-10-04T20:00:00.000Z" },
    { status: "paused", startedAt: "2026-10-05T10:00:00.000Z", endedAt: "2026-10-05T11:00:00.000Z" },
  ];

  assert.equal(calculateFocusMinutesToday(sessions, "UTC", now), 0);
});

test("uses local calendar-day boundaries through daylight-saving transitions", () => {
  const now = new Date("2026-03-08T16:00:00.000Z");
  const sessions = [{
    status: "completed",
    startedAt: "2026-03-08T05:00:00.000Z",
    endedAt: "2026-03-08T16:00:00.000Z",
  }];

  assert.equal(calculateFocusMinutesToday(sessions, "America/New_York", now), 660);
});

test("does not double-count overlapping recorded sessions", () => {
  const sessions = [
    {
      status: "completed",
      startedAt: "2026-10-05T09:00:00.000Z",
      endedAt: "2026-10-05T10:00:00.000Z",
    },
    {
      status: "completed",
      startedAt: "2026-10-05T09:30:00.000Z",
      endedAt: "2026-10-05T10:30:00.000Z",
    },
  ];

  assert.equal(
    calculateFocusMinutesToday(sessions, "UTC", new Date("2026-10-05T11:00:00.000Z")),
    90,
  );
});
