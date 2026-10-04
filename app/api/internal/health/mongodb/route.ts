import { NextResponse } from "next/server";
import { hasPlannerAccess } from "@/lib/access";
import { getMongoHealthStatus } from "@/lib/mongodb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    if (!await hasPlannerAccess()) {
      return NextResponse.json({ status: "error" }, {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const status = await getMongoHealthStatus();
    return NextResponse.json({ status }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "error" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
