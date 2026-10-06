import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hasPlannerUserAccess } from "@/lib/access";
import { orchestrateAsladinAI, type ApprovedListTasksSkill } from "@/lib/asladin-ai";
import { getSystemAISkill } from "@/lib/ai-skills";
import {
  appendAIConversationTurn,
  createAIConversation,
  getAIConversationContext,
  newAIConversationId,
  validateConversationId,
} from "@/lib/ai-conversations";
import { executeSkillHandler, getSkillHandler } from "@/lib/ai-skill-handlers";
import { generateGeminiContent } from "@/lib/gemini";
import { isSameOrigin } from "@/lib/task-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_MESSAGE_LENGTH = 2000;

class GeminiUnavailableError extends Error {
  constructor() {
    super("Gemini is unavailable.");
    this.name = "GeminiUnavailableError";
  }
}

async function generateAsladinContent(body: string) {
  try {
    return await generateGeminiContent(body);
  } catch {
    throw new GeminiUnavailableError();
  }
}

function parseAssistantRequest(input: unknown): { message: string; conversationId?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Send a JSON object containing a message.");
  }
  const values = input as Record<string, unknown>;
  if (Object.keys(values).some((key) => !["message", "conversationId"].includes(key))) {
    throw new Error("The assistant request contains unsupported fields.");
  }
  if (typeof values.message !== "string" || !values.message.trim() ||
      values.message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message must contain 1–${MAX_MESSAGE_LENGTH} characters.`);
  }
  return {
    message: values.message.trim(),
    ...(values.conversationId !== undefined
      ? { conversationId: validateConversationId(values.conversationId) }
      : {}),
  };
}

async function getApprovedListTasksSkill(): Promise<ApprovedListTasksSkill | null> {
  const skill = await getSystemAISkill("list_tasks");
  if (!skill || skill.name !== "list_tasks" || skill.enabled !== true ||
      skill.approvedForAI !== true || skill.operationType !== "read" ||
      skill.approvalRequired !== false || !skill.allowedRoles?.includes("user") ||
      typeof skill.handler !== "string" || !getSkillHandler(skill.handler)) {
    return null;
  }
  return {
    name: "list_tasks",
    enabled: true,
    approvedForAI: true,
    operationType: "read",
    approvalRequired: false,
    handler: skill.handler,
    allowedRoles: skill.allowedRoles,
  };
}

export async function POST(request: Request) {
  let userId: string | null;
  try {
    ({ userId } = await auth());
  } catch (error) {
    console.error("ASLADIN AI authentication failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Authentication is temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!userId) {
    return NextResponse.json({ error: "Sign in before using ASLADIN AI." }, {
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
    console.error("ASLADIN AI planner authorization failed.", {
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
    return NextResponse.json({ error: "Send the assistant request as JSON." }, {
      status: 415,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES)) {
    return NextResponse.json({ error: "The assistant request is too large or has an invalid size." }, {
      status: 413,
      headers: { "Cache-Control": "no-store" },
    });
  }

  let message: string;
  let conversationId: string;
  let isNewConversation: boolean;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "The assistant request is too large." }, {
        status: 413,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const assistantRequest = parseAssistantRequest(JSON.parse(body) as unknown);
    message = assistantRequest.message;
    isNewConversation = assistantRequest.conversationId === undefined;
    conversationId = assistantRequest.conversationId ?? newAIConversationId();
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Send a valid assistant request.",
    }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    let conversationContext = null;
    if (!isNewConversation) {
      conversationContext = await getAIConversationContext(userId, conversationId);
      if (!conversationContext) {
        return NextResponse.json({ error: "Conversation not found or archived." }, {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        });
      }
    }
    let result;
    try {
      result = await orchestrateAsladinAI(message, {
        generateContent: generateAsladinContent,
        getApprovedSkill: getApprovedListTasksSkill,
        getHandlerName: (name) => getSkillHandler(name) ? name : undefined,
        executeHandler: executeSkillHandler,
      }, conversationContext);
    } catch (error) {
      if (!(error instanceof GeminiUnavailableError)) throw error;
      result = {
        status: "fallback" as const,
        answer: "Gemini is unavailable right now. Please try again shortly.",
        toolUsed: null,
      };
    }

    try {
      const turn = {
        userMessage: message,
        assistantMessage: result.answer,
        ...(result.toolCallId ? { toolCallId: result.toolCallId } : {}),
      };
      if (isNewConversation) {
        await createAIConversation(userId, conversationId, {
          ...turn,
          ...(result.toolUsed ? { toolName: result.toolUsed } : {}),
        });
      } else {
        const saved = await appendAIConversationTurn(userId, conversationId, {
          ...turn,
          ...(result.toolUsed ? { toolName: result.toolUsed } : {}),
        });
        if (!saved) {
          return NextResponse.json({ error: "Conversation not found or archived." }, {
            status: 404,
            headers: { "Cache-Control": "no-store" },
          });
        }
      }
    } catch (error) {
      console.error("ASLADIN AI conversation persistence failed.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return NextResponse.json({ error: "ASLADIN AI conversation could not be saved." }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json({ ...result, conversationId }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.error("ASLADIN AI request failed.", { errorName });
    const missingConfiguration = error instanceof Error &&
      (error.message.startsWith("Add GEMINI_API_KEY") || error.message.startsWith("Add NOTION_"));
    return NextResponse.json({ error: "ASLADIN AI could not complete the request." }, {
      status: missingConfiguration ? 503 : 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
