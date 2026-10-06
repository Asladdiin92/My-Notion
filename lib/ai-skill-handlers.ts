import "server-only";

import { fetchNotionTasks } from "@/lib/notion";
import type { Task } from "@/lib/types";

export type TaskListStatus = "pending" | "completed" | "all";
export type ListTasksParameters = {
  status: TaskListStatus;
  limit: number;
};

export type SafeTask = Pick<
  Task,
  "id" | "title" | "status" | "priority" | "type" | "area" | "course" | "dueDate" | "nextAction" | "completed"
>;

type SkillHandlerContext = {
  parameters: ListTasksParameters;
};

type SkillHandler = (context: SkillHandlerContext) => Promise<SafeTask[]>;

export function parseListTasksParameters(input: unknown): ListTasksParameters {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("The skill request must be a JSON object.");
  }
  const values = input as Record<string, unknown>;
  if (Object.keys(values).some((key) => !["skill", "status", "limit"].includes(key))) {
    throw new Error("The skill request contains an unsupported field.");
  }
  if (values.skill !== "list_tasks") {
    throw new Error("Choose the list_tasks skill.");
  }
  const status = values.status === undefined ? "pending" : values.status;
  if (status !== "pending" && status !== "completed" && status !== "all") {
    throw new Error("Status must be pending, completed, or all.");
  }
  const limit = values.limit === undefined ? 20 : values.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Limit must be an integer from 1 to 100.");
  }
  return { status, limit };
}

export function parseListTasksArguments(input: unknown): ListTasksParameters {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("The list_tasks arguments must be an object.");
  }
  const values = input as Record<string, unknown>;
  if (Object.hasOwn(values, "userId")) {
    throw new Error("The list_tasks skill does not accept a userId.");
  }
  if (Object.keys(values).some((key) => !["status", "limit"].includes(key))) {
    throw new Error("The list_tasks arguments contain an unsupported field.");
  }
  return parseListTasksParameters({
    skill: "list_tasks",
    ...(values.status !== undefined ? { status: values.status } : {}),
    ...(values.limit !== undefined ? { limit: values.limit } : {}),
  });
}

function toSafeTask(task: Task): SafeTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    type: task.type,
    area: task.area,
    course: task.course,
    dueDate: task.dueDate,
    nextAction: task.nextAction,
    completed: task.completed,
  };
}

export function filterAndProjectTasks(tasks: Task[], parameters: ListTasksParameters): SafeTask[] {
  return tasks
    .filter((task) =>
      parameters.status === "all" ||
      (parameters.status === "completed" ? task.completed : !task.completed)
    )
    .slice(0, parameters.limit)
    .map(toSafeTask);
}

async function listTasks({ parameters }: SkillHandlerContext): Promise<SafeTask[]> {
  return filterAndProjectTasks(await fetchNotionTasks(), parameters);
}

const skillHandlers: Readonly<Record<string, SkillHandler>> = Object.freeze({
  listTasks,
});

export function getSkillHandler(name: string): SkillHandler | undefined {
  return Object.hasOwn(skillHandlers, name) ? skillHandlers[name] : undefined;
}

export async function executeSkillHandler(
  handlerName: string,
  parameters: ListTasksParameters,
): Promise<SafeTask[]> {
  const handler = getSkillHandler(handlerName);
  if (!handler) throw new Error("The configured skill handler is not available.");
  return handler({ parameters });
}
