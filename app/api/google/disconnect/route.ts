import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { hasPlannerAccess } from "@/lib/access";
import { clearGoogleCookie, googleOAuthCookieNames, readGoogleSession, revokeGoogleAccess } from "@/lib/google-workspace";
import { isSameOrigin } from "@/lib/task-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!await hasPlannerAccess()) {
    return NextResponse.json({ error: "You are not authorized to update this workspace." }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "This request must come from the dashboard." }, { status: 403 });
  }
  const { userId } = await auth();
  const session = userId ? readGoogleSession(request, userId) : null;
  if (session) {
    try {
      await revokeGoogleAccess(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not revoke the Google access token.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  clearGoogleCookie(response, googleOAuthCookieNames().token);
  return response;
}
