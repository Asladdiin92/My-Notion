import assert from "node:assert/strict";
import test from "node:test";
import { getNextFocusWindow, selectNextAction } from "./next-action";
import type { Task } from "./types";

const task = ({ id, title, ...values }: Partial<Task> & Pick<Task, "id" | "title">): Task => ({
  id,
  title,
  url: "https://www.notion.so/example",
  status: "Not started",
  priority: "Medium",
  type: "Task",
  area: "University",
  course: "",
  nextAction: "",
  dueDate: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  completed: false,
  ...values,
});

test("ranks overdue work first and excludes completed tasks", () => {
  const result = selectNextAction([
    task({ id: "overdue", title: "Overdue", priority: "Low", dueDate: "2026-10-03" }),
    task({ id: "today", title: "Due today", priority: "Critical", dueDate: "2026-10-04" }),
    task({ id: "done", title: "Completed", completed: true, priority: "Critical", dueDate: "2026-10-03" }),
  ], new Date("2026-10-04T07:00:00.000Z"));

  assert.equal(result.candidate?.id, "overdue");
  assert.equal(result.candidate?.dueLabel, "Overdue");
});

test("uses the next available meeting-free focus interval", () => {
  const window = getNextFocusWindow(
    new Date("2026-10-04T07:00:00.000Z"),
    "Africa/Addis_Ababa",
    [{ start: "2026-10-04T08:00:00.000Z", end: "2026-10-04T09:00:00.000Z" }],
  );
  assert.deepEqual(window, {
    date: "2026-10-04",
    startTime: "10:00",
    endTime: "11:00",
    availableMinutes: 60,
    nextEventStart: "11:00",
  });
});

test("prefers work that fits before the next meeting", () => {
  const result = selectNextAction([
    task({ id: "long", title: "Long task", dueDate: "2026-10-04", estimatedHours: 2 }),
    task({ id: "short", title: "Short task", dueDate: "2026-10-04", estimatedHours: 0.25 }),
  ], new Date("2026-10-04T07:00:00.000Z"), "Africa/Addis_Ababa", [
    { start: "2026-10-04T07:30:00.000Z", end: "2026-10-04T08:30:00.000Z" },
  ]);
  assert.equal(result.candidate?.id, "short");
  assert.equal(result.focusWindow?.availableMinutes, 30);
});

test("treats an expired time-specific deadline as overdue", () => {
  const result = selectNextAction(
    [task({ id: "timed", title: "Timed task", dueDate: "2026-10-04T09:00:00.000Z" })],
    new Date("2026-10-04T09:30:00.000Z"),
  );
  assert.equal(result.candidate?.dueLabel, "Overdue");
});

test("moves recommendations to the next work window after hours", () => {
  const result = selectNextAction(
    [task({ id: "tomorrow", title: "Tomorrow's task" })],
    new Date("2026-10-04T19:58:00.000Z"),
  );
  assert.equal(result.focusWindow?.date, "2026-10-05");
  assert.equal(result.focusWindow?.startTime, "08:30");
});

test("skips a day blocked by an all-day calendar event", () => {
  const window = getNextFocusWindow(
    new Date("2026-10-04T07:00:00.000Z"),
    "Africa/Addis_Ababa",
    [{ start: "2026-10-04", end: "2026-10-05" }],
  );
  assert.equal(window?.date, "2026-10-05");
  assert.equal(window?.startTime, "08:30");
});
