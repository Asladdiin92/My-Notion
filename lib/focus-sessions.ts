import "server-only";

import { getMongoDb } from "@/lib/mongodb";
import { calculateFocusMinutesToday, type FocusSessionRecord } from "@/lib/focus-metrics";

type StoredFocusSession = {
  userId: string;
  startedAt: Date;
  endedAt?: Date | null;
  status: "active" | "completed" | string;
};

export async function getFocusMinutesToday(
  userId: string,
  timeZone: string,
  now = new Date(),
): Promise<number> {
  const db = await getMongoDb();
  const previousStart = new Date(now.getTime() - 36 * 60 * 60 * 1000);
  const sessions = await db.collection<StoredFocusSession>("focus_sessions")
    .find({
      userId,
      startedAt: { $gte: previousStart, $lte: now },
      status: { $in: ["active", "completed"] },
    }, {
      projection: { _id: 0, startedAt: 1, endedAt: 1, status: 1 },
    })
    .limit(501)
    .toArray();
  if (sessions.length > 500) throw new Error("Focus session data exceeds the daily summary limit.");

  const records: FocusSessionRecord[] = sessions.map((session) => ({
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    status: session.status,
  }));
  return calculateFocusMinutesToday(records, timeZone, now);
}
