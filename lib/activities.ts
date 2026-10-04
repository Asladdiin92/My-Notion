import "server-only";

import { ObjectId, type Collection } from "mongodb";
import { getMongoDb } from "@/lib/mongodb";

export const ACTIVITY_TYPES = [
  "task_created",
  "task_updated",
  "task_completed",
  "project_updated",
  "note_created",
  "note_updated",
  "focus_started",
  "focus_completed",
  "ai_plan_generated",
  "ai_recommendation_generated",
  "notion_sync_completed",
] as const;

export const ACTIVITY_SOURCES = ["notion", "dashboard", "ai", "focus", "system"] as const;

export type ActivityType = typeof ACTIVITY_TYPES[number];
export type ActivitySource = typeof ACTIVITY_SOURCES[number];
export type Activity = {
  _id: ObjectId;
  userId: string;
  type: ActivityType;
  source: ActivitySource;
  title: string;
  description?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
};
type ActivityDocument = Omit<Activity, "_id"> & { _id?: ObjectId };

const COLLECTION_NAME = "activities";
const MAX_METADATA_BYTES = 4096;
const MAX_METADATA_DEPTH = 5;
const SENSITIVE_KEY = /(?:secret|password|passwd|token|authorization|cookie|credential|api.?key|private.?key|email|phone|address|access.?key)/i;
const SENSITIVE_VALUE = [
  /\bBearer\s+\S+/i,
  /\bmongodb(?:\+srv)?:\/\/[^/\s:@]+:[^/\s@]+@/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:sk|pk|ghp|github_pat|AIza)[-_][A-Za-z0-9_-]{12,}\b/i,
];

export type NewActivity = {
  type: ActivityType;
  source: ActivitySource;
  title: string;
  description?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateMetadataValue(value: unknown, depth: number): void {
  if (depth > MAX_METADATA_DEPTH) throw new Error("Activity metadata is nested too deeply.");
  if (typeof value === "string") {
    if (value.length > 1000 || SENSITIVE_VALUE.some((pattern) => pattern.test(value))) {
      throw new Error("Activity metadata must not contain sensitive values.");
    }
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Activity metadata numbers must be finite.");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 50) throw new Error("Activity metadata contains too many values.");
    value.forEach((item) => validateMetadataValue(item, depth + 1));
    return;
  }
  if (!isPlainObject(value)) throw new Error("Activity metadata must contain only JSON values.");
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) throw new Error("Activity metadata must not contain sensitive fields.");
    validateMetadataValue(nested, depth + 1);
  }
}

function optionalText(input: Record<string, unknown>, field: string, maximum: number): string | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maximum) {
    throw new Error(`Activity ${field} must be ${maximum} characters or fewer.`);
  }
  return value;
}

export function validateActivityInput(
  authenticatedUserId: string,
  input: unknown,
  now = new Date(),
): Omit<Activity, "_id"> {
  if (typeof authenticatedUserId !== "string" || !authenticatedUserId.trim() ||
      authenticatedUserId.length > 256 || authenticatedUserId !== authenticatedUserId.trim()) {
    throw new Error("A stable authenticated user ID is required to record an activity.");
  }
  if (!isPlainObject(input)) throw new Error("Activity input must be an object.");
  const allowedFields = new Set([
    "type", "source", "title", "description", "entityType", "entityId", "metadata",
  ]);
  if (Object.keys(input).some((key) => !allowedFields.has(key))) {
    throw new Error("Activity input contains unsupported fields; user ownership is server-controlled.");
  }
  if (!ACTIVITY_TYPES.includes(input.type as ActivityType)) {
    throw new Error("Choose a supported activity type.");
  }
  if (!ACTIVITY_SOURCES.includes(input.source as ActivitySource)) {
    throw new Error("Choose a supported activity source.");
  }
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 200) {
    throw new Error("Activity title must contain 1–200 characters.");
  }
  const description = optionalText(input, "description", 1000);
  const entityType = optionalText(input, "entityType", 80);
  const entityId = optionalText(input, "entityId", 200);
  if (input.metadata !== undefined) {
    if (!isPlainObject(input.metadata)) throw new Error("Activity metadata must be a plain object.");
    validateMetadataValue(input.metadata, 0);
    if (Buffer.byteLength(JSON.stringify(input.metadata), "utf8") > MAX_METADATA_BYTES) {
      throw new Error("Activity metadata must be 4 KB or smaller.");
    }
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Activity timestamp is invalid.");
  }
  const timestamp = new Date(now.getTime());
  return {
    userId: authenticatedUserId,
    type: input.type as ActivityType,
    source: input.source as ActivitySource,
    title: input.title.trim(),
    ...(description !== undefined ? { description } : {}),
    ...(entityType !== undefined ? { entityType } : {}),
    ...(entityId !== undefined ? { entityId } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    occurredAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

let activityCollectionPromise: Promise<Collection<ActivityDocument>> | undefined;

async function activityCollection(): Promise<Collection<ActivityDocument>> {
  if (!activityCollectionPromise) {
    activityCollectionPromise = getMongoDb().then(async (db) => {
      const collection = db.collection<ActivityDocument>(COLLECTION_NAME);
      await Promise.all([
        collection.createIndex({ userId: 1, occurredAt: -1 }),
        collection.createIndex({ userId: 1, type: 1 }),
      ]);
      return collection;
    }).catch((error: unknown) => {
      activityCollectionPromise = undefined;
      if (error instanceof Error && error.message.startsWith("MongoDB")) throw error;
      throw new Error("Activity storage could not be initialized.");
    });
  }
  return activityCollectionPromise;
}

export async function recordActivity(authenticatedUserId: string, input: unknown): Promise<Activity> {
  const activity = validateActivityInput(authenticatedUserId, input);
  const collection = await activityCollection();
  const result = await collection.insertOne(activity);
  return { ...activity, _id: result.insertedId };
}
