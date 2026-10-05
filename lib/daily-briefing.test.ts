import assert from "node:assert/strict";
import test from "node:test";
import { createDailyBriefing, type BriefingAIInput } from "./daily-briefing";
import type { Task } from "./types";

const NOW = new Date("2026-10-05T09:00:00.000Z");

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    url: "https://notion.so/task-1",
    title: "Review network analysis",
    status: "Planned",
    priority: "High",
    type: "Deliverable",
    area: "University",
    course: "Networking",
    estimatedHours: 0.75,
    nextAction: "Open the lecture",
    dueDate: "2026-10-05",
    createdAt: "2026-10-01T12:00:00.000Z",
    completed: false,
    ...overrides,
  };
}

test("falls back deterministically when the AI provider fails", async () => {
  const tasks = [
    task({ id: "later", title: "Later task", dueDate: "2026-10-08", priority: "Critical" }),
    task({ id: "due", title: "Due today task", dueDate: "2026-10-05", priority: "Low" }),
  ];
  const briefing = await createDailyBriefing(
    { tasks, now: NOW, timeZone: "Africa/Addis_Ababa" },
    async () => { throw new Error("provider timeout"); },
  );

  assert.equal(briefing.source, "fallback");
  assert.equal(briefing.recommendedAction?.entityId, "due");
  assert.equal(briefing.recommendedAction?.title, "Due today task");
  assert.equal(briefing.recommendedAction?.estimatedMinutes, 45);
  assert.ok(briefing.warnings.some((warning) => warning.includes("deterministic")));
});

test("uses deterministic fallback when the AI response is invalid JSON", async () => {
  const briefing = await createDailyBriefing(
    { tasks: [task()], now: NOW, timeZone: "Africa/Addis_Ababa" },
    async () => "not JSON",
  );

  assert.equal(briefing.source, "fallback");
  assert.equal(briefing.recommendedAction?.entityId, "task-1");
});

test("returns an empty fallback without inventing a task", async () => {
  let providerCalled = false;
  const briefing = await createDailyBriefing(
    { tasks: [], now: NOW, timeZone: "Africa/Addis_Ababa" },
    async () => {
      providerCalled = true;
      return JSON.stringify({ recommendedTaskId: "invented", reason: "Invented task." });
    },
  );

  assert.equal(providerCalled, false);
  assert.equal(briefing.source, "fallback");
  assert.equal(briefing.recommendedAction, null);
  assert.deepEqual(briefing.summary, {
    tasksToday: 0,
    overdueTasks: 0,
    upcomingItems: 0,
    activeProjects: 0,
  });
});

test("accepts an AI selection only when it references a real incomplete planner task", async () => {
  const tasks = [
    task({ id: "overdue", title: "Overdue task", dueDate: "2026-10-03" }),
    task({ id: "completed", title: "Finished task", completed: true }),
  ];
  let received: BriefingAIInput | undefined;
  const briefing = await createDailyBriefing(
    {
      tasks,
      now: NOW,
      timeZone: "Africa/Addis_Ababa",
      recentActivityTypes: ["task_created"],
      focusMinutesToday: 35,
    },
    async (input) => {
      received = input;
      return JSON.stringify({
        recommendedTaskId: "overdue",
        reason: "It is overdue and remains unfinished.",
      });
    },
  );

  assert.equal(briefing.source, "ai");
  assert.equal(briefing.recommendedAction?.entityId, "overdue");
  assert.equal(briefing.summary.focusMinutesToday, 35);
  assert.deepEqual(received?.recentActivityTypes, ["task_created"]);
  assert.deepEqual(Object.keys(received?.overdueTasks[0] ?? {}).sort(), ["area", "dueDate", "id", "priority", "title"]);
});

test("rejects AI task identifiers that do not exist and does not expose AI-provided titles", async () => {
  const briefing = await createDailyBriefing(
    { tasks: [task()], now: NOW, timeZone: "Africa/Addis_Ababa" },
    async () => JSON.stringify({ recommendedTaskId: "other-user-task", reason: "A valid looking reason." }),
  );

  assert.equal(briefing.source, "fallback");
  assert.equal(briefing.recommendedAction?.entityId, "task-1");
  assert.equal(briefing.recommendedAction?.title, "Review network analysis");
});
