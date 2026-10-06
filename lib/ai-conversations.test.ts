import assert from "node:assert/strict";
import test from "node:test";
import { validateAIConversation } from "./ai-conversations";

test("stores a user-scoped user and assistant exchange without tool data", () => {
  const record = validateAIConversation("user-1", {
    message: "List pending tasks",
    answer: "You have two pending tasks.",
    toolUsed: "list_tasks",
  });
  assert.equal(record.userId, "user-1");
  assert.deepEqual(record.messages, [
    { role: "user", content: "List pending tasks" },
    { role: "assistant", content: "You have two pending tasks." },
  ]);
  assert.equal(record.toolUsed, "list_tasks");
  assert.ok(record.createdAt instanceof Date);
  assert.equal("tasks" in record, false);
});

test("rejects invalid conversation owners and oversized transcript content", () => {
  assert.throws(() => validateAIConversation("", {
    message: "Question",
    answer: "Answer",
    toolUsed: null,
  }), /authenticated user/);
  assert.throws(() => validateAIConversation("user-1", {
    message: "x".repeat(2001),
    answer: "Answer",
    toolUsed: null,
  }), /conversation is invalid/);
  assert.throws(() => validateAIConversation("user-1", {
    message: "Question",
    answer: "x".repeat(8001),
    toolUsed: null,
  }), /conversation is invalid/);
});
