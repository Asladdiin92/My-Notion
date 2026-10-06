import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hasPlannerUserAccess } from "@/lib/access";
import {
  archiveAIConversation,
  deleteAIConversation,
  getAIConversation,
  serializeAIConversation,
  validateConversationId,
} from "@/lib/ai-conversations";
import { isSameOrigin } from "@/lib/task-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ conversationId: string }> };

async function authorizedUser() {
  let userId: string | null;
  try {
    ({ userId } = await auth());
  } catch {
    return { response: NextResponse.json({ error: "Authentication is temporarily unavailable." }, { status: 503 }) };
  }
  if (!userId) {
    return { response: NextResponse.json({ error: "Sign in to manage conversations." }, { status: 401 }) };
  }
  try {
    if (!await hasPlannerUserAccess(userId)) {
      return { response: NextResponse.json({ error: "You are not authorized to use this planner." }, { status: 403 }) };
    }
  } catch {
    return { response: NextResponse.json({ error: "Authorization is temporarily unavailable." }, { status: 503 }) };
  }
  return { userId };
}

async function routeConversationId(context: RouteContext): Promise<string> {
  return validateConversationId((await context.params).conversationId);
}

export async function GET(_request: Request, context: RouteContext) {
  const access = await authorizedUser();
  if (!access.userId) return access.response;
  try {
    const conversationId = await routeConversationId(context);
    const conversation = await getAIConversation(access.userId, conversationId);
    if (!conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    return NextResponse.json({ conversation: serializeAIConversation(conversation) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("A valid conversation ID")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("AI conversation retrieval failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Conversation could not be loaded." }, { status: 503 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const access = await authorizedUser();
  if (!access.userId) return access.response;
  if (!isSameOrigin(request)) return NextResponse.json({ error: "This request must come from the dashboard." }, { status: 403 });
  try {
    const body = await request.json() as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).length !== 1 || (body as Record<string, unknown>).archived !== true) {
      return NextResponse.json({ error: "Send { archived: true } to archive the conversation." }, { status: 400 });
    }
    const conversationId = await routeConversationId(context);
    const archived = await archiveAIConversation(access.userId, conversationId);
    if (!archived) return NextResponse.json({ error: "Conversation not found or already archived." }, { status: 404 });
    return NextResponse.json({ status: "archived", conversationId }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("A valid conversation ID")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("AI conversation archive failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Conversation could not be archived." }, { status: 503 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const access = await authorizedUser();
  if (!access.userId) return access.response;
  if (!isSameOrigin(request)) return NextResponse.json({ error: "This request must come from the dashboard." }, { status: 403 });
  try {
    const conversationId = await routeConversationId(context);
    const deleted = await deleteAIConversation(access.userId, conversationId);
    if (!deleted) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    return NextResponse.json({ status: "deleted", conversationId }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("A valid conversation ID")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("AI conversation deletion failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Conversation could not be deleted." }, { status: 503 });
  }
}
