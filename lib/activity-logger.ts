import "server-only";

import {
  createActivityIdempotencyKey,
  recordActivity,
  type NewActivity,
} from "@/lib/activities";

export type LogActivityInput = NewActivity & {
  userId: string;
  idempotencyKey?: string;
};

export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    const { userId, idempotencyKey, ...activity } = input;
    const hashedKey = idempotencyKey
      ? createActivityIdempotencyKey(userId, activity.type, idempotencyKey)
      : undefined;
    await recordActivity(userId, activity, hashedKey);
  } catch (error) {
    console.error("Activity logging failed.", {
      type: input.type,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}
