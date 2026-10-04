import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { hasPlannerAccess } from "@/lib/access";
import { apiErrorMessage } from "@/lib/api-response";
import { explainNextAction } from "@/lib/gemini";
import { fetchGoogleCalendarEvents, readGoogleSession } from "@/lib/google-workspace";
import { PLANNER_TIME_ZONE } from "@/lib/planner-datetime";
import { selectNextAction } from "@/lib/next-action";
import { fetchNotionTasks } from "@/lib/notion";
import { isSameOrigin } from "@/lib/task-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!await hasPlannerAccess()) {
    return NextResponse.json({ error: "You are not authorized to use this planner." }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "This request must come from the dashboard." }, { status: 403 });
  }

  try {
    const now = new Date();
    const { userId } = await auth();
    const session = userId ? readGoogleSession(request, userId) : null;
    const [tasks, events] = await Promise.all([
      fetchNotionTasks(),
      session ? fetchGoogleCalendarEvents(session, now) : Promise.resolve([]),
    ]);
    const selection = selectNextAction(tasks, now, PLANNER_TIME_ZONE, events);
    const currentLocalTime = new Intl.DateTimeFormat("en", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: PLANNER_TIME_ZONE,
      timeZoneName: "short",
    }).format(now);
    if (!selection.candidate || !selection.focusWindow) {
      return NextResponse.json({
        ...selection,
        calendarConnected: Boolean(session),
        currentLocalTime,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const explanation = await explainNextAction(selection.candidate, selection.focusWindow, currentLocalTime);
    return NextResponse.json({
      ...selection,
      explanation,
      calendarConnected: Boolean(session),
      currentLocalTime,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = apiErrorMessage(error, "Could not prepare your next-action recommendation.");
    const status = message.includes("Google session expired") ? 401
      : message.startsWith("Add GEMINI_API_KEY") || message.startsWith("Add NOTION_") ? 503 : 502;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
