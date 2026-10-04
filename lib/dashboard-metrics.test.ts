import assert from "node:assert/strict";
import test from "node:test";
import { calculateDashboardTaskMetrics } from "./dashboard-metrics";
import type { Task } from "./types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    url: "https://notion.so/task-1",
    title: "Planner item",
    status: "Planned",
    priority: "Medium",
    type: "Task",
    area: "University",
    course: "",
    nextAction: "",
    dueDate: null,
    createdAt: "2026-10-04T00:00:00.000Z",
    completed: false,
    ...overrides,
  };
}

test("counts open tasks due on the user's local date and excludes completed items", () => {
  const tasks = [
    task({ id: "date-only", dueDate: "2026-10-05" }),
    task({ id: "local-midnight", dueDate: "2026-10-04T21:30:00.000Z" }),
    task({ id: "done-flag", dueDate: "2026-10-05", completed: true }),
    task({ id: "done-status", dueDate: "2026-10-05", status: "Done" }),
    task({ id: "tomorrow", dueDate: "2026-10-05T21:00:00.000Z" }),
    task({ id: "missing-date" }),
    task({ id: "invalid-date", dueDate: "not-a-date" }),
  ];

  assert.deepEqual(
    calculateDashboardTaskMetrics(tasks, "Africa/Addis_Ababa", new Date("2026-10-04T22:00:00.000Z")),
    { tasksDueToday: 2, activeProjects: 1, notesCount: 0 },
  );
});

test("counts unique active areas and non-empty notes, including safely empty datasets", () => {
  const tasks = [
    task({ id: "one", area: "University", notes: "  Lecture notes " }),
    task({ id: "two", area: "University", notes: " " }),
    task({ id: "complete-area", area: "Archived", completed: true, notes: "Saved note" }),
    task({ id: "unassigned", area: "Unassigned" }),
    task({ id: "other", area: "Other" }),
  ];

  assert.deepEqual(
    calculateDashboardTaskMetrics(tasks, "UTC", new Date("2026-10-05T12:00:00.000Z")),
    { tasksDueToday: 0, activeProjects: 1, notesCount: 2 },
  );
  assert.deepEqual(
    calculateDashboardTaskMetrics([], "UTC", new Date("2026-10-05T12:00:00.000Z")),
    { tasksDueToday: 0, activeProjects: 0, notesCount: 0 },
  );
});

test("rejects invalid time zones rather than returning misleading metric values", () => {
  assert.throws(
    () => calculateDashboardTaskMetrics([], "Invalid/Zone", new Date()),
    RangeError,
  );
});
