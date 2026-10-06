import "server-only";

import { ObjectId, type Collection } from "mongodb";
import { getAIDatabase } from "@/lib/mongodb";

export type AIConversationInput = {
  message: string;
  answer: string;
  toolUsed: "list_tasks" | null;
};

export type AIConversationTurn = {
  _id: ObjectId;
  userId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  toolUsed: "list_tasks" | null;
  createdAt: Date;
};

export function validateAIConversation(
  userId: string,
  input: AIConversationInput,
): Omit<AIConversationTurn, "_id"> {
  if (!userId.trim() || userId.length > 256) {
    throw new Error("A valid authenticated user is required to store a conversation.");
  }
  if (!input.message.trim() || input.message.length > 2000 ||
      !input.answer.trim() || input.answer.length > 8000 ||
      (input.toolUsed !== null && input.toolUsed !== "list_tasks")) {
    throw new Error("The AI conversation is invalid.");
  }
  return {
    userId,
    messages: [
      { role: "user", content: input.message },
      { role: "assistant", content: input.answer },
    ],
    toolUsed: input.toolUsed,
    createdAt: new Date(),
  };
}

let conversationCollectionPromise: Promise<Collection<AIConversationTurn>> | undefined;

async function conversationCollection(): Promise<Collection<AIConversationTurn>> {
  if (!conversationCollectionPromise) {
    conversationCollectionPromise = getAIDatabase().then(async (db) => {
      const collection = db.collection<AIConversationTurn>("ai_conversations");
      await collection.createIndex({ userId: 1, createdAt: -1 });
      return collection;
    }).catch((error: unknown) => {
      conversationCollectionPromise = undefined;
      if (error instanceof Error && error.message.startsWith("MongoDB")) throw error;
      throw new Error("AI conversation storage could not be initialized.");
    });
  }
  return conversationCollectionPromise;
}

export async function recordAIConversation(
  userId: string,
  input: AIConversationInput,
): Promise<string> {
  const record = validateAIConversation(userId, input);
  const collection = await conversationCollection();
  const result = await collection.insertOne({ ...record, _id: new ObjectId() });
  return result.insertedId.toHexString();
}
