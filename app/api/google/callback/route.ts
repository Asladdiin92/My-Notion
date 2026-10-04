import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { hasPlannerAccess } from "@/lib/access";
import {
  exchangeGoogleCode,
  clearGoogleCookie,
  googleOAuthCookieNames,
  setGoogleSessionCookie,
  verifyGoogleOAuthState,
} from "@/lib/google-workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const redirect = (result: string) => NextResponse.redirect(new URL(`/?google=${result}`, request.url));
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code");
  const cookies = googleOAuthCookieNames();
  const nonce = request.cookies.get(cookies.state)?.value;
  const { userId } = await auth();
  let validState = false;
  try {
    validState = Boolean(userId && await hasPlannerAccess() &&
      verifyGoogleOAuthState(state, nonce, userId));
  } catch {
    const response = redirect("setup-error");
    clearGoogleCookie(response, cookies.state);
    return response;
  }
  if (!validState || !userId || !code) {
    const response = redirect("auth-error");
    clearGoogleCookie(response, cookies.state);
    return response;
  }

  try {
    const googleSession = await exchangeGoogleCode(code, request.url, userId);
    const response = redirect("connected");
    response.cookies.set(cookies.token, setGoogleSessionCookie(googleSession), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/google",
      expires: new Date(googleSession.expiresAt),
    });
    clearGoogleCookie(response, cookies.state);
    return response;
  } catch {
    const response = redirect("exchange-error");
    clearGoogleCookie(response, cookies.state);
    return response;
  }
}
