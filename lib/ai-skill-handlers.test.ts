import assert from "node:assert/strict";
import test from "node:test";
import { filterAndProjectTasks, getSkillHandler, parseListTasksParameters } from "./ai-skill-handlers";
import type { Task } from "./types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    url: "https://notion.example/private-task",
    title: "Review chapter",
    status: "Planned",
    priority: "High",
    type: "Study",
    area: "University",
    course: "Biology",
    nextAction: "Read notes",
    dueDate: "2026-10-07",
    createdAt: "2026-10-01T00:00:00.000Z",
    completed: false,
    notes: "Private notes",
    peopleInstructorIds: ["private-person-id"],
    ...overrides,
  };
}

test("uses pending and limit 20 as list_tasks defaults", () => {
  assert.deepEqual(parseListTasksParameters({ skill: "list_tasks" }), {
    status: "pending",
    limit: 20,
  });
});

test("accepts supported task status and limit options", () => {
  assert.deepEqual(parseListTasksParameters({
    skill: "list_tasks",
    status: "completed",
    limit: 100,
  }), {
    status: "completed",
    limit: 100,
  });
  assert.deepEqual(parseListTasksParameters({
    skill: "list_tasks",
    status: "all",
    limit: 1,
  }), {
    status: "all",
    limit: 1,
  });
});

test("rejects invalid status, limit, skill, and extra fields", () => {
  assert.throws(() => parseListTasksParameters({ skill: "list_tasks", status: "archived" }), /Status must be/);
  assert.throws(() => parseListTasksParameters({ skill: "list_tasks", limit: 0 }), /Limit must be/);
  assert.throws(() => parseListTasksParameters({ skill: "list_tasks", limit: 1.5 }), /Limit must be/);
  assert.throws(() => parseListTasksParameters({ skill: "list_tasks", limit: 101 }), /Limit must be/);
  assert.throws(() => parseListTasksParameters({ skill: "unknown" }), /Choose the list_tasks/);
  assert.throws(() => parseListTasksParameters({ skill: "list_tasks", code: "return process.env" }), /unsupported field/);
});

test("only exposes server-registered executable handlers", () => {
  assert.equal(typeof getSkillHandler("listTasks"), "function");
  assert.equal(getSkillHandler("process.env"), undefined);
  assert.equal(getSkillHandler("require"), undefined);
});

test("filters tasks by completion, applies limits, and projects only safe fields", () => {
  const tasks = [
    task({ id: "pending-1" }),
    task({ id: "done-1", completed: true, status: "Done" }),
    task({ id: "pending-2", completed: false }),
  ];

  const pending = filterAndProjectTasks(tasks, { status: "pending", limit: 1 });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, "pending-1");
  assert.deepEqual(Object.keys(pending[0]), [
    "id", "title", "status", "priority", "type", "area", "course", "dueDate", "nextAction", "completed",
  ]);
  assert.equal("url" in pending[0], false);
  assert.equal("notes" in pending[0], false);
  assert.equal("peopleInstructorIds" in pending[0], false);
  assert.deepEqual(filterAndProjectTasks(tasks, { status: "completed", limit: 20 }).map(({ id }) => id), ["done-1"]);
  assert.deepEqual(filterAndProjectTasks(tasks, { status: "all", limit: 20 }).map(({ id }) => id), [
    "pending-1", "done-1", "pending-2",
  ]);
});
