import type { Task } from "@/lib/types";

const COMPLETED_STATUS = /^(done|complete|completed|finished)$/i;
const SENSITIVE_REASON = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bBearer\s+\S+/i,
  /\b(?:sk|pk|ghp|github_pat|AIza)[-_][A-Za-z0-9_-]{12,}\b/i,
  /\bmongodb(?:\+srv)?:\/\//i,
];

export type BriefingTask = Pick<
  Task,
  "id" | "title" | "dueDate" | "dateEnd" | "priority" | "area" | "estimatedHours" | "completed" | "status"
>;

export type DailyBriefing = {
  greeting: string;
  summary: {
    tasksToday: number;
    overdueTasks: number;
    upcomingItems: number;
    activeProjects: number;
    focusMinutesToday?: number;
  };
  recommendedAction: {
    entityId: string;
    title: string;
    reason: string;
    estimatedMinutes: number | null;
    score: number;
  } | null;
  warnings: string[];
  source: "ai" | "fallback";
  generatedAt: string;
};

export type DailyBriefingInputs = {
  tasks: BriefingTask[];
  now: Date;
  timeZone: string;
  recentActivityTypes?: string[];
  focusMinutesToday?: number;
};

export type BriefingAIInput = {
  today: string;
  overdueTasks: Array<{ id: string; title: string; dueDate: string | null; priority: string; area: string }>;
  dueTodayTasks: Array<{ id: string; title: string; dueDate: string | null; priority: string; area: string }>;
  upcomingTasks: Array<{ id: string; title: string; dueDate: string | null; priority: string; area: string }>;
  recentActivityTypes: string[];
  focusMinutesToday?: number;
};

export type BriefingAI = (input: BriefingAIInput) => Promise<string>;

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

function taskDeadline(task: BriefingTask, timeZone: string): string | null {
  const date = task.dateEnd || task.dueDate;
  if (!date) return null;
  try {
    const timestamp = date.includes("T") ? new Date(date) : undefined;
    if (timestamp && !Number.isFinite(timestamp.getTime())) return null;
    const key = date.includes("T") ? localDateKey(timestamp!, timeZone) : date.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    const normalized = new Date(`${key}T00:00:00.000Z`);
    return !Number.isNaN(normalized.getTime()) && normalized.toISOString().slice(0, 10) === key ? key : null;
  } catch {
    return null;
  }
}

function isCompleted(task: BriefingTask): boolean {
  return task.completed || COMPLETED_STATUS.test(task.status.trim());
}

function scoreTask(task: BriefingTask, today: string, now: Date, timeZone: string): number {
  const day = taskDeadline(task, timeZone) ?? "";
  const deadline = task.dateEnd || task.dueDate;
  const overdue = Boolean(day && (day < today || (deadline?.includes("T") && Date.parse(deadline) <= now.getTime())));
  const urgency = overdue ? 70 : day === today ? 55 : day ? 30 : 10;
  const priority = ({ Critical: 25, High: 18, Medium: 10, Low: 4 } as Record<string, number>)[task.priority] ?? 0;
  return Math.min(100, urgency + priority + (task.estimatedHours && task.estimatedHours <= 1 ? 10 : 0));
}

function greeting(now: Date, timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat("en", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now));
  return hour < 12 ? "Good morning." : hour < 17 ? "Good afternoon." : "Good evening.";
}

function recommendationReason(task: BriefingTask, today: string, now: Date, timeZone: string): string {
  const deadline = taskDeadline(task, timeZone);
  const dueToday = deadline === today;
  const rawDeadline = task.dateEnd || task.dueDate;
  const overdue = deadline !== null &&
    (deadline < today || Boolean(rawDeadline?.includes("T") && Date.parse(rawDeadline) <= now.getTime()));
  if (overdue) return "This task is overdue and still unfinished.";
  if (dueToday) return "This task is due today and still unfinished.";
  if (task.priority === "Critical" || task.priority === "High") {
    return `${task.priority} priority makes this a strong next task.`;
  }
  if (deadline) return `This is the nearest upcoming unfinished task (${deadline}).`;
  return "This is the highest-ranked unfinished task in your planner.";
}

function recommendedTask(tasks: BriefingTask[], today: string, now: Date, timeZone: string): BriefingTask | null {
  return tasks
    .filter((task) => !isCompleted(task))
    .sort((a, b) =>
      scoreTask(b, today, now, timeZone) - scoreTask(a, today, now, timeZone) ||
      (taskDeadline(a, timeZone) ?? "9999-12-31").localeCompare(taskDeadline(b, timeZone) ?? "9999-12-31") ||
      a.title.localeCompare(b.title),
    )[0] ?? null;
}

function parseAIChoice(raw: string, tasks: BriefingTask[]): { entityId: string; reason: string } {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid briefing response.");
  const choice = parsed as Record<string, unknown>;
  if (Object.keys(choice).some((key) => !["recommendedTaskId", "reason"].includes(key)) ||
      typeof choice.recommendedTaskId !== "string" || typeof choice.reason !== "string" ||
      !choice.reason.trim() || choice.reason.length > 300 ||
      SENSITIVE_REASON.some((pattern) => pattern.test(choice.reason as string))) {
    throw new Error("Invalid briefing response.");
  }
  const task = tasks.find((item) => item.id === choice.recommendedTaskId && !isCompleted(item));
  if (!task) throw new Error("Briefing recommendation did not match a current task.");
  return { entityId: task.id, reason: choice.reason.trim() };
}

export async function createDailyBriefing(
  input: DailyBriefingInputs,
  generateAI: BriefingAI,
  extraWarnings: string[] = [],
): Promise<DailyBriefing> {
  const { tasks, now, timeZone } = input;
  const today = localDateKey(now, timeZone);
  const upcomingEnd = new Date(`${today}T12:00:00Z`);
  upcomingEnd.setUTCDate(upcomingEnd.getUTCDate() + 7);
  const upcomingEndKey = upcomingEnd.toISOString().slice(0, 10);
  const openTasks = tasks.filter((task) => !isCompleted(task));
  const dueToday = openTasks.filter((task) => taskDeadline(task, timeZone) === today);
  const overdue = openTasks.filter((task) => {
    const deadline = taskDeadline(task, timeZone);
    const exactDeadline = task.dateEnd || task.dueDate;
    return deadline !== null &&
      (deadline < today || Boolean(deadline === today && exactDeadline?.includes("T") &&
        Date.parse(exactDeadline) <= now.getTime()));
  });
  const upcoming = openTasks.filter((task) => {
    const deadline = taskDeadline(task, timeZone);
    if (!deadline || deadline <= today) return false;
    return deadline <= upcomingEndKey;
  });
  const activeProjects = new Set(
    openTasks.map((task) => task.area.trim()).filter((area) => area && area !== "Unassigned" && area !== "Other"),
  );
  const warnings = [...new Set(extraWarnings.filter((warning) => warning.length <= 160))].slice(0, 5);
  const selected = recommendedTask(tasks, today, now, timeZone);

  const base: Omit<DailyBriefing, "source" | "recommendedAction"> = {
    greeting: greeting(now, timeZone),
    summary: {
      tasksToday: dueToday.length,
      overdueTasks: overdue.length,
      upcomingItems: upcoming.length,
      activeProjects: activeProjects.size,
      ...(Number.isSafeInteger(input.focusMinutesToday) && (input.focusMinutesToday ?? -1) >= 0
        ? { focusMinutesToday: input.focusMinutesToday }
        : {}),
    },
    warnings,
    generatedAt: now.toISOString(),
  };

  if (!selected) return { ...base, recommendedAction: null, source: "fallback" };

  const estimatedMinutes = Number.isFinite(selected.estimatedHours) && (selected.estimatedHours ?? 0) > 0
    ? Math.ceil(selected.estimatedHours! * 60)
    : null;
  const fallback = {
    entityId: selected.id,
    title: selected.title,
    reason: recommendationReason(selected, today, now, timeZone),
    estimatedMinutes,
    score: scoreTask(selected, today, now, timeZone),
  };

  try {
    const aiInput: BriefingAIInput = {
      today,
      overdueTasks: overdue.map((task) => ({
        id: task.id,
        title: task.title,
        dueDate: taskDeadline(task, timeZone),
        priority: task.priority,
        area: task.area,
      })),
      dueTodayTasks: dueToday.map((task) => ({
        id: task.id,
        title: task.title,
        dueDate: taskDeadline(task, timeZone),
        priority: task.priority,
        area: task.area,
      })),
      upcomingTasks: upcoming.map((task) => ({
        id: task.id,
        title: task.title,
        dueDate: taskDeadline(task, timeZone),
        priority: task.priority,
        area: task.area,
      })),
      recentActivityTypes: (input.recentActivityTypes ?? []).slice(0, 10),
      ...(base.summary.focusMinutesToday !== undefined
        ? { focusMinutesToday: base.summary.focusMinutesToday }
        : {}),
    };
    const choice = parseAIChoice(await generateAI(aiInput), tasks);
    const task = tasks.find((item) => item.id === choice.entityId)!;
    return {
      ...base,
      source: "ai",
      recommendedAction: {
        ...fallback,
        entityId: task.id,
        title: task.title,
        reason: choice.reason,
      },
    };
  } catch {
    return {
      ...base,
      source: "fallback",
      warnings: [...new Set([...warnings, "AI briefing is unavailable; showing a deterministic recommendation."])].slice(0, 5),
      recommendedAction: fallback,
    };
  }
}

export function validateDailyBriefing(value: unknown, tasks: BriefingTask[]): value is DailyBriefing {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const briefing = value as Record<string, unknown>;
  if (Object.keys(briefing).some((key) =>
    !["greeting", "summary", "recommendedAction", "warnings", "source", "generatedAt"].includes(key)
  ) || typeof briefing.greeting !== "string" || briefing.greeting.length > 100 ||
      (briefing.source !== "ai" && briefing.source !== "fallback") ||
      typeof briefing.generatedAt !== "string" || !Number.isFinite(new Date(briefing.generatedAt).getTime()) ||
      !Array.isArray(briefing.warnings) || briefing.warnings.length > 5 ||
      briefing.warnings.some((warning) => typeof warning !== "string" || warning.length > 160) ||
      !briefing.summary || typeof briefing.summary !== "object" || Array.isArray(briefing.summary)) return false;
  const summary = briefing.summary as Record<string, unknown>;
  if (Object.keys(summary).some((key) =>
    !["tasksToday", "overdueTasks", "upcomingItems", "activeProjects", "focusMinutesToday"].includes(key)
  )) return false;
  if (["tasksToday", "overdueTasks", "upcomingItems", "activeProjects"].some((key) =>
    !Number.isSafeInteger(summary[key]) || (summary[key] as number) < 0
  )) return false;
  if (summary.focusMinutesToday !== undefined &&
      (!Number.isSafeInteger(summary.focusMinutesToday) || (summary.focusMinutesToday as number) < 0)) return false;
  if (briefing.recommendedAction === null) return true;
  if (!briefing.recommendedAction || typeof briefing.recommendedAction !== "object" ||
      Array.isArray(briefing.recommendedAction)) return false;
  const action = briefing.recommendedAction as Record<string, unknown>;
  if (Object.keys(action).some((key) =>
    !["entityId", "title", "reason", "estimatedMinutes", "score"].includes(key)
  )) return false;
  const task = tasks.find((item) => item.id === action.entityId && !isCompleted(item));
  return Boolean(task && action.title === task.title && typeof action.reason === "string" &&
    action.reason.length > 0 && action.reason.length <= 300 &&
    (action.estimatedMinutes === null || (Number.isSafeInteger(action.estimatedMinutes) && (action.estimatedMinutes as number) > 0)) &&
    Number.isSafeInteger(action.score) && (action.score as number) >= 0 && (action.score as number) <= 100);
}
