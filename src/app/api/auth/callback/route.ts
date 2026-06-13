import { NextResponse, type NextRequest } from "next/server";

import {
  createUserManager,
  OAuthStateMismatchError,
} from "@/server/identity/managers/UserManager";
import { baseCookieOptions, OAUTH_STATE_COOKIE } from "@/server/shared/cookies";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/server/shared/session";

// GET /api/auth/callback — Spotify redirects here after consent.
//
// Validate the CSRF state, exchange the code for tokens (server-side), persist
// the user + tokens, and set the session cookie. On any failure we redirect
// home with an `auth_error` query param rather than leaking internals; the
// frontend (Iteration 4) renders it.

function redirectHome(request: NextRequest, authError?: string): NextResponse {
  const url = new URL("/", request.url);
  if (authError) url.searchParams.set("auth_error", authError);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // The user denied consent (or Spotify errored) — no code will be present.
  const spotifyError = params.get("error");
  if (spotifyError) return redirectHome(request, spotifyError);

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return redirectHome(request, "missing_params");

  const storedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  try {
    const { sessionToken } = await createUserManager().handleCallback({
      code,
      state,
      storedState,
    });

    const response = redirectHome(request);
    response.cookies.set(SESSION_COOKIE, sessionToken, {
      ...baseCookieOptions(),
      maxAge: SESSION_MAX_AGE,
    });
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  } catch (error) {
    if (error instanceof OAuthStateMismatchError) {
      return redirectHome(request, "state_mismatch");
    }
    console.error("OAuth callback failed", error);
    return redirectHome(request, "callback_failed");
  }
}
