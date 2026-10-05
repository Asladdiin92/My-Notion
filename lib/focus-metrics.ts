export type FocusSessionRecord = {
  startedAt: Date | string;
  endedAt?: Date | string | null;
  status: "active" | "completed" | string;
};

const MAX_COMPLETED_SESSION_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE_SESSION_MS = 12 * 60 * 60 * 1000;

function timestamp(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function localDateTimeToUtc(dateKey: string, hour: number, timeZone: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day, hour);
  let guess = target;
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    const displayed = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
    );
    const difference = target - displayed;
    if (difference === 0) return guess;
    guess += difference;
  }
  return guess;
}

function localDateKey(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function nextDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function calculateFocusMinutesToday(
  sessions: FocusSessionRecord[],
  timeZone: string,
  now = new Date(),
): number {
  const today = localDateKey(now, timeZone);
  const dayStart = localDateTimeToUtc(today, 0, timeZone);
  const dayEnd = localDateTimeToUtc(nextDateKey(today), 0, timeZone);
  const nowMs = now.getTime();
  const intervals: Array<[number, number]> = [];

  for (const session of sessions) {
    const startedAt = timestamp(session.startedAt);
    if (startedAt === null || startedAt > nowMs) continue;

    let endedAt: number;
    if (session.status === "completed") {
      const completion = timestamp(session.endedAt);
      if (completion === null || completion <= startedAt || completion > nowMs ||
          completion - startedAt > MAX_COMPLETED_SESSION_MS) continue;
      endedAt = completion;
    } else if (session.status === "active") {
      if (session.endedAt !== undefined && session.endedAt !== null) continue;
      endedAt = nowMs;
      if (endedAt - startedAt > MAX_ACTIVE_SESSION_MS) continue;
    } else {
      continue;
    }

    const overlapStart = Math.max(startedAt, dayStart);
    const overlapEnd = Math.min(endedAt, dayEnd, nowMs);
    if (overlapEnd > overlapStart) intervals.push([overlapStart, overlapEnd]);
  }

  intervals.sort(([left], [right]) => left - right);
  let totalMilliseconds = 0;
  let current: [number, number] | undefined;
  for (const interval of intervals) {
    if (!current || interval[0] > current[1]) {
      if (current) totalMilliseconds += current[1] - current[0];
      current = [...interval];
    } else {
      current[1] = Math.max(current[1], interval[1]);
    }
  }
  if (current) totalMilliseconds += current[1] - current[0];
  return Math.floor(totalMilliseconds / 60_000);
}
