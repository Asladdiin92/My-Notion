import { NextRequest, NextResponse } from "next/server";
import { hasPlannerAccess } from "@/lib/access";
import { configureTelegramWebhook } from "@/lib/telegram-bot";
import { isSameOrigin } from "@/lib/task-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!await hasPlannerAccess()) {
    return NextResponse.json({ error: "You are not authorized to configure Telegram." }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "This request must come from the dashboard." }, { status: 403 });
  }
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({ error: "Set TELEGRAM_WEBHOOK_URL before configuring the Telegram bot." }, { status: 503 });
  }
  try {
    await configureTelegramWebhook(webhookUrl);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not configure the Telegram webhook.";
    return NextResponse.json({ error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
