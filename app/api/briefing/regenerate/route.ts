import { NextResponse } from "next/server";
import { handleDailyBriefingRequest } from "@/lib/daily-briefing-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) {
    return NextResponse.json({ error: "This request must come from the dashboard." }, { status: 403 });
  }
  try {
    if (new URL(origin).host !== host) {
      return NextResponse.json({ error: "This request must come from the dashboard." }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "This request must come from the dashboard." }, { status: 403 });
  }
  return handleDailyBriefingRequest(request, true);
}
