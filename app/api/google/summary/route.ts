import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { hasPlannerAccess } from "@/lib/access";
import { fetchGoogleWorkspaceSummary, readGoogleSession } from "@/lib/google-workspace";
import type { GoogleWorkspaceSummary } from "@/lib/google-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const emptySummary: GoogleWorkspaceSummary = {
  connected: false,
  unreadEmails: 0,
  messages: [],
  events: [],
  files: [],
};

export async function GET(request: NextRequest) {
  if (!await hasPlannerAccess()) {
    return NextResponse.json({ error: "You are not authorized to access this workspace." }, { status: 403 });
  }
  const { userId } = await auth();
  const session = userId ? readGoogleSession(request, userId) : null;
  if (!session) {
    return NextResponse.json(emptySummary, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const summary = await fetchGoogleWorkspaceSummary(session);
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Google workspace data.";
    if (message.includes("Google session expired")) {
      return NextResponse.json(emptySummary, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ ...emptySummary, connected: true, email: session.email, error: message }, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
