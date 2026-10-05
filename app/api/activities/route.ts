import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hasPlannerUserAccess } from "@/lib/access";
import { listActivities, MAX_ACTIVITY_PAGE_SIZE } from "@/lib/activities";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let userId: string | null;
  try {
    ({ userId } = await auth());
  } catch (error) {
    console.error("Activity authentication failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ ok: false, error: "Activities are temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Sign in to view activities." }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const searchParams = new URL(request.url).searchParams;
  const limits = searchParams.getAll("limit");
  const cursors = searchParams.getAll("cursor");
  const rawLimit = limits[0] ?? "10";
  const limit = /^\d{1,3}$/.test(rawLimit) ? Number(rawLimit) : Number.NaN;
  const cursor = cursors[0];
  if (limits.length > 1 || cursors.length > 1 || !Number.isInteger(limit) ||
      limit < 1 || limit > MAX_ACTIVITY_PAGE_SIZE || (cursor !== undefined && cursor.length > 512)) {
    return NextResponse.json({ ok: false, error: "Use a valid activity limit and cursor." }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    if (!await hasPlannerUserAccess(userId)) {
      return NextResponse.json({ ok: false, error: "You are not authorized to view activities." }, {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const page = await listActivities(userId, limit, cursor);
    const activities = page.activities.map((activity) => ({
      id: activity._id.toHexString(),
      type: activity.type,
      source: activity.source,
      title: activity.title,
      ...(activity.description !== undefined ? { description: activity.description } : {}),
      ...(activity.entityType !== undefined ? { entityType: activity.entityType } : {}),
      ...(activity.entityId !== undefined ? { entityId: activity.entityId } : {}),
      ...(activity.metadata !== undefined ? { metadata: activity.metadata } : {}),
      occurredAt: activity.occurredAt.toISOString(),
    }));
    return NextResponse.json({ ok: true, activities, nextCursor: page.nextCursor }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid activities cursor.") {
      return NextResponse.json({ ok: false, error: "Use a valid activity limit and cursor." }, {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      });
    }
    console.error("Activity listing failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ ok: false, error: "Activities are temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
