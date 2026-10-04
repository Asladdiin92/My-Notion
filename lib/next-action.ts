import { plannerDateKey, todayInPlannerTimeZone } from "@/lib/planner-datetime";
import type { Task } from "@/lib/types";

export const FOCUS_START = "08:30";
export const FOCUS_END = "18:00";
const MIN_FOCUS_MINUTES = 15;

export type CalendarEvent = { start: string; end: string };
export type FocusWindow = {
  date: string;
  startTime: string;
  endTime: string;
  availableMinutes: number;
  nextEventStart?: string;
};
export type NextActionCandidate = {
  id: string;
  url: string;
  title: string;
  priority: string;
  area: string;
  dueDate: string | null;
  dueLabel: "Overdue" | "Due today" | "Upcoming" | "No deadline";
  estimatedMinutes: number | null;
  nextAction: string;
};
export type NextActionSelection = {
  candidate: NextActionCandidate | null;
  focusWindow: FocusWindow | null;
  message?: string;
};

function localDateTime(date: Date, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

function minuteOfDay(value: string): number {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function addDays(date: string, count: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

function eventInterval(event: CalendarEvent, date: string, timezone: string): { start: number; end: number } | null {
  if (!event.start || !event.end) return null;
  const eventDate = plannerDateKey(event.start);
  const endDate = plannerDateKey(event.end);
  if (!event.start.includes("T")) {
    return eventDate <= date && date < endDate ? { start: 0, end: 24 * 60 } : null;
  }
  if (eventDate !== date && endDate !== date) return null;

  const startDate = new Date(event.start);
  const endDateTime = new Date(event.end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDateTime.getTime())) {
    throw new Error("Google Calendar returned an invalid meeting time.");
  }
  const start = localDateTime(startDate, timezone);
  const end = localDateTime(endDateTime, timezone);
  if (start.date !== date && end.date !== date) return null;
  return {
    start: start.date < date ? 0 : minuteOfDay(start.time),
    end: end.date > date ? 24 * 60 : minuteOfDay(end.time),
  };
}

export function getNextFocusWindow(
  now: Date,
  timezone: string,
  events: CalendarEvent[] = [],
): FocusWindow | null {
  const localNow = localDateTime(now, timezone);
  const nowMinute = minuteOfDay(localNow.time);
  let date = localNow.date;
  let earliest = nowMinute < minuteOfDay(FOCUS_START) ? minuteOfDay(FOCUS_START) : nowMinute;

  if (earliest >= minuteOfDay(FOCUS_END)) {
    date = addDays(date, 1);
    earliest = minuteOfDay(FOCUS_START);
  }

  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const endOfWorkday = minuteOfDay(FOCUS_END);
    let cursor = earliest;
    const intervals = events
      .flatMap((event) => {
        const interval = eventInterval(event, date, timezone);
        return interval ? [interval] : [];
      })
      .sort((a, b) => a.start - b.start);

    for (const interval of intervals) {
      if (interval.end <= cursor || interval.start >= endOfWorkday) continue;
      if (interval.start - cursor >= MIN_FOCUS_MINUTES) {
        return {
          date,
          startTime: toTime(cursor),
          endTime: toTime(Math.min(interval.start, endOfWorkday)),
          availableMinutes: Math.min(interval.start, endOfWorkday) - cursor,
          nextEventStart: toTime(interval.start),
        };
      }
      cursor = Math.max(cursor, interval.end);
      if (cursor >= endOfWorkday) break;
    }

    if (endOfWorkday - cursor >= MIN_FOCUS_MINUTES) {
      return {
        date,
        startTime: toTime(cursor),
        endTime: FOCUS_END,
        availableMinutes: endOfWorkday - cursor,
      };
    }
    date = addDays(date, 1);
    earliest = minuteOfDay(FOCUS_START);
  }
  return null;
}

function deadlineRank(task: Task, today: string, now: Date): { rank: number; dueDate: string | null; dueLabel: NextActionCandidate["dueLabel"] } {
  const date = task.dateEnd || task.dueDate;
  if (!date) return { rank: 0, dueDate: null, dueLabel: "No deadline" };
  const dueDate = plannerDateKey(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`))) {
    return { rank: 0, dueDate: null, dueLabel: "No deadline" };
  }
  const deadlineTime = date.includes("T") ? Date.parse(date) : undefined;
  if (date.includes("T") && !Number.isFinite(deadlineTime)) {
    return { rank: 0, dueDate: null, dueLabel: "No deadline" };
  }
  if (dueDate < today || (deadlineTime !== undefined && deadlineTime <= now.getTime())) {
    return { rank: 3, dueDate: date, dueLabel: "Overdue" };
  }
  if (dueDate === today) return { rank: 2, dueDate: date, dueLabel: "Due today" };
  return { rank: 1, dueDate: date, dueLabel: "Upcoming" };
}

function priorityRank(priority: string): number {
  return ({ Critical: 4, High: 3, Medium: 2, Low: 1 } as Record<string, number>)[priority] ?? 0;
}

export function selectNextAction(
  tasks: Task[],
  now = new Date(),
  timezone = "Africa/Addis_Ababa",
  events: CalendarEvent[] = [],
): NextActionSelection {
  const today = todayInPlannerTimeZone(now);
  const focusWindow = getNextFocusWindow(now, timezone, events);
  if (!focusWindow) return { candidate: null, focusWindow: null, message: "No available focus window was found in the next week." };

  const ranked = tasks
    .filter((task) => !task.completed)
    .map((task) => {
      const deadline = deadlineRank(task, today, now);
      const estimatedMinutes = Number.isFinite(task.estimatedHours) && (task.estimatedHours ?? 0) > 0
        ? Math.ceil(task.estimatedHours! * 60)
        : null;
      return {
        task,
        ...deadline,
        estimatedMinutes,
        priority: priorityRank(task.priority),
        fits: estimatedMinutes === null || estimatedMinutes <= focusWindow.availableMinutes,
      };
    })
    .sort((a, b) =>
      b.rank - a.rank ||
      (a.rank > 0 ? (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") : 0) ||
      b.priority - a.priority ||
      Number(b.fits) - Number(a.fits) ||
      (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") ||
      a.task.title.localeCompare(b.task.title),
    );

  const selected = ranked[0];
  if (!selected) {
    return { candidate: null, focusWindow, message: "There are no incomplete planner items to recommend." };
  }

  return {
    candidate: {
      id: selected.task.id,
      url: selected.task.url,
      title: selected.task.title,
      priority: selected.task.priority || "Unassigned",
      area: selected.task.area || "Unassigned",
      dueDate: selected.dueDate,
      dueLabel: selected.dueLabel,
      estimatedMinutes: selected.estimatedMinutes,
      nextAction: selected.task.nextAction,
    },
    focusWindow,
  };
}
