import { randomUUID } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { hasPlannerAccess } from "@/lib/access";
import { getGitHubRepositorySnapshot, performGitHubAction } from "@/lib/github-app";
import { consumeGitHubPendingAction, createGitHubPendingAction } from "@/lib/integration-store";
import { isSameOrigin } from "@/lib/task-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const actions = new Set(["create_issue", "comment_issue", "comment_pull_request", "create_pull_request"]);
const actionNames: Record<string, string> = {
  create_issue: "Create issue",
  comment_issue: "Comment on issue",
  comment_pull_request: "Comment on pull request",
  create_pull_request: "Create pull request",
};

async function readActionBody(request: NextRequest): Promise<{ value?: unknown; status?: number }> {
  const limit = 24 * 1024;
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > limit) return { status: 413 };
  const reader = request.body?.getReader();
  if (!reader) return { status: 400 };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return { status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { status: 400 };
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { status: 400 };
  }
}

function validateInput(body: Record<string, unknown>) {
  const allowedFields = new Set(["phase", "action", "repository", "title", "body", "number", "head", "base"]);
  if (Object.keys(body).some((key) => !allowedFields.has(key)) ||
      typeof body.action !== "string" || !actions.has(body.action) ||
      typeof body.repository !== "string" || body.repository.length > 200 ||
      (body.title !== undefined && (typeof body.title !== "string" || body.title.length > 256)) ||
      (body.body !== undefined && (typeof body.body !== "string" || body.body.length > 20_000)) ||
      (body.number !== undefined && (typeof body.number !== "number" || !Number.isSafeInteger(body.number))) ||
      (body.head !== undefined && (typeof body.head !== "string" || body.head.length > 255)) ||
      (body.base !== undefined && (typeof body.base !== "string" || body.base.length > 255))) {
    return null;
  }
  return {
    action: body.action as "create_issue" | "comment_issue" | "comment_pull_request" | "create_pull_request",
    input: {
      repository: body.repository,
      title: body.title as string | undefined,
      body: body.body as string | undefined,
      number: body.number as number | undefined,
      head: body.head as string | undefined,
      base: body.base as string | undefined,
    },
  };
}

async function validateTarget(action: NonNullable<ReturnType<typeof validateInput>>["action"], input: NonNullable<ReturnType<typeof validateInput>>["input"]) {
  const snapshot = await getGitHubRepositorySnapshot(input.repository);
  if ((action === "comment_issue" && !snapshot.issues.some((item) => item.number === input.number)) ||
      (action === "comment_pull_request" && !snapshot.pullRequests.some((item) => item.number === input.number))) {
    throw new Error("The selected open issue or pull request is not available in this repository.");
  }
  if (action === "create_pull_request" &&
      (!snapshot.branches.includes(input.head ?? "") || !snapshot.branches.includes(input.base ?? "") ||
        input.head === input.base)) {
    throw new Error("Choose two different existing branches for the pull request.");
  }
  if (action === "create_issue" && !input.title?.trim()) throw new Error("Enter an issue title.");
  if ((action === "comment_issue" || action === "comment_pull_request") && !input.body?.trim()) {
    throw new Error("Enter a comment before continuing.");
  }
  if (action === "create_pull_request" && !input.title?.trim()) throw new Error("Enter a pull request title.");
}

export async function POST(request: NextRequest) {
  if (!await hasPlannerAccess()) {
    return NextResponse.json({ error: "You are not authorized to update GitHub." }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "This request must come from the dashboard." }, { status: 403 });
  }
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Sign in before updating GitHub." }, { status: 401 });

  const parsed = await readActionBody(request);
  if (parsed.status === 413) return NextResponse.json({ error: "GitHub action request is too large." }, { status: 413 });
  if (parsed.status) return NextResponse.json({ error: "Send a valid GitHub action request." }, { status: 400 });
  const value = parsed.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return NextResponse.json({ error: "Send a valid GitHub action request." }, { status: 400 });
  }
  const body = value as Record<string, unknown>;
  try {
    if (body.phase === "confirm" && typeof body.approvalId === "string" &&
        /^[0-9a-f-]{36}$/i.test(body.approvalId) && Object.keys(body).every((key) => ["phase", "approvalId"].includes(key))) {
      const pending = await consumeGitHubPendingAction(body.approvalId, userId);
      if (!pending) {
        return NextResponse.json({ error: "This GitHub proposal expired or was already handled. Review the action again." }, { status: 409 });
      }
      const result = await performGitHubAction(pending.action, pending.input);
      return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
    }

    if (body.phase !== "propose") {
      return NextResponse.json({ error: "Review the GitHub action before confirming it." }, { status: 400 });
    }
    const proposal = validateInput(body);
    if (!proposal) return NextResponse.json({ error: "Check the GitHub action fields and try again." }, { status: 400 });
    await validateTarget(proposal.action, proposal.input);
    const approvalId = randomUUID();
    await createGitHubPendingAction({ id: approvalId, userId, ...proposal });
    return NextResponse.json({
      approvalId,
      actionName: actionNames[proposal.action],
      repository: proposal.input.repository,
      expiresInSeconds: 600,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not complete the GitHub action.";
    const status = message.startsWith("Set GITHUB_") || message.startsWith("Set MONGO_") ? 503 : 502;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
