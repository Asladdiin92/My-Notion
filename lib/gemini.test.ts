import assert from "node:assert/strict";
import test from "node:test";

process.env.GEMINI_API_KEY ??= "gemini-test-key";

let getPlannerAssistantAnswer: typeof import("./gemini").getPlannerAssistantAnswer;
let getPlannerAssistantPlan: typeof import("./gemini").getPlannerAssistantPlan;
let getPlannerAssistantBreakdown: typeof import("./gemini").getPlannerAssistantBreakdown;
let getPlannerAssistantDayPlan: typeof import("./gemini").getPlannerAssistantDayPlan;
test.before(async () => {
  ({ getPlannerAssistantAnswer, getPlannerAssistantPlan, getPlannerAssistantBreakdown, getPlannerAssistantDayPlan } = await import("./gemini"));
});

const originalFetch = globalThis.fetch;
const task = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  url: "https://www.notion.so/test-task",
  title: "Read biology chapter",
  status: "Planned",
  priority: "Medium",
  type: "Task",
  area: "University",
  course: "Biology",
  nextAction: "",
  dueDate: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  completed: false,
};

function mockGeminiText(text: string) {
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("falls back to Flash-Lite when the primary model is in high demand", async () => {
  const requestedModels: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requestedModels.push(url);
    if (url.includes("gemini-3.8-flash")) {
      return Response.json({ error: { message: "Model is experiencing high demand." } }, { status: 503 });
    }
    return Response.json({ candidates: [{ content: { parts: [{ text: "Start with the overdue task." }] } }] });
  };

  const answer = await getPlannerAssistantAnswer("suggest", undefined, []);

  assert.equal(answer, "Start with the overdue task.");
  assert.equal(requestedModels.length, 2);
  assert.match(requestedModels[0], /gemini-3\.8-flash:generateContent$/);
  assert.match(requestedModels[1], /gemini-3\.5-flash-lite:generateContent$/);
});

test("does not retry with a fallback when Gemini rejects the API key", async () => {
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return Response.json({ error: { message: "API key not valid." } }, { status: 403 });
  };

  await assert.rejects(
    getPlannerAssistantAnswer("ask", "How many tasks?", []),
    /Gemini rejected the API key/,
  );
  assert.equal(requestCount, 1);
});

test("reports temporary high demand when all models are unavailable", async () => {
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return Response.json({ error: { message: "Currently experiencing high demand." } }, { status: 503 });
  };

  await assert.rejects(
    getPlannerAssistantAnswer("suggest", undefined, []),
    /All Gemini models are temporarily experiencing high demand/,
  );
  assert.equal(requestCount, 2);
});

test("tries the fallback model if the primary model times out", async () => {
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) throw Object.assign(new Error("Timed out"), { name: "TimeoutError" });
    return Response.json({ candidates: [{ content: { parts: [{ text: "I can help with that." }] } }] });
  };

  const answer = await getPlannerAssistantAnswer("ask", "How can you help?", []);

  assert.equal(answer, "I can help with that.");
  assert.equal(requestCount, 2);
});

test("tries the fallback model if the primary model is rate-limited", async () => {
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return Response.json({ error: { message: "Rate limited." } }, { status: 429 });
    }
    return Response.json({ candidates: [{ content: { parts: [{ text: "Start with your next task." }] } }] });
  };

  const answer = await getPlannerAssistantAnswer("suggest", undefined, []);

  assert.equal(answer, "Start with your next task.");
  assert.equal(requestCount, 2);
});

test("returns a proposed task creation without mutating the planner", async () => {
  mockGeminiText(JSON.stringify({
    action: "create",
    summary: "Add a biology review task for tomorrow.",
    fields: { title: "Review biology", dueDate: "2026-10-02" },
  }));

  const plan = await getPlannerAssistantPlan("Add a biology review task for tomorrow.", [task]);

  assert.deepEqual(plan, {
    action: "create",
    summary: "Add a biology review task for tomorrow.",
    fields: { title: "Review biology", dueDate: "2026-10-02" },
  });
});

test("returns a proposed update only for a matching planner task", async () => {
  mockGeminiText(JSON.stringify({
    action: "update",
    summary: "Move the biology task deadline.",
    taskId: task.id,
    fields: { dueDate: "2026-10-03" },
  }));

  const plan = await getPlannerAssistantPlan("Move my biology task deadline to Saturday.", [task]);

  assert.deepEqual(plan, {
    action: "update",
    summary: "Move the biology task deadline.",
    taskId: task.id,
    fields: { dueDate: "2026-10-03" },
  });
});

test("rejects a proposed select value that is not in the Notion options", async () => {
  mockGeminiText(JSON.stringify({
    action: "create",
    summary: "Add a high-priority task.",
    fields: { title: "Review biology", priority: "Urgent" },
  }));

  await assert.rejects(
    getPlannerAssistantPlan("Create a task with urgent priority.", [], {
      types: ["Task"],
      statuses: ["Planned"],
      priorities: ["High", "Medium", "Low"],
      areas: ["University"],
      courses: ["Biology"],
    }),
    /not an option in your Notion database/,
  );
});

test("asks for clarification instead of proposing an update for an unknown task", async () => {
  mockGeminiText(JSON.stringify({
    action: "update",
    summary: "Update a different task.",
    taskId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    fields: { dueDate: "2026-10-03" },
  }));

  await assert.rejects(
    getPlannerAssistantPlan("Move my task deadline.", [task]),
    /couldn't match that instruction to a task/,
  );
});

test("returns a clarification answer without proposing a change", async () => {
  mockGeminiText(JSON.stringify({
    action: "answer",
    answer: "Which task would you like me to update?",
  }));

  const plan = await getPlannerAssistantPlan("Move the deadline.", [task]);

  assert.deepEqual(plan, { action: "answer", answer: "Which task would you like me to update?" });
});

test("breaks down a selected task into confirmable short steps", async () => {
  mockGeminiText(JSON.stringify({
    action: "breakdown",
    taskId: task.id,
    summary: "Start with one small step.",
    steps: [
      { title: "Open the lecture notes", minutes: 10, nextAction: "Find the biology folder and open lecture 3." },
      { title: "List key terms", minutes: 15, nextAction: "Write down five terms from the first page." },
      { title: "Review the diagrams", minutes: 20, nextAction: "Label the first diagram from memory." },
    ],
  }));

  const plan = await getPlannerAssistantBreakdown([task], task.id);

  assert.equal(plan.action, "breakdown");
  assert.equal(plan.taskId, task.id);
  assert.equal(plan.steps.length, 3);
  assert.equal(plan.steps[1].minutes, 15);
});

test("builds a time-blocked day without overlapping prayer anchors", async () => {
  mockGeminiText(JSON.stringify({
    action: "day_plan",
    summary: "Focus on one urgent study session.",
    blocks: [
      { title: "Review biology", area: "University", startTime: "09:00", endTime: "10:00", nextAction: "Open the lecture notes.", taskId: task.id },
    ],
  }));
  const prayerTimes = { Fajr: "04:48", Dhuhr: "12:01", Asr: "15:19", Maghrib: "18:02", Isha: "19:32" };

  const plan = await getPlannerAssistantDayPlan([task], "2026-10-01", "Africa/Addis_Ababa", prayerTimes);

  assert.equal(plan.action, "day_plan");
  assert.equal(plan.blocks[0].taskId, task.id);
  assert.deepEqual(plan.prayerTimes, prayerTimes);
});

test("rejects overlapping or prayer-conflicting day-plan blocks", async () => {
  mockGeminiText(JSON.stringify({
    action: "day_plan",
    summary: "Overlapping plan.",
    blocks: [
      { title: "Study", area: "University", startTime: "11:30", endTime: "12:30", nextAction: "Open notes." },
      { title: "Code", area: "Coding Lab", startTime: "12:15", endTime: "13:00", nextAction: "Open editor." },
    ],
  }));
  const prayerTimes = { Fajr: "04:48", Dhuhr: "12:01", Asr: "15:19", Maghrib: "18:02", Isha: "19:32" };

  await assert.rejects(
    getPlannerAssistantDayPlan([], "2026-10-01", "Africa/Addis_Ababa", prayerTimes),
    /overlapping|prayer time/,
  );
});
