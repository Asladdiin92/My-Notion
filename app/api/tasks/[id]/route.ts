import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hasPlannerAccess } from "@/lib/access";
import { archiveNotionTask, setNotionTaskCompleted, updateNotionTask } from "@/lib/notion";
import { logActivity } from "@/lib/activity-logger";
import { isSameOrigin, parseTaskInput } from "@/lib/task-request";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function errorStatus(message: string): number {
  if (message.startsWith("Add NOTION_")) return 503;
  if (message.startsWith("Notion API error (validation_error)") || message.startsWith("Notion API error (invalid_")) return 400;
  if (message.startsWith("Notion API error")) return 502;
  if (message.includes("not a valid planner item ID")) return 400;
  return 400;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!await hasPlannerAccess()) {
    return NextResponse.json({ ok: false, error: "You are not authorized to modify this planner." }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "This request must come from the dashboard." }, { status: 403 });
  }

  const parsed = await parseTaskInput(request);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  try {
    const { id } = await params;
    const task = await updateNotionTask(id, parsed.input);
    return NextResponse.json({ ok: true, task }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update the planner item.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(message), headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  if (!await hasPlannerAccess()) {
    return NextResponse.json({ ok: false, error: "You are not authorized to modify this planner." }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "This request must come from the dashboard." }, { status: 403 });
  }

  try {
    const { id } = await params;
    await archiveNotionTask(id);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not archive the planner item.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(message), headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  if (!await hasPlannerAccess()) {
    return NextResponse.json({ ok: false, error: "You are not authorized to modify this planner." }, { status: 403 });
  }
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Sign in before modifying this planner." }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "This request must come from the dashboard." }, { status: 403 });
  }
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        typeof (body as Record<string, unknown>).completed !== "boolean") {
      return NextResponse.json({ ok: false, error: "Choose whether the item is completed." }, { status: 400 });
    }
    const { id } = await params;
    const completed = (body as { completed: boolean }).completed;
    const task = await setNotionTaskCompleted(id, completed);
    if (completed) {
      await logActivity({
        userId,
        type: "task_completed",
        source: "dashboard",
        title: "Completed a planner task",
        entityType: "task",
        entityId: task.id,
        idempotencyKey: `task-completed:${task.id}:${task.updatedAt ?? ""}`,
      });
    }
    return NextResponse.json({ ok: true, task }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update task completion.";
    return NextResponse.json({ ok: false, error: message }, { status: errorStatus(message), headers: { "Cache-Control": "no-store" } });
  }
}
