import { NextResponse } from "next/server";
import { hasPlannerAccess } from "@/lib/access";
import { getPlannerAssistantAnswer, getPlannerAssistantPlan } from "@/lib/gemini";
import { fetchNotionTaskOptions, fetchNotionTasks } from "@/lib/notion";
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
  if (Object.keys(values).some((key) => key !== "mode" && key !== "question")) {
    return NextResponse.json({ error: "The request contains an unsupported field." }, { status: 400 });
  }
  if (values.mode !== "suggest" && values.mode !== "ask" && values.mode !== "plan") {
    return NextResponse.json({ error: "Choose a valid assistant action." }, { status: 400 });
  }
  if (values.mode !== "suggest" && (typeof values.question !== "string" || !values.question.trim())) {
    return NextResponse.json({ error: "Enter an instruction or question for your planner." }, { status: 400 });
  }
  if (values.question !== undefined && (typeof values.question !== "string" || values.question.length > 1000)) {
    return NextResponse.json({ error: "Instructions must be 1,000 characters or fewer." }, { status: 400 });
  }

  try {
    if (values.mode === "plan") {
      const [tasks, options] = await Promise.all([fetchNotionTasks(), fetchNotionTaskOptions()]);
      const plan = await getPlannerAssistantPlan(values.question as string, tasks, options);
      return NextResponse.json({ plan }, { headers: { "Cache-Control": "no-store" } });
    }
    const tasks = await fetchNotionTasks();
    const answer = await getPlannerAssistantAnswer(values.mode, values.question as string | undefined, tasks);
    return NextResponse.json({ answer }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The planner assistant could not respond.";
    const status = message.startsWith("Add GEMINI_API_KEY") || message.startsWith("Add NOTION_") ? 503 : 502;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
