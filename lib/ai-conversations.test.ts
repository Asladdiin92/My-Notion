import assert from "node:assert/strict";
import test from "node:test";
import {
  createAIConversationService,
  MAX_CONVERSATION_DOCUMENT_BYTES,
  MAX_CONVERSATION_MESSAGES,
  redactConversationContent,
  type AIConversation,
  type ConversationChanges,
  type ConversationRepository,
} from "./ai-conversations";

class MemoryConversationRepository implements ConversationRepository {
  readonly documents = new Map<string, AIConversation>();

  async create(conversation: AIConversation): Promise<void> {
    if ([...this.documents.values()].some((item) => item.conversationId === conversation.conversationId)) {
      throw new Error("Duplicate conversation ID.");
    }
    this.documents.set(conversation.conversationId, structuredClone(conversation));
  }

  async get(userId: string, conversationId: string): Promise<AIConversation | null> {
    const item = this.documents.get(conversationId);
    return item?.userId === userId ? structuredClone(item) : null;
  }

  async list(userId: string, includeArchived: boolean, limit: number): Promise<AIConversation[]> {
    return [...this.documents.values()]
      .filter((item) => item.userId === userId && (includeArchived || !item.archivedAt))
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .slice(0, limit)
      .map((item) => structuredClone(item));
  }

  async update(
    userId: string,
    conversationId: string,
    expectedUpdatedAt: Date,
    changes: ConversationChanges,
  ): Promise<boolean> {
    const item = this.documents.get(conversationId);
    if (!item || item.userId !== userId || item.archivedAt ||
        item.updatedAt.getTime() !== expectedUpdatedAt.getTime()) return false;
    this.documents.set(conversationId, { ...item, ...structuredClone(changes) });
    return true;
  }

  async archive(userId: string, conversationId: string, archivedAt: Date): Promise<boolean> {
    const item = this.documents.get(conversationId);
    if (!item || item.userId !== userId || item.archivedAt) return false;
    this.documents.set(conversationId, { ...item, archivedAt, updatedAt: archivedAt });
    return true;
  }

  async delete(userId: string, conversationId: string): Promise<boolean> {
    const item = this.documents.get(conversationId);
    if (!item || item.userId !== userId) return false;
    return this.documents.delete(conversationId);
  }
}

const FIRST_ID = "a0f4d5e6-1111-4111-8111-111111111111";
const SECOND_ID = "b0f4d5e6-2222-4222-8222-222222222222";

test("creates one chronological, user-owned session with bounded transcript fields", async () => {
  const repository = new MemoryConversationRepository();
  const service = createAIConversationService(repository);
  const conversation = await service.create("user-1", FIRST_ID, {
    userMessage: "List tasks",
    assistantMessage: "Here are your tasks.",
    toolName: "list_tasks",
    toolCallId: "call-1",
    createdAt: new Date("2026-10-06T00:00:00.000Z"),
  });

  assert.equal(repository.documents.size, 1);
  assert.equal(conversation.userId, "user-1");
  assert.equal(conversation.title, "List tasks");
  assert.equal(conversation.summary, "Started with: List tasks");
  assert.equal(conversation.messages.length, 2);
  assert.deepEqual(conversation.messages.map((item) => item.role), ["user", "assistant"]);
  assert.ok(conversation.messages[0].createdAt < conversation.messages[1].createdAt);
  assert.equal(conversation.messages[1].toolName, "list_tasks");
  assert.equal(conversation.messages[1].toolCallId, "call-1");
  assert.equal(conversation.messages[1].status, "completed");
  assert.equal(conversation.createdAt.toISOString(), "2026-10-06T00:00:00.000Z");
  assert.equal(conversation.updatedAt.toISOString(), "2026-10-06T00:00:00.001Z");
  assert.equal(conversation.lastMessageAt, conversation.updatedAt);
});

test("retrieval, listing, archive, and deletion are isolated by authenticated owner", async () => {
  const repository = new MemoryConversationRepository();
  const service = createAIConversationService(repository);
  await service.create("user-1", FIRST_ID, {
    userMessage: "First user's question",
    assistantMessage: "First answer",
  });
  await service.create("user-2", SECOND_ID, {
    userMessage: "Second user's question",
    assistantMessage: "Second answer",
  });

  assert.equal((await service.get("user-2", FIRST_ID)), null);
  assert.deepEqual((await service.list("user-1")).map((item) => item.conversationId), [FIRST_ID]);
  assert.equal(await service.delete("user-2", FIRST_ID), false);
  assert.equal(await service.archive("user-2", FIRST_ID), false);
  assert.equal(await service.archive("user-1", FIRST_ID), true);
  assert.equal(await service.get("user-1", FIRST_ID) !== null, true);
  assert.equal((await service.list("user-1")).length, 0);
  assert.equal((await service.list("user-1", true)).length, 1);
  assert.equal(await service.delete("user-1", FIRST_ID), true);
  assert.equal(await service.get("user-1", FIRST_ID), null);
  assert.equal(repository.documents.size, 1);
});

test("rejects browser ownership fields, invalid IDs, unsupported metadata, and invalid limits", async () => {
  const service = createAIConversationService(new MemoryConversationRepository());
  await assert.rejects(service.create("user-1", FIRST_ID, {
    userId: "user-2",
    userMessage: "Question",
    assistantMessage: "Answer",
  }), /unsupported fields/);
  await assert.rejects(service.create("user-1", "not-a-conversation-id", {
    userMessage: "Question",
    assistantMessage: "Answer",
  }), /valid conversation ID/);
  await assert.rejects(service.create("user-1", FIRST_ID, {
    userMessage: "Question",
    assistantMessage: "Answer",
    toolName: "execute_shell",
  }), /tool is unsupported/);
  await assert.rejects(service.list("user-1", false, 101), /integer from 1 to 100/);
});

test("redacts secrets and bounds message and conversation sizes", async () => {
  const redacted = redactConversationContent(
    "Authorization: Bearer abc.def and API_KEY=sk-abcdefghijklmnopqrstuvwxyz " +
    "token=raw-session-token -----BEGIN PRIVATE KEY-----private-----END PRIVATE KEY-----",
  );
  assert.equal(redacted.includes("abc.def"), false);
  assert.equal(redacted.includes("sk-abcdefghijklmnopqrstuvwxyz"), false);
  assert.equal(redacted.includes("raw-session-token"), false);
  assert.equal(redacted.includes("-----BEGIN PRIVATE KEY-----"), false);

  const repository = new MemoryConversationRepository();
  const service = createAIConversationService(repository);
  await assert.rejects(service.create("user-1", FIRST_ID, {
    userMessage: "x".repeat(2001),
    assistantMessage: "Answer",
  }), /User message must contain/);
  await assert.rejects(service.create("user-1", FIRST_ID, {
    userMessage: "Question",
    assistantMessage: "x".repeat(8_001),
  }), /Assistant message must contain/);

  await service.create("user-1", FIRST_ID, {
    userMessage: "Question",
    assistantMessage: "Answer",
  });
  const largeTurn = {
    userMessage: "Next question",
    assistantMessage: "x".repeat(8_000),
    createdAt: new Date("2026-10-06T00:00:01.000Z"),
  };
  let conversation = repository.documents.get(FIRST_ID)!;
  for (let index = 0; index < MAX_CONVERSATION_MESSAGES; index += 1) {
    conversation = (await service.append("user-1", FIRST_ID, largeTurn))!;
  }
  assert.ok(conversation.messages.length < MAX_CONVERSATION_MESSAGES);
  assert.ok(Buffer.byteLength(JSON.stringify(conversation), "utf8") <= MAX_CONVERSATION_DOCUMENT_BYTES);
});

test("keeps chronological recent messages and rolls older turns into a bounded summary", async () => {
  const service = createAIConversationService(new MemoryConversationRepository());
  let conversation = await service.create("user-1", FIRST_ID, {
    userMessage: "Question 0",
    assistantMessage: "Answer 0",
    createdAt: new Date("2026-10-06T00:00:00.000Z"),
  });
  for (let index = 1; index < 14; index += 1) {
    conversation = (await service.append("user-1", FIRST_ID, {
      userMessage: `Question ${index}`,
      assistantMessage: `Answer ${index}`,
      createdAt: new Date(`2026-10-06T00:00:${String(index).padStart(2, "0")}.000Z`),
    }))!;
  }

  assert.equal(conversation.messages.length, MAX_CONVERSATION_MESSAGES);
  assert.ok(conversation.summary.includes("Question 0"));
  assert.ok(conversation.summary.length <= 4_000);
  assert.ok(conversation.messages.every((item, index, messages) =>
    index === 0 || messages[index - 1].createdAt <= item.createdAt));
  const context = await service.context("user-1", FIRST_ID);
  assert.equal(context?.messages.length, 12);
  assert.ok(context?.summary.includes("Question 0"));
  assert.equal(context?.messages.at(-1)?.content, "Answer 13");
});
