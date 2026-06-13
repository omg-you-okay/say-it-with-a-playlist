import { NextResponse } from "next/server";

import { createUserManager } from "@/server/identity/managers/UserManager";
import {
  baseCookieOptions,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE,
} from "@/server/shared/cookies";

// GET /api/auth/login — start the Spotify OAuth round trip.
//
// Stash the CSRF `state` in a short-lived httpOnly cookie and redirect the user
// to Spotify's consent screen. The matching half lives in the callback handler.
export async function GET() {
  const { authorizeUrl, state } = createUserManager().beginLogin();

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    ...baseCookieOptions(),
    maxAge: OAUTH_STATE_MAX_AGE,
  });
  return response;
}
