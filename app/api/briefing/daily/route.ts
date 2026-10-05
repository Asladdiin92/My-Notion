import { handleDailyBriefingRequest } from "@/lib/daily-briefing-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleDailyBriefingRequest(request, false);
}
