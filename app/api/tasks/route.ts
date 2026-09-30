import { NextResponse } from "next/server";
import { createNotionTask, fetchNotionTaskOptions, fetchNotionTasks } from "@/lib/notion";
import { hasPlannerAccess } from "@/lib/access";
import { isSameOrigin, parseTaskInput } from "@/lib/task-request";
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
  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "This request must come from the dashboard." }, { status: 403 });
  }

  const parsed = await parseTaskInput(request);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  try {
    const task = await createNotionTask(parsed.input);
    return NextResponse.json({ ok: true, task }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the planner item.";
    const status = message.startsWith("Add NOTION_") ? 503
      : message.startsWith("Notion API error (validation_error)") || message.startsWith("Notion API error (invalid_") ? 400
        : message.startsWith("Notion API error") ? 502 : 400;
    return NextResponse.json({ ok: false, error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
