import { NextRequest, NextResponse } from "next/server";
import { hasPlannerAccess } from "@/lib/access";
import { getGitHubRepositorySnapshot, listGitHubRepositories } from "@/lib/github-app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!await hasPlannerAccess()) {
    return NextResponse.json({ error: "You are not authorized to access GitHub data." }, { status: 403 });
  }
  try {
    const repository = request.nextUrl.searchParams.get("repository");
    if (request.nextUrl.searchParams.size > Number(Boolean(repository))) {
      return NextResponse.json({ error: "Unsupported GitHub query parameter." }, { status: 400 });
    }
    const data = repository ? await getGitHubRepositorySnapshot(repository) : await listGitHubRepositories();
    return NextResponse.json(repository ? { configured: true, snapshot: data } : { configured: true, repositories: data }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load GitHub data.";
    const missingConfig = message.startsWith("Set GITHUB_");
    return NextResponse.json({ configured: !missingConfig, error: message }, {
      status: missingConfig ? 503 : 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
