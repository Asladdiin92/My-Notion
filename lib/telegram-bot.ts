import "server-only";

import { timingSafeEqual } from "node:crypto";

const TELEGRAM_API = "https://api.telegram.org";

export function telegramBotConfig(): { token: string; secret: string; username: string } {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const username = (process.env.TELEGRAM_BOT_USERNAME ?? "").replace(/^@/, "");
  if (!token || !secret || !username) {
    throw new Error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and TELEGRAM_BOT_USERNAME to enable Telegram.");
  }
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret) || !/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    throw new Error("Check the Telegram bot username and webhook secret format.");
  }
  return { token, secret, username };
}

export function verifyTelegramWebhookSecret(received: string | null): boolean {
  if (!received) return false;
  let secret: string;
  try {
    secret = telegramBotConfig().secret;
  } catch {
    return false;
  }
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(secret);
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}

export type TelegramButton = { text: string; callback_data: string };

export async function telegramRequest<T>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { token } = telegramBotConfig();
  let response: Response;
  try {
    response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("Telegram took too long to respond. Please try again.");
    }
    throw new Error("Could not connect to Telegram. Check the bot token and network.");
  }
  let result: { ok?: boolean; description?: string; result?: T };
  try {
    if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
      throw new Error("Non-JSON response.");
    }
    result = await response.json();
  } catch {
    throw new Error(`Telegram returned an unreadable response (HTTP ${response.status}).`);
  }
  if (!response.ok || result.ok !== true) {
    throw new Error(result.description || `Telegram request failed (HTTP ${response.status}).`);
  }
  if (result.result === undefined) throw new Error("Telegram returned an empty response.");
  return result.result;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  inlineKeyboard?: TelegramButton[][],
): Promise<void> {
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4000),
    ...(inlineKeyboard ? { reply_markup: { inline_keyboard: inlineKeyboard } } : {}),
    disable_web_page_preview: true,
  });
}

export async function answerTelegramCallback(callbackQueryId: string, text: string): Promise<void> {
  await telegramRequest("answerCallbackQuery", { callback_query_id: callbackQueryId, text: text.slice(0, 180) });
}

export async function configureTelegramWebhook(webhookUrl: string): Promise<void> {
  const { secret } = telegramBotConfig();
  const url = new URL(webhookUrl);
  if (url.protocol !== "https:" || url.pathname !== "/api/telegram/webhook" || url.search || url.hash) {
    throw new Error("TELEGRAM_WEBHOOK_URL must be the HTTPS URL ending in /api/telegram/webhook.");
  }
  const webhook = await telegramRequest<boolean>("setWebhook", {
    url: url.toString(),
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
  });
  if (!webhook) throw new Error("Telegram did not confirm the webhook setup.");
  await telegramRequest("setMyCommands", {
    commands: [
      { command: "start", description: "Link your dashboard account or show help" },
      { command: "summary", description: "Get planner task counts" },
      { command: "tasks", description: "List upcoming planner tasks" },
      { command: "create", description: "Propose a task for approval" },
      { command: "edit", description: "Propose a task edit for approval" },
      { command: "cancel", description: "Cancel a pending action" },
    ],
  });
}
