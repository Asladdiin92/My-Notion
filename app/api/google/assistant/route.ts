import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { hasPlannerAccess } from "@/lib/access";
import { getPersonalSecretaryAnswer } from "@/lib/gemini";
import { fetchGoogleWorkspaceSummary, readGoogleSession } from "@/lib/google-workspace";
import { fetchNotionTasks } from "@/lib/notion";
import { isSameOrigin } from "@/lib/task-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!await hasPlannerAccess()) {
    return NextResponse.json({ error: "You are not authorized to use this assistant." }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "This request must come from the dashboard." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > 40 * 1024) {
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
  if (Object.keys(values).some((key) => key !== "question") ||
      typeof values.question !== "string" || !values.question.trim() || values.question.length > 1000) {
    return NextResponse.json({ error: "Enter a question of 1,000 characters or fewer." }, { status: 400 });
  }

  const { userId } = await auth();
  const session = userId ? readGoogleSession(request, userId) : null;
  if (!session) {
    return NextResponse.json({ error: "Connect or reconnect Google before asking the personal secretary." }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const [tasks, workspace] = await Promise.all([
      fetchNotionTasks(),
      fetchGoogleWorkspaceSummary(session, true),
    ]);
    const answer = await getPersonalSecretaryAnswer(values.question, tasks, workspace);
    return NextResponse.json({ answer }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The personal secretary could not respond.";
    const status = message.includes("Google session expired") ? 401
      : message.startsWith("Add GEMINI_API_KEY") || message.startsWith("Add NOTION_") ? 503
        : 502;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
