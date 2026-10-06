import "server-only";

import { ObjectId, type Collection } from "mongodb";
import { getAIDatabase } from "@/lib/mongodb";

export type AISkill = {
  _id: ObjectId;
  userId: string;
  scope?: "system";
  name: string;
  displayName?: string;
  category?: string;
  description: string;
  instructions: string;
  enabled: boolean;
  operationType?: "read" | "write";
  approvalRequired?: boolean;
  riskLevel?: "low" | "medium" | "high";
  handler?: string;
  allowedRoles?: string[];
  version?: number;
  createdAt: Date;
  updatedAt: Date;
};

export type NewAISkill = Omit<AISkill, "_id" | "userId" | "enabled" | "createdAt" | "updatedAt">;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function validateNewAISkill(input: unknown): NewAISkill {
  if (!isPlainObject(input) ||
      Object.keys(input).some((key) => !["name", "description", "instructions"].includes(key))) {
    throw new Error("Send a skill name, description, and instructions.");
  }
  const { name, description, instructions } = input;
  if (typeof name !== "string" || !name.trim() || name.length > 80) {
    throw new Error("Skill name must contain 1–80 characters.");
  }
  if (typeof description !== "string" || !description.trim() || description.length > 300) {
    throw new Error("Skill description must contain 1–300 characters.");
  }
  if (typeof instructions !== "string" || !instructions.trim() || instructions.length > 4000) {
    throw new Error("Skill instructions must contain 1–4,000 characters.");
  }
  return {
    name: name.trim(),
    description: description.trim(),
    instructions: instructions.trim(),
  };
}

let collectionPromise: Promise<Collection<AISkill>> | undefined;

async function skillsCollection(): Promise<Collection<AISkill>> {
  if (!collectionPromise) {
    collectionPromise = getAIDatabase()
      .then((db) => db.collection<AISkill>("ai_skills"))
      .catch((error: unknown) => {
        collectionPromise = undefined;
        if (error instanceof Error && error.message.startsWith("MongoDB")) throw error;
        throw new Error("AI skill storage could not be initialized.");
      });
  }
  return collectionPromise;
}

export async function listAISkills(userId: string): Promise<AISkill[]> {
  const collection = await skillsCollection();
  return collection.find({ userId: { $in: [userId, "system"] } }).sort({ updatedAt: -1 }).limit(100).toArray();
}

export async function getSystemAISkill(name: string): Promise<AISkill | null> {
  const collection = await skillsCollection();
  return collection.findOne({ userId: "system", scope: "system", name });
}

export async function createAISkill(userId: string, skill: NewAISkill): Promise<AISkill> {
  const now = new Date();
  const record: AISkill = {
    _id: new ObjectId(),
    userId,
    ...skill,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
  const collection = await skillsCollection();
  await collection.insertOne(record);
  return record;
}

export function serializeAISkill(skill: AISkill) {
  return {
    id: skill._id.toHexString(),
    name: skill.name,
    ...(skill.displayName !== undefined ? { displayName: skill.displayName } : {}),
    ...(skill.category !== undefined ? { category: skill.category } : {}),
    description: skill.description,
    instructions: skill.instructions,
    enabled: skill.enabled,
    ...(skill.operationType !== undefined ? { operationType: skill.operationType } : {}),
    ...(skill.approvalRequired !== undefined ? { approvalRequired: skill.approvalRequired } : {}),
    ...(skill.riskLevel !== undefined ? { riskLevel: skill.riskLevel } : {}),
    ...(skill.handler !== undefined ? { handler: skill.handler } : {}),
    ...(skill.allowedRoles !== undefined ? { allowedRoles: skill.allowedRoles } : {}),
    ...(skill.version !== undefined ? { version: skill.version } : {}),
    createdAt: skill.createdAt.toISOString(),
    updatedAt: skill.updatedAt.toISOString(),
  };
}
