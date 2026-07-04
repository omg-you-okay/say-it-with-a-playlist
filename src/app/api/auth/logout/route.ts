import { NextResponse } from "next/server";

import { expiredCookieOptions } from "@/server/shared/cookies";
import { SESSION_COOKIE } from "@/server/shared/session";

// POST /api/auth/logout — clear the session cookie. Logout is just dropping the
// cookie (ADR 0002); the Spotify tokens stay in the database untouched.
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", expiredCookieOptions());
  return response;
}
