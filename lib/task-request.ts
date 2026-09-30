import type { CreateTaskInput } from "@/lib/notion";

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const hosts = [request.headers.get("host"), request.headers.get("x-forwarded-host")]
    .flatMap((value) => value?.split(",").map((host) => host.trim()) ?? []);
  if (!origin || hosts.length === 0) return false;
  try {
    return hosts.includes(new URL(origin).host);
  } catch {
    return false;
  }
}

export async function parseTaskInput(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { ok: false as const, error: "Enter a planner item." };
    }
    const values = body as Record<string, unknown>;
    const allowedFields = new Set(["title", "type", "status", "priority", "area", "course", "dueDate", "nextAction"]);
    if (Object.keys(values).some((key) => !allowedFields.has(key))) {
      return { ok: false as const, error: "The request contains an unsupported field." };
    }
    if (typeof values.title !== "string" || !values.title.trim()) {
      return { ok: false as const, error: "A task title is required." };
    }
    for (const name of ["type", "status", "priority", "area", "course", "dueDate", "nextAction"] as const) {
      if (values[name] !== undefined && (typeof values[name] !== "string" || values[name].length > 2000)) {
        return { ok: false as const, error: `Invalid ${name} value.` };
      }
    }
    if (values.title.length > 2000) {
      return { ok: false as const, error: "Title must be 2,000 characters or fewer." };
    }
    const input: CreateTaskInput = {
      title: values.title,
      type: values.type as string | undefined,
      status: values.status as string | undefined,
      priority: values.priority as string | undefined,
      area: values.area as string | undefined,
      course: values.course as string | undefined,
      dueDate: values.dueDate as string | undefined,
      nextAction: values.nextAction as string | undefined,
    };
    return { ok: true as const, input };
  } catch {
    return { ok: false as const, error: "Send a valid JSON planner item." };
  }
}
