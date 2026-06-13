import { NextResponse } from "next/server";

import { baseCookieOptions } from "@/server/shared/cookies";
import { SESSION_COOKIE } from "@/server/shared/session";

// POST /api/auth/logout — clear the session cookie. Logout is just dropping the
// cookie (ADR 0002); the Spotify tokens stay in the database untouched.
export async function POST() {
  const response = NextResponse.json({ ok: true });
  // Overwrite with an immediately-expiring cookie so the same attributes
  // (path, secure) are used when clearing it.
  response.cookies.set(SESSION_COOKIE, "", {
    ...baseCookieOptions(),
    maxAge: 0,
  });
  return response;
}
