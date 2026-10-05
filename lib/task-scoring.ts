import { plannerDateKey } from "@/lib/planner-datetime";
import type { Task } from "@/lib/types";

export type TaskScoreLabel = "Critical" | "Important" | "Normal" | "Can wait";
export type ScoreFactor = {
  key: "deadline" | "priority" | "status" | "age" | "effort";
  points: number;
  evidence: string;
};
export type ScoredTask = {
  task: Task;
  score: number;
  label: TaskScoreLabel;
  factors: ScoreFactor[];
};
export type RecommendationExplanation = { reason: string; firstStep: string };

const COMPLETED_STATUS = /^(done|complete|completed|finished|cancelled|canceled|archived)$/i;

export function isEligibleRecommendationTask(task: Task): boolean {
  return !task.completed && !COMPLETED_STATUS.test(task.status.trim());
}

function deadlinePoints(task: Task, today: string, now: Date): ScoreFactor {
  const raw = task.dateEnd || task.dueDate;
  if (!raw) return { key: "deadline", points: 0, evidence: "No deadline recorded" };
  const date = plannerDateKey(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return { key: "deadline", points: 0, evidence: "Deadline is unavailable or invalid" };
  }
  const timestamp = raw.includes("T") ? Date.parse(raw) : undefined;
  if (raw.includes("T") && !Number.isFinite(timestamp)) {
    return { key: "deadline", points: 0, evidence: "Deadline is unavailable or invalid" };
  }
  if (date < today || (timestamp !== undefined && timestamp <= now.getTime())) {
    return { key: "deadline", points: 40, evidence: "Overdue" };
  }
  if (date === today) return { key: "deadline", points: 36, evidence: "Due today" };
  const days = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days <= 3) return { key: "deadline", points: 28, evidence: `Due in ${days} day${days === 1 ? "" : "s"}` };
  if (days <= 7) return { key: "deadline", points: 20, evidence: `Due in ${days} days` };
  if (days <= 14) return { key: "deadline", points: 12, evidence: `Due in ${days} days` };
  return { key: "deadline", points: 5, evidence: "Deadline is more than two weeks away" };
}

function priorityPoints(priority: string): ScoreFactor {
  const value = priority.trim().toLowerCase();
  if (value === "critical" || value === "urgent") return { key: "priority", points: 25, evidence: `Recorded priority: ${priority}` };
  if (value === "high") return { key: "priority", points: 19, evidence: `Recorded priority: ${priority}` };
  if (value === "medium" || value === "normal") return { key: "priority", points: 12, evidence: `Recorded priority: ${priority}` };
  if (value === "low") return { key: "priority", points: 5, evidence: `Recorded priority: ${priority}` };
  return { key: "priority", points: 0, evidence: "No recognized priority recorded" };
}

function statusPoints(status: string): ScoreFactor {
  if (/progress|doing|started|active/i.test(status)) {
    return { key: "status", points: 15, evidence: `Already in progress (${status})` };
  }
  return { key: "status", points: 0, evidence: `Status: ${status || "not recorded"}` };
}

function agePoints(createdAt: string, now: Date): ScoreFactor {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created) || created > now.getTime()) {
    return { key: "age", points: 0, evidence: "Task age unavailable" };
  }
  const ageDays = Math.floor((now.getTime() - created) / 86_400_000);
  const points = Math.min(10, Math.floor(ageDays / 7));
  return {
    key: "age",
    points,
    evidence: ageDays === 0 ? "Created today" : `Created ${ageDays} days ago`,
  };
}

function effortPoints(estimatedHours: number | undefined): ScoreFactor {
  if (!Number.isFinite(estimatedHours) || (estimatedHours ?? 0) <= 0) {
    return { key: "effort", points: 0, evidence: "No valid effort estimate recorded" };
  }
  const minutes = Math.ceil(estimatedHours! * 60);
  const points = estimatedHours! <= 1 ? 10 : estimatedHours! <= 2 ? 7 : estimatedHours! <= 4 ? 4 : 0;
  return { key: "effort", points, evidence: `Recorded estimate: ${minutes} minutes` };
}

export function scoreTask(task: Task, now = new Date(), timeZone = "Africa/Addis_Ababa"): ScoredTask {
  const dateParts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(dateParts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const today = `${values.year}-${values.month}-${values.day}`;
  const factors = [
    deadlinePoints(task, today, now),
    priorityPoints(task.priority),
    statusPoints(task.status),
    agePoints(task.createdAt, now),
    effortPoints(task.estimatedHours),
  ];
  const score = Math.max(0, Math.min(100, factors.reduce((sum, factor) => sum + factor.points, 0)));
  const label: TaskScoreLabel = score >= 85 ? "Critical"
    : score >= 65 ? "Important"
      : score >= 40 ? "Normal" : "Can wait";
  return { task, score, label, factors };
}

export function rankTasks(
  tasks: Task[],
  dismissedTaskIds: ReadonlySet<string> = new Set(),
  now = new Date(),
  timeZone = "Africa/Addis_Ababa",
): ScoredTask[] {
  return tasks
    .filter((task) => isEligibleRecommendationTask(task) && !dismissedTaskIds.has(task.id))
    .map((task) => scoreTask(task, now, timeZone))
    .sort((a, b) =>
      b.score - a.score ||
      a.task.id.localeCompare(b.task.id),
    );
}

export function taskRecommendationFingerprint(task: Task): string {
  return JSON.stringify({
    title: task.title,
    status: task.status,
    completed: task.completed,
    priority: task.priority,
    area: task.area,
    dueDate: task.dueDate,
    dateEnd: task.dateEnd ?? null,
    estimatedHours: task.estimatedHours ?? null,
    createdAt: task.createdAt,
    nextAction: task.nextAction,
  });
}

export function isRecommendationCurrent(
  saved: { taskId: string; taskFingerprint: string },
  tasks: Task[],
): boolean {
  const task = tasks.find((candidate) => candidate.id === saved.taskId);
  return Boolean(task && isEligibleRecommendationTask(task) &&
    taskRecommendationFingerprint(task) === saved.taskFingerprint);
}

function deterministicExplanation(scored: ScoredTask): RecommendationExplanation {
  const supportingFactors = scored.factors
    .filter((factor) => factor.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 2)
    .map((factor) => factor.evidence.toLowerCase());
  const reason = supportingFactors.length
    ? `Recommended because it is ${supportingFactors.join(" and ")}.`
    : "Recommended from your current open tasks; no urgency factors are recorded.";
  const firstStep = scored.task.nextAction.trim() ||
    `Open “${scored.task.title}” and choose its first concrete step.`;
  return { reason, firstStep };
}

export async function explainScoredTask(
  scored: ScoredTask,
  explain: (scored: ScoredTask) => Promise<RecommendationExplanation>,
): Promise<{ explanation: RecommendationExplanation; source: "ai" | "fallback" }> {
  try {
    const explanation = await explain(scored);
    if (!explanation.reason.trim() || !explanation.firstStep.trim() ||
        explanation.reason.length > 300 || explanation.firstStep.length > 300) {
      throw new Error("Invalid recommendation explanation.");
    }
    return {
      explanation: {
        reason: explanation.reason.trim(),
        firstStep: explanation.firstStep.trim(),
      },
      source: "ai",
    };
  } catch {
    return { explanation: deterministicExplanation(scored), source: "fallback" };
  }
}
