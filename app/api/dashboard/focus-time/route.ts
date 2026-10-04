import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hasPlannerUserAccess } from "@/lib/access";
import { getFocusMinutesToday } from "@/lib/focus-sessions";

export const dynamic = "force-dynamic";

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value.length <= 100;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  let userId: string | null;
  try {
    ({ userId } = await auth());
  } catch (error) {
    console.error("Focus metric authentication failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Focus time is temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!userId) {
    return NextResponse.json({ error: "Sign in to view focus time." }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const timeZones = new URL(request.url).searchParams.getAll("timezone");
  const timeZone = timeZones[0];
  if (timeZones.length !== 1 || !timeZone || !validTimeZone(timeZone)) {
    return NextResponse.json({ error: "Provide a valid timezone." }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    if (!await hasPlannerUserAccess(userId)) {
      return NextResponse.json({ error: "You are not authorized to view focus time." }, {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const generatedAt = new Date();
    const focusMinutesToday = await getFocusMinutesToday(userId, timeZone, generatedAt);
    return NextResponse.json({ focusMinutesToday, generatedAt: generatedAt.toISOString() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Focus metric unavailable.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Focus time is temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
