import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { hasPlannerUserAccess } from "@/lib/access";
import {
  cancelTelegramPendingActions,
  claimTelegramUpdate,
  completeTelegramUpdate,
  consumeTelegramPairingCode,
  consumeTelegramPendingAction,
  createTelegramPendingAction,
  findTelegramLinkByChat,
  linkTelegramAccount,
  releaseTelegramUpdate,
  type TelegramPendingAction,
  type TelegramPendingInput,
} from "@/lib/integration-store";
import { createNotionTask, fetchNotionTasks, updateNotionTask } from "@/lib/notion";
import { plannerDateKey, todayInPlannerTimeZone } from "@/lib/planner-datetime";
import { answerTelegramCallback, sendTelegramMessage, verifyTelegramWebhookSecret } from "@/lib/telegram-bot";
import type { Task } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TelegramChat = { id: number; type?: string };
type TelegramUser = { id: number };
type TelegramMessage = { chat: TelegramChat; from?: TelegramUser; text?: string };
type TelegramCallback = {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: { chat: TelegramChat; message_id: number };
};
type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallback;
};

function isTelegramUpdate(value: unknown): value is TelegramUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const update = value as Record<string, unknown>;
  if (!Number.isSafeInteger(update.update_id)) return false;
  if (update.message !== undefined) {
    const message = update.message;
    return Boolean(message && typeof message === "object" && !Array.isArray(message) &&
      "chat" in message && typeof message.chat === "object" && message.chat !== null &&
      "id" in message.chat && Number.isSafeInteger(message.chat.id));
  }
  if (update.callback_query !== undefined) {
    const callback = update.callback_query;
    return Boolean(callback && typeof callback === "object" && !Array.isArray(callback) &&
      "id" in callback && typeof callback.id === "string" &&
      "from" in callback && typeof callback.from === "object" && callback.from !== null &&
      "id" in callback.from && Number.isSafeInteger(callback.from.id));
  }
  return false;
}

function splitCommand(text: string): { command: string; args: string } {
  const match = text.trim().match(/^\/([a-z]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  return match ? { command: match[1].toLowerCase(), args: (match[2] ?? "").trim() } : { command: "", args: "" };
}

function taskCounts(tasks: Task[]) {
  const today = todayInPlannerTimeZone();
  const open = tasks.filter((task) => !task.completed);
  const overdue = open.filter((task) => {
    const due = task.dateEnd || task.dueDate;
    return Boolean(due) && plannerDateKey(due!) < today;
  }).length;
  const dueToday = open.filter((task) =>
    task.dueDate && plannerDateKey(task.dueDate) <= today &&
    plannerDateKey(task.dateEnd || task.dueDate) >= today
  ).length;
  return { open: open.length, dueToday, overdue };
}

async function confirmMessage(
  chatId: string,
  action: TelegramPendingInput,
  description: string,
): Promise<void> {
  await createTelegramPendingAction(action);
  await sendTelegramMessage(chatId, `${description}\n\nThis proposal expires in 10 minutes. Nothing changes until you confirm.`, [[
    { text: "Confirm", callback_data: `approve:${action.id}` },
    { text: "Cancel", callback_data: `reject:${action.id}` },
  ]]);
}

function taskForEditInput(task: Task, patch: Record<string, string>) {
  return {
    title: patch.title ?? task.title,
    type: task.type,
    status: patch.status ?? task.status,
    priority: patch.priority ?? task.priority,
    area: task.area,
    course: task.course,
    courseCode: task.courseCode,
    estimatedHours: task.estimatedHours,
    actualHours: task.actualHours,
    assessment: task.assessment,
    notes: task.notes,
    recurrence: task.recurrence,
    nextAction: patch.nextAction ?? task.nextAction,
    dueDate: patch.dueDate ?? task.dueDate ?? "",
    dateEnd: task.dateEnd ?? "",
    deliverable: task.deliverable,
    semester: task.semester,
  };
}

async function executeTelegramApproval(action: TelegramPendingAction): Promise<string> {
  if (action.action === "create") {
    const task = await createNotionTask({ title: action.title });
    return `Created “${task.title}” in your Notion planner.`;
  }
  const tasks = await fetchNotionTasks();
  const task = tasks.find((item) => item.id === action.taskId);
  if (!task) throw new Error("That planner item no longer exists. The proposed edit was not applied.");
  const updated = await updateNotionTask(task.id, taskForEditInput(task, action.patch));
  return `Updated “${updated.title}” in your Notion planner.`;
}

async function handleCallback(callback: TelegramCallback): Promise<void> {
  const chat = callback.message?.chat;
  const match = callback.data?.match(/^(approve|reject):([0-9a-f-]{36})$/i);
  if (!chat || !Number.isSafeInteger(chat.id) || !match) {
    await answerTelegramCallback(callback.id, "This approval link is invalid.");
    return;
  }
  const chatId = String(chat.id);
  const link = await findTelegramLinkByChat(chatId);
  if (!link || link.telegramUserId !== String(callback.from.id) || !await hasPlannerUserAccess(link.userId)) {
    await answerTelegramCallback(callback.id, "Reconnect your authorized dashboard account.");
    return;
  }
  const pending = await consumeTelegramPendingAction(match[2], chatId);
  if (!pending || pending.userId !== link.userId) {
    await answerTelegramCallback(callback.id, "This proposal expired or was already handled.");
    return;
  }
  await answerTelegramCallback(callback.id, match[1] === "approve" ? "Applying your confirmed action…" : "Action cancelled.");
  if (match[1] === "reject") {
    await sendTelegramMessage(chatId, "Cancelled. Your Notion planner was not changed.");
    return;
  }
  try {
    const message = await executeTelegramApproval(pending);
    await sendTelegramMessage(chatId, message);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The approved action could not be completed.";
    await sendTelegramMessage(chatId, `The approval was used, but the action did not report success: ${reason}\nCheck Notion before submitting it again.`);
  }
}

async function handleMessage(message: TelegramMessage): Promise<void> {
  const chatIdNumber = message.chat.id;
  if (!Number.isSafeInteger(chatIdNumber) || message.chat.type !== "private" || !message.from || !message.text) return;
  const chatId = String(chatIdNumber);
  const senderId = String(message.from.id);
  const { command, args } = splitCommand(message.text);
  if (command === "start" && args) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(args)) {
      await sendTelegramMessage(chatId, "That account-link code is invalid or expired. Start a new link from your signed-in dashboard.");
      return;
    }
    const userId = await consumeTelegramPairingCode(args);
    if (!userId || !await hasPlannerUserAccess(userId)) {
      await sendTelegramMessage(chatId, "That account-link code expired or your dashboard account is not authorized. Start a new link from the dashboard.");
      return;
    }
    await linkTelegramAccount(userId, chatId, senderId);
    await sendTelegramMessage(chatId, "Your Telegram account is linked to the authorized dashboard. Use /help to see commands.");
    return;
  }

  const link = await findTelegramLinkByChat(chatId);
  if (!link || link.telegramUserId !== senderId || !await hasPlannerUserAccess(link.userId)) {
    await sendTelegramMessage(chatId, "Link this private chat from the signed-in dashboard before using planner commands.");
    return;
  }
  if (command === "start" || command === "help") {
    await sendTelegramMessage(chatId, [
      "Planner commands:",
      "/summary — task counts only",
      "/tasks — up to 8 incomplete tasks with status/deadline",
      "/create <title> — propose creating a task",
      "/edit <task-id> <field>=<value> — propose title, priority, status, due, or nextAction change",
      "/cancel — cancel your pending proposals",
      "Create/edit actions change Notion only after you tap Confirm.",
    ].join("\n"));
    return;
  }
  if (command === "summary") {
    const counts = taskCounts(await fetchNotionTasks());
    await sendTelegramMessage(chatId, `Planner summary\nOpen: ${counts.open}\nDue today: ${counts.dueToday}\nOverdue: ${counts.overdue}`);
    return;
  }
  if (command === "tasks") {
    const tasks = (await fetchNotionTasks()).filter((task) => !task.completed).slice(0, 8);
    if (!tasks.length) {
      await sendTelegramMessage(chatId, "There are no incomplete planner tasks.");
      return;
    }
    const details = tasks.map((task) => {
      const due = task.dateEnd || task.dueDate;
      return `• ${task.title} — ${task.status}${due ? ` — ${plannerDateKey(due)}` : ""}`;
    });
    await sendTelegramMessage(chatId, `Incomplete planner tasks\n${details.join("\n")}`);
    return;
  }
  if (command === "create") {
    const title = args.trim();
    if (!title || title.length > 2000) {
      await sendTelegramMessage(chatId, "Usage: /create <task title> (up to 2,000 characters).");
      return;
    }
    const id = randomUUID();
    await confirmMessage(chatId, {
      id, userId: link.userId, chatId, action: "create", title,
    }, `Create planner task: ${title}`);
    return;
  }
  if (command === "edit") {
    const match = args.match(/^([0-9a-f-]{36})\s+(title|priority|status|due|nextAction)=(.+)$/i);
    if (!match || match[3].length > 2000) {
      await sendTelegramMessage(chatId, "Usage: /edit <task-id> title|priority|status|due|nextAction=<new value>.");
      return;
    }
    const task = (await fetchNotionTasks()).find((item) => item.id.toLowerCase() === match[1].toLowerCase());
    if (!task) {
      await sendTelegramMessage(chatId, "That planner task was not found. Use /tasks for current items.");
      return;
    }
    const key = match[2].toLowerCase();
    const field = key === "due" ? "dueDate" : key === "nextaction" ? "nextAction" : key;
    const patch = { [field]: match[3].trim() };
    const id = randomUUID();
    await confirmMessage(chatId, {
      id, userId: link.userId, chatId, action: "edit", taskId: task.id, patch,
    }, `Edit “${task.title}”: set ${field} to “${match[3].trim()}”`);
    return;
  }
  if (command === "cancel") {
    const count = await cancelTelegramPendingActions(chatId, link.userId);
    await sendTelegramMessage(chatId, count ? `Cancelled ${count} pending action${count === 1 ? "" : "s"}.` : "There are no pending actions to cancel.");
    return;
  }
  await sendTelegramMessage(chatId, "Unknown command. Send /help to see available planner commands.");
}

export async function POST(request: NextRequest) {
  if (!verifyTelegramWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ error: "Unauthorized Telegram webhook." }, { status: 401 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 32 * 1024) {
    return NextResponse.json({ error: "Telegram update is too large." }, { status: 413 });
  }

  let value: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: "Send a valid Telegram update." }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        totalSize += chunk.byteLength;
        if (totalSize > 32 * 1024) {
          await reader.cancel();
          return NextResponse.json({ error: "Telegram update is too large." }, { status: 413 });
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return NextResponse.json({ error: "Send a valid Telegram update." }, { status: 400 });
  }
  if (!isTelegramUpdate(value)) return NextResponse.json({ ok: true, ignored: true });

  const update = value;
  try {
    const claimed = await claimTelegramUpdate(update.update_id);
    if (!claimed) return NextResponse.json({ ok: true, duplicate: true });
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message) await handleMessage(update.message);
    await completeTelegramUpdate(update.update_id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    await releaseTelegramUpdate(update.update_id);
    const message = error instanceof Error ? error.message : "Telegram update could not be processed.";
    console.error("Telegram webhook processing failed:", message);
    return NextResponse.json({ error: "Telegram update could not be processed. Telegram may retry it." }, { status: 500 });
  }
}
