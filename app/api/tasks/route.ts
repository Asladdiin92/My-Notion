import { NextResponse } from "next/server";
import { createNotionTask, fetchNotionTaskOptions, fetchNotionTasks, type CreateTaskInput } from "@/lib/notion";
import { hasPlannerAccess } from "@/lib/access";
import type { TasksResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!await hasPlannerAccess()) {
    return NextResponse.json<TasksResponse>({ tasks: [], configured: false, error: "You are not authorized to view this planner." }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  try {
    const [tasks, options] = await Promise.all([
      fetchNotionTasks(),
      fetchNotionTaskOptions(),
    ]);
    return NextResponse.json<TasksResponse>({ tasks, options, configured: true }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load tasks from Notion.";
    const status = message.startsWith("Add NOTION_") ? 503 : 502;
    return NextResponse.json<TasksResponse>({ tasks: [], configured: false, error: message }, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export async function POST(request: Request) {
  if (!await hasPlannerAccess()) {
    return NextResponse.json({ ok: false, error: "You are not authorized to modify this planner." }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  const hosts = [request.headers.get("host"), request.headers.get("x-forwarded-host")]
    .flatMap((value) => value?.split(",").map((host) => host.trim()) ?? []);
  if (!origin || hosts.length === 0) {
    return NextResponse.json({ ok: false, error: "This request must come from the dashboard." }, { status: 403 });
  }
  try {
    if (!hosts.includes(new URL(origin).host)) {
      return NextResponse.json({ ok: false, error: "This request must come from the dashboard." }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "This request must come from the dashboard." }, { status: 403 });
  }

  let input: CreateTaskInput;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: "Enter a planner item." }, { status: 400 });
    }
    const values = body as Record<string, unknown>;
    if (typeof values.title !== "string" || !values.title.trim()) {
      return NextResponse.json({ ok: false, error: "A task title is required." }, { status: 400 });
    }
    const fieldNames = ["type", "status", "priority", "area", "course", "dueDate", "nextAction"] as const;
    for (const name of fieldNames) {
      if (values[name] !== undefined && (typeof values[name] !== "string" || values[name].length > 2000)) {
        return NextResponse.json({ ok: false, error: `Invalid ${name} value.` }, { status: 400 });
      }
    }
    if (values.title.length > 2000) {
      return NextResponse.json({ ok: false, error: "Title must be 2,000 characters or fewer." }, { status: 400 });
    }
    input = {
      title: values.title,
      type: values.type as string | undefined,
      status: values.status as string | undefined,
      priority: values.priority as string | undefined,
      area: values.area as string | undefined,
      course: values.course as string | undefined,
      dueDate: values.dueDate as string | undefined,
      nextAction: values.nextAction as string | undefined,
    };
  } catch {
    return NextResponse.json({ ok: false, error: "Send a valid JSON planner item." }, { status: 400 });
  }

  try {
    const task = await createNotionTask(input);
    return NextResponse.json({ ok: true, task }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the planner item.";
    const status = message.startsWith("Add NOTION_") ? 503
      : message.startsWith("Notion API error (validation_error)") || message.startsWith("Notion API error (invalid_") ? 400
        : message.startsWith("Notion API error") ? 502 : 400;
    return NextResponse.json({ ok: false, error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
