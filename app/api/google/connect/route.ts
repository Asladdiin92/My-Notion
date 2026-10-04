import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { hasPlannerAccess } from "@/lib/access";
import {
  createGoogleOAuthState,
  googleAuthorizationUrl,
  googleOAuthCookieNames,
} from "@/lib/google-workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!await hasPlannerAccess()) return NextResponse.redirect(new URL("/sign-in", request.url));
  const { userId } = await auth();
  if (!userId) return NextResponse.redirect(new URL("/sign-in", request.url));

  try {
    const { nonce, state } = createGoogleOAuthState(userId);
    const response = NextResponse.redirect(googleAuthorizationUrl(state, request.url));
    response.cookies.set(googleOAuthCookieNames().state, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/google",
      maxAge: 600,
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/?google=setup-error", request.url));
  }
}
