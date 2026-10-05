import assert from "node:assert/strict";
import test from "node:test";
import {
  explainScoredTask,
  isRecommendationCurrent,
  rankTasks,
  scoreTask,
} from "./task-scoring";
import type { Task } from "./types";

const NOW = new Date("2026-10-05T09:00:00.000Z");

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    url: "https://www.notion.so/task-1",
    title: "Review network analysis",
    status: "Not started",
    priority: "Medium",
    type: "Task",
    area: "University",
    course: "",
    nextAction: "",
    dueDate: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    completed: false,
    ...overrides,
  };
}

test("scores overdue high-priority work from recorded factors", () => {
  const scored = scoreTask(task({
    status: "In progress",
    priority: "High",
    dueDate: "2026-10-03",
    createdAt: "2026-09-01T00:00:00.000Z",
    estimatedHours: 0.5,
  }), NOW);
  assert.equal(scored.score, 88);
  assert.equal(scored.label, "Critical");
  assert.deepEqual(scored.factors.map(({ key, points }) => [key, points]), [
    ["deadline", 40],
    ["priority", 19],
    ["status", 15],
    ["age", 4],
    ["effort", 10],
  ]);
});

test("scores a task due today and explains the real deadline", () => {
  const scored = scoreTask(task({ dueDate: "2026-10-05", createdAt: "2026-10-05T00:00:00.000Z" }), NOW);
  assert.equal(scored.factors[0].points, 36);
  assert.equal(scored.factors[0].evidence, "Due today");
});

test("handles tasks without deadline or estimated effort without fabricating either", () => {
  const scored = scoreTask(task({ dueDate: null, estimatedHours: undefined }), NOW);
  assert.equal(scored.factors[0].points, 0);
  assert.equal(scored.factors[0].evidence, "No deadline recorded");
  assert.equal(scored.factors[4].points, 0);
  assert.match(scored.factors[4].evidence, /No valid effort estimate/);
});

test("excludes completed, cancelled, and archived tasks", () => {
  const ranked = rankTasks([
    task({ id: "done", completed: true, priority: "Critical" }),
    task({ id: "cancelled", status: "Cancelled", priority: "Critical" }),
    task({ id: "archived", status: "Archived", priority: "Critical" }),
  ], new Set(), NOW);
  assert.deepEqual(ranked, []);
});

test("returns no recommendation for an empty task list", () => {
  assert.deepEqual(rankTasks([], new Set(), NOW), []);
});

test("orders equal scores deterministically by task ID", () => {
  const ranked = rankTasks([
    task({ id: "z-task" }),
    task({ id: "a-task" }),
  ], new Set(), NOW);
  assert.equal(ranked[0].score, ranked[1].score);
  assert.deepEqual(ranked.map(({ task: item }) => item.id), ["a-task", "z-task"]);
});

test("uses a deterministic explanation if AI explanation generation fails", async () => {
  const scored = scoreTask(task({ dueDate: "2026-10-03" }), NOW);
  const result = await explainScoredTask(scored, async () => {
    throw new Error("provider unavailable");
  });
  assert.equal(result.source, "fallback");
  assert.match(result.explanation.reason, /overdue/);
});

test("keeps dismissed task IDs out of ranking", () => {
  const ranked = rankTasks([
    task({ id: "dismissed", priority: "Critical" }),
    task({ id: "available", priority: "Low" }),
  ], new Set(["dismissed"]), NOW);
  assert.deepEqual(ranked.map(({ task: item }) => item.id), ["available"]);
});

test("invalidates a recommendation when its task is completed or significantly changed", () => {
  const original = task({ dueDate: "2026-10-05" });
  const saved = {
    taskId: original.id,
    taskFingerprint: JSON.stringify({
      title: original.title,
      status: original.status,
      completed: original.completed,
      priority: original.priority,
      area: original.area,
      dueDate: original.dueDate,
      dateEnd: original.dateEnd ?? null,
      estimatedHours: original.estimatedHours ?? null,
      createdAt: original.createdAt,
      nextAction: original.nextAction,
    }),
  };
  assert.equal(isRecommendationCurrent(saved, [original]), true);
  assert.equal(isRecommendationCurrent(saved, [{ ...original, completed: true }]), false);
  assert.equal(isRecommendationCurrent(saved, [{ ...original, priority: "Critical" }]), false);
});
