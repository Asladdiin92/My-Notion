import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hasPlannerUserAccess } from "@/lib/access";
import { getSystemAISkill } from "@/lib/ai-skills";
import {
  executeSkillHandler,
  getSkillHandler,
  parseListTasksParameters,
  type ListTasksParameters,
} from "@/lib/ai-skill-handlers";
import { isSameOrigin } from "@/lib/task-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 4 * 1024;

export async function POST(request: Request) {
  let userId: string | null;
  try {
    ({ userId } = await auth());
  } catch (error) {
    console.error("AI skill authentication failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Authentication is temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!userId) {
    return NextResponse.json({ error: "Sign in before executing an AI skill." }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }
  try {
    if (!await hasPlannerUserAccess(userId)) {
      return NextResponse.json({ error: "You are not authorized to use this planner." }, {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }
  } catch (error) {
    console.error("AI skill authorization failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Authorization is temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "This request must come from the dashboard." }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Send the skill request as JSON." }, {
      status: 415,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES)) {
    return NextResponse.json({ error: "The skill request is too large or has an invalid size." }, {
      status: 413,
      headers: { "Cache-Control": "no-store" },
    });
  }

  let input: unknown;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "The skill request is too large." }, {
        status: 413,
        headers: { "Cache-Control": "no-store" },
      });
    }
    input = JSON.parse(body) as unknown;
  } catch {
    return NextResponse.json({ error: "Send a valid JSON skill request." }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  let parameters: ListTasksParameters;
  try {
    parameters = parseListTasksParameters(input);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "The skill request is invalid.",
    }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const skill = await getSystemAISkill("list_tasks");
    if (!skill || !skill.enabled || skill.operationType !== "read" ||
        skill.approvalRequired !== false || !skill.allowedRoles?.includes("user")) {
      return NextResponse.json({ error: "The list_tasks skill is unavailable." }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (!skill.handler || !getSkillHandler(skill.handler)) {
      return NextResponse.json({ error: "The list_tasks skill handler is unavailable." }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const tasks = await executeSkillHandler(skill.handler, parameters);
    return NextResponse.json({
      status: "success",
      skill: {
        name: skill.name,
        displayName: skill.displayName ?? "List Tasks",
      },
      count: tasks.length,
      tasks,
      generatedAt: new Date().toISOString(),
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("AI skill execution failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "The list_tasks skill could not be completed." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
