import { NextResponse } from "next/server";
import { hasPlannerAccess } from "@/lib/access";
import {
  getPlannerAssistantAnswer,
  getPlannerAssistantBreakdown,
  getPlannerAssistantDayPlan,
  getPlannerAssistantPlan,
} from "@/lib/gemini";
import { fetchNotionTaskOptions, fetchNotionTasks } from "@/lib/notion";
import { convertPrayerTimesToTimezone, fetchHararPrayerTimes } from "@/lib/prayer-times";
import { isSameOrigin } from "@/lib/task-request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!await hasPlannerAccess()) {
    return NextResponse.json({ error: "You are not authorized to use this planner." }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "This request must come from the dashboard." }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 8_192) {
    return NextResponse.json({ error: "The assistant request is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a valid assistant request." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Send a valid assistant request." }, { status: 400 });
  }

  const values = body as Record<string, unknown>;
  if (Object.keys(values).some((key) => !["mode", "question", "date", "timezone", "taskId"].includes(key))) {
    return NextResponse.json({ error: "The request contains an unsupported field." }, { status: 400 });
  }
  const modes = ["suggest", "ask", "plan", "breakdown", "day"];
  if (typeof values.mode !== "string" || !modes.includes(values.mode)) {
    return NextResponse.json({ error: "Choose a valid assistant action." }, { status: 400 });
  }
  if (["ask", "plan"].includes(values.mode) && (typeof values.question !== "string" || !values.question.trim())) {
    return NextResponse.json({ error: "Enter an instruction or question for your planner." }, { status: 400 });
  }
  if (values.question !== undefined && (typeof values.question !== "string" || values.question.length > 1000)) {
    return NextResponse.json({ error: "Instructions must be 1,000 characters or fewer." }, { status: 400 });
  }
  if (values.taskId !== undefined &&
      (typeof values.taskId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values.taskId))) {
    return NextResponse.json({ error: "Choose a valid planner task." }, { status: 400 });
  }
  if (values.mode === "day" || values.date !== undefined || values.timezone !== undefined) {
    if (typeof values.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(values.date) ||
        typeof values.timezone !== "string" || values.timezone.length > 100) {
      return NextResponse.json({ error: "A valid local date and time zone are required for this planner request." }, { status: 400 });
    }
    const parsedDate = new Date(`${values.date}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== values.date) {
      return NextResponse.json({ error: "Choose a valid date for your day plan." }, { status: 400 });
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone: values.timezone }).format();
    } catch {
      return NextResponse.json({ error: "Choose a valid time zone for your day plan." }, { status: 400 });
    }
  }

  try {
    const tasks = await fetchNotionTasks();
    if (values.mode === "plan") {
      const options = await fetchNotionTaskOptions();
      const plan = await getPlannerAssistantPlan(
        values.question as string,
        tasks,
        options,
        values.date as string | undefined,
        values.timezone as string | undefined,
      );
      return NextResponse.json({ plan }, { headers: { "Cache-Control": "no-store" } });
    }
    if (values.mode === "breakdown") {
      const plan = await getPlannerAssistantBreakdown(tasks, values.taskId as string | undefined);
      return NextResponse.json({ plan }, { headers: { "Cache-Control": "no-store" } });
    }
    if (values.mode === "day") {
      const prayerData = await fetchHararPrayerTimes(values.date as string);
      const prayerTimes = convertPrayerTimesToTimezone(
        prayerData.date,
        prayerData.timezone,
        values.timezone as string,
        prayerData.times,
      );
      const plan = await getPlannerAssistantDayPlan(tasks, values.date as string, values.timezone as string, prayerTimes);
      return NextResponse.json({ plan }, { headers: { "Cache-Control": "no-store" } });
    }
    const answer = await getPlannerAssistantAnswer(values.mode as "suggest" | "ask", values.question as string | undefined, tasks);
    return NextResponse.json({ answer }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The planner assistant could not respond.";
    const status = message.startsWith("Add GEMINI_API_KEY") || message.startsWith("Add NOTION_") ? 503 : 502;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
