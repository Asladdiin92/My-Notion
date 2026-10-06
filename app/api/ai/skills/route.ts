import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hasPlannerAccess } from "@/lib/access";
import { createAISkill, listAISkills, serializeAISkill, validateNewAISkill } from "@/lib/ai-skills";
import { isSameOrigin } from "@/lib/task-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 8 * 1024;

export async function GET() {
  if (!await hasPlannerAccess()) {
    return NextResponse.json({ error: "You are not authorized to access AI skills." }, { status: 403 });
  }
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in before accessing AI skills." }, { status: 401 });

  try {
    const skills = await listAISkills(userId);
    return NextResponse.json({ skills: skills.map(serializeAISkill) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("AI skill listing failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "AI skills are temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export async function POST(request: Request) {
  if (!await hasPlannerAccess()) {
    return NextResponse.json({ error: "You are not authorized to manage AI skills." }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "This request must come from the dashboard." }, { status: 403 });
  }
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in before managing AI skills." }, { status: 401 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Send AI skills as a JSON request." }, { status: 415 });
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "AI skill requests must be 8 KB or smaller." }, { status: 413 });
    }
    body = JSON.parse(text) as unknown;
  } catch {
    return NextResponse.json({ error: "Send a valid AI skill request." }, { status: 400 });
  }

  let skill;
  try {
    skill = validateNewAISkill(body);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "The AI skill is invalid.",
    }, { status: 400 });
  }

  try {
    const created = await createAISkill(userId, skill);
    return NextResponse.json({ skill: serializeAISkill(created) }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("AI skill creation failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "AI skill could not be saved." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
