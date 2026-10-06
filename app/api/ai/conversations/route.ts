import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hasPlannerUserAccess } from "@/lib/access";
import {
  listAIConversations,
  serializeAIConversation,
} from "@/lib/ai-conversations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  let userId: string | null;
  try {
    ({ userId } = await auth());
  } catch {
    return NextResponse.json({ error: "Authentication is temporarily unavailable." }, { status: 503 });
  }
  if (!userId) return NextResponse.json({ error: "Sign in to view conversations." }, { status: 401 });
  try {
    if (!await hasPlannerUserAccess(userId)) {
      return NextResponse.json({ error: "You are not authorized to use this planner." }, { status: 403 });
    }
    const url = new URL(request.url);
    const limitText = url.searchParams.get("limit");
    const limit = limitText === null ? 50 : Number(limitText);
    const includeArchivedText = url.searchParams.get("includeArchived");
    if ((includeArchivedText !== null && !["true", "false"].includes(includeArchivedText)) ||
        (limitText !== null && !/^\d+$/.test(limitText))) {
      return NextResponse.json({ error: "Conversation query parameters are invalid." }, { status: 400 });
    }
    const conversations = await listAIConversations(
      userId,
      includeArchivedText === "true",
      limit,
    );
    return NextResponse.json({
      conversations: conversations.map(serializeAIConversation),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("AI conversation listing failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Conversations could not be loaded." }, { status: 503 });
  }
}
