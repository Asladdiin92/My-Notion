export const PLANNER_TIME_ZONE = "Africa/Addis_Ababa";

function partsFor(value: Date, options: Intl.DateTimeFormatOptions): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en", { timeZone: PLANNER_TIME_ZONE, ...options })
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function dateFromParts(parts: Record<string, string>): string {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function plannerDateKey(value: string): string {
  if (!value.includes("T")) return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value.slice(0, 10)
    : dateFromParts(partsFor(date, { year: "numeric", month: "2-digit", day: "2-digit" }));
}

export function todayInPlannerTimeZone(now = new Date()): string {
  return dateFromParts(partsFor(now, { year: "numeric", month: "2-digit", day: "2-digit" }));
}

export function formatPlannerDate(
  value: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  const hasTime = value.includes("T");
  const formatOptions = hasTime
    ? { ...options, hour: "numeric" as const, minute: "2-digit" as const }
    : options;
  const date = hasTime ? new Date(value) : new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return new Intl.DateTimeFormat("en", { timeZone: PLANNER_TIME_ZONE, ...formatOptions }).format(date);
}

export function plannerDateTimeInput(value: string): string {
  if (!value.includes("T")) return `${value.slice(0, 10)}T00:00`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const parts = partsFor(date, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${dateFromParts(parts)}T${parts.hour}:${parts.minute}`;
}

export function plannerLocalTimeToIso(date: string, time: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match || !timeMatch) throw new Error("Choose a valid date and time.");
  const [, year, month, day] = match;
  const [, hour, minute] = timeMatch;
  const wallClockAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const normalized = new Date(wallClockAsUtc);
  if (normalized.getUTCFullYear() !== Number(year) ||
      normalized.getUTCMonth() + 1 !== Number(month) ||
      normalized.getUTCDate() !== Number(day)) {
    throw new Error("Choose a valid date and time.");
  }
  const displayed = partsFor(new Date(wallClockAsUtc), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const timezoneOffset = Date.UTC(
    Number(displayed.year),
    Number(displayed.month) - 1,
    Number(displayed.day),
    Number(displayed.hour),
    Number(displayed.minute),
    Number(displayed.second),
  ) - wallClockAsUtc;
  return new Date(wallClockAsUtc - timezoneOffset).toISOString();
}
