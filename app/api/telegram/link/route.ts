import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { hasPlannerAccess } from "@/lib/access";
import {
  createTelegramPairingCode,
  getTelegramLink,
  unlinkTelegramAccount,
} from "@/lib/integration-store";
import { telegramBotConfig } from "@/lib/telegram-bot";
import { isSameOrigin } from "@/lib/task-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!await hasPlannerAccess()) {
    return NextResponse.json({ error: "You are not authorized to link Telegram." }, { status: 403 });
  }
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in before linking Telegram." }, { status: 401 });
  try {
    const link = await getTelegramLink(userId);
    const username = telegramBotConfig().username;
    return NextResponse.json({
      configured: true,
      linked: Boolean(link),
      botUsername: username,
      ...(link ? { linkedAt: link.linkedAt.toISOString() } : {}),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Telegram link status.";
    return NextResponse.json({ configured: false, linked: false, error: message }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export async function POST(request: NextRequest) {
  if (!await hasPlannerAccess()) {
    return NextResponse.json({ error: "You are not authorized to link Telegram." }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "This request must come from the dashboard." }, { status: 403 });
  }
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in before linking Telegram." }, { status: 401 });

  try {
    const { username } = telegramBotConfig();
    const code = await createTelegramPairingCode(userId);
    return NextResponse.json({
      botUrl: `https://t.me/${username}?start=${encodeURIComponent(code)}`,
      expiresInSeconds: 600,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start Telegram account linking.";
    return NextResponse.json({ error: message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(request: NextRequest) {
  if (!await hasPlannerAccess()) {
    return NextResponse.json({ error: "You are not authorized to unlink Telegram." }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "This request must come from the dashboard." }, { status: 403 });
  }
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in before unlinking Telegram." }, { status: 401 });
  try {
    await unlinkTelegramAccount(userId);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not unlink Telegram.";
    return NextResponse.json({ error: message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
