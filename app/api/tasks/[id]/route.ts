import { NextResponse } from "next/server";
import { hasPlannerAccess } from "@/lib/access";
import { archiveNotionTask, updateNotionTask } from "@/lib/notion";
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
