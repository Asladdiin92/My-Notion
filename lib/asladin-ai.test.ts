import assert from "node:assert/strict";
import test from "node:test";
import {
  ASLADIN_AI_SYSTEM_INSTRUCTION,
  orchestrateAsladinAI,
  type ApprovedListTasksSkill,
} from "./asladin-ai";
import type { ListTasksParameters, SafeTask } from "./ai-skill-handlers";
import type { GeminiContentResponse } from "./gemini";

const approvedSkill: ApprovedListTasksSkill = {
  name: "list_tasks",
  enabled: true,
  approvedForAI: true,
  operationType: "read",
  approvalRequired: false,
  handler: "listTasks",
  allowedRoles: ["user"],
};

const safeTask: SafeTask = {
  id: "task-1",
  title: "Read chapter",
  status: "Planned",
  priority: "High",
  type: "Study",
  area: "University",
  course: "Biology",
  dueDate: "2026-10-08",
  nextAction: "Open notes",
  completed: false,
};

function dependencies(responses: GeminiContentResponse[]) {
  const requestBodies: Array<Record<string, unknown>> = [];
  let skillReads = 0;
  let executions = 0;
  let executedParameters: ListTasksParameters | undefined;
  return {
    requestBodies,
    get skillReads() { return skillReads; },
    get executions() { return executions; },
    get executedParameters() { return executedParameters; },
    deps: {
      generateContent: async (body: string) => {
        requestBodies.push(JSON.parse(body) as Record<string, unknown>);
        const response = responses.shift();
        if (!response) throw new Error("Unexpected Gemini call.");
        return response;
      },
      getApprovedSkill: async () => {
        skillReads += 1;
        return approvedSkill;
      },
      getHandlerName: (name: string) => name === "listTasks" ? name : undefined,
      executeHandler: async (handler: string, parameters: ListTasksParameters) => {
        executions += 1;
        assert.equal(handler, "listTasks");
        executedParameters = parameters;
        return [safeTask];
      },
      now: () => new Date("2026-10-06T00:00:00.000Z"),
    },
  };
}

test("returns validated normal Gemini text without a tool", async () => {
  const harness = dependencies([{
    candidates: [{ content: { parts: [{ text: "  Hello\r\nthere.  " }] } }],
  }]);
  const result = await orchestrateAsladinAI("Say hello", harness.deps);

  assert.deepEqual(result, { status: "success", answer: "Hello\nthere.", toolUsed: null });
  assert.equal(harness.executions, 0);
  const request = harness.requestBodies[0];
  assert.equal((request.systemInstruction as { parts: Array<{ text: string }> }).parts[0].text, ASLADIN_AI_SYSTEM_INSTRUCTION);
  assert.equal((request.tools as Array<{ functionDeclarations: Array<{ name: string }> }>)[0].functionDeclarations[0].name, "list_tasks");
});

test("sends only the stored summary and recent conversation messages as context", async () => {
  const harness = dependencies([{ candidates: [{ content: { parts: [{ text: "Continuing." }] } }] }]);
  const context = {
    summary: "Earlier discussion summary",
    messages: Array.from({ length: 20 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `Message ${index}`,
      createdAt: new Date(`2026-10-06T00:00:${String(index).padStart(2, "0")}.000Z`),
    })),
  };
  await orchestrateAsladinAI("Current question", harness.deps, context);

  const contents = harness.requestBodies[0].contents as Array<{
    role: string;
    parts: Array<{ text: string }>;
  }>;
  assert.equal(contents.length, 14);
  assert.match(contents[0].parts[0].text, /Earlier discussion summary/);
  assert.equal(contents[1].parts[0].text, "Message 8");
  assert.equal(contents.at(-2)?.parts[0].text, "Message 19");
  assert.equal(contents.at(-1)?.parts[0].text, "Current question");
});

test("executes only approved list_tasks and continues with a safe function result", async () => {
  const harness = dependencies([
    {
      candidates: [{
        content: {
          role: "model",
          parts: [{ functionCall: { name: "list_tasks", args: { status: "pending", limit: 3 } } }],
        },
      }],
    },
    { candidates: [{ content: { parts: [{ text: "You have one pending task." }] } }] },
  ]);
  const result = await orchestrateAsladinAI("What should I work on?", harness.deps);

  assert.equal(result.answer, "You have one pending task.");
  assert.equal(result.toolUsed, "list_tasks");
  assert.deepEqual(result.toolResult, {
    status: "success",
    count: 1,
    tasks: [safeTask],
    generatedAt: "2026-10-06T00:00:00.000Z",
  });
  assert.equal(harness.executions, 1);
  assert.equal(harness.skillReads, 2);
  assert.deepEqual(harness.executedParameters, { status: "pending", limit: 3 });
  const followUp = harness.requestBodies[1];
  assert.equal("tools" in followUp, false);
  const contents = followUp.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>;
  const functionResult = contents[2].parts[0].functionResponse as { response: Record<string, unknown> };
  assert.deepEqual(functionResult.response, result.toolResult);
  assert.equal(JSON.stringify(functionResult).includes("userId"), false);
});

test("rejects unapproved skills, unknown tools, and userId tool arguments", async () => {
  const unapproved = dependencies([{ candidates: [{ content: { parts: [{ text: "No tool." }] } }] }]);
  await assert.rejects(orchestrateAsladinAI("Hello", {
    ...unapproved.deps,
    getApprovedSkill: async () => ({ ...approvedSkill, approvedForAI: false }),
  }), /not approved/);
  assert.equal(unapproved.requestBodies.length, 0);

  const unknownTool = dependencies([{
    candidates: [{ content: { parts: [{ functionCall: { name: "execute_shell", args: {} } }] } }],
  }]);
  await assert.rejects(orchestrateAsladinAI("Run a command", unknownTool.deps), /unsupported tool/);
  assert.equal(unknownTool.executions, 0);

  const args = dependencies([{
    candidates: [{
      content: { parts: [{ functionCall: { name: "list_tasks", args: { userId: "other-user" } } }] },
    }],
  }]);
  await assert.rejects(orchestrateAsladinAI("List tasks", args.deps), /does not accept a userId/);
  assert.equal(args.executions, 0);
});

test("rechecks approval before execution and rejects another tool request in the final turn", async () => {
  const revoked = dependencies([{
    candidates: [{
      content: { parts: [{ functionCall: { name: "list_tasks", args: {} } }] },
    }],
  }]);
  let reads = 0;
  await assert.rejects(orchestrateAsladinAI("List my tasks", {
    ...revoked.deps,
    getApprovedSkill: async () => {
      reads += 1;
      return reads === 1 ? approvedSkill : null;
    },
  }), /not approved or enabled/);
  assert.equal(revoked.executions, 0);

  const repeatedCall = dependencies([
    { candidates: [{ content: { parts: [{ functionCall: { name: "list_tasks", args: {} } }] } }] },
    { candidates: [{ content: { parts: [{ functionCall: { name: "list_tasks", args: {} } }] } }] },
  ]);
  await assert.rejects(orchestrateAsladinAI("List my tasks", repeatedCall.deps), /unsupported additional tool/);
  assert.equal(repeatedCall.executions, 1);
});
