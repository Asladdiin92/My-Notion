import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hasPlannerUserAccess } from "@/lib/access";
import { getMongoHealthStatus } from "@/lib/mongodb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  let userId: string | null;
  try {
    ({ userId } = await auth());
  } catch (error) {
    console.error("MongoDB health authorization failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ status: "error" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!userId) {
    return NextResponse.json({ status: "error" }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    if (!await hasPlannerUserAccess(userId)) {
      return NextResponse.json({ status: "error" }, {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const status = await getMongoHealthStatus();
    if (status !== "connected") {
      return NextResponse.json({ status: "error" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json({ status: "connected" }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("MongoDB health check failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ status: "error" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
