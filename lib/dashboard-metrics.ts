import type { Task } from "@/lib/types";

const COMPLETED_STATUS = /^(done|complete|completed|finished)$/i;

function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function taskDateKey(value: string, timeZone: string): string | null {
  if (!value) return null;
  if (!value.includes("T")) {
    const date = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  }
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? dateKeyInTimeZone(timestamp, timeZone) : null;
}

function isCompleted(task: Task): boolean {
  return task.completed || COMPLETED_STATUS.test(task.status.trim());
}

export function calculateDashboardTaskMetrics(
  tasks: Task[],
  timeZone: string,
  now = new Date(),
): { tasksDueToday: number; activeProjects: number; notesCount: number } {
  const today = dateKeyInTimeZone(now, timeZone);
  const dueToday = tasks.filter((task) =>
    !isCompleted(task) && taskDateKey(task.dueDate ?? "", timeZone) === today
  ).length;
  const activeProjects = new Set(
    tasks
      .filter((task) => !isCompleted(task))
      .map((task) => task.area.trim())
      .filter((area) => area && area !== "Unassigned" && area !== "Other"),
  ).size;
  const notesCount = tasks.filter((task) => Boolean(task.notes?.trim())).length;

  return { tasksDueToday: dueToday, activeProjects, notesCount };
}
