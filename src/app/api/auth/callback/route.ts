import { NextResponse, type NextRequest } from "next/server";

import {
  createUserManager,
  OAuthStateMismatchError,
} from "@/server/identity/managers/UserManager";
import {
  baseCookieOptions,
  expiredCookieOptions,
  OAUTH_STATE_COOKIE,
} from "@/server/shared/cookies";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/server/shared/session";

// GET /api/auth/callback — Spotify redirects here after consent.
//
// Validate the CSRF state, exchange the code for tokens (server-side), persist
// the user + tokens, and set the session cookie. On any failure we redirect
// home with an `auth_error` query param rather than leaking internals; the
// frontend (Iteration 4) renders it.

// Known OAuth 2.0 error codes Spotify may return on the callback. Anything
// outside this set is collapsed to a fixed code so a fully attacker-controlled
// `?error=` value is never reflected into the page the frontend renders.
const SPOTIFY_ERROR_CODES = new Set([
  "access_denied",
  "invalid_request",
  "invalid_scope",
  "unauthorized_client",
  "unsupported_response_type",
  "server_error",
  "temporarily_unavailable",
]);

function redirectHome(request: NextRequest, authError?: string): NextResponse {
  // `request.url`/`nextUrl` resolves its host to `localhost` under `next dev`
  // even when the request genuinely arrived on `127.0.0.1` (where Spotify's
  // redirect_uri points). Redirecting there would strand the session cookie —
  // set on the `127.0.0.1` callback response — on a different origin, logging
  // the user straight back out. Pin the redirect to the host the request
  // actually came in on, honouring proxy forwarding headers.
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    request.nextUrl.host;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(/:$/, "");
  const url = new URL("/", `${proto}://${host}`);
  if (authError) url.searchParams.set("auth_error", authError);
  const response = NextResponse.redirect(url);
  // The state cookie is one-shot: whatever the outcome, this callback consumes
  // it, so success and every failure path clear it here.
  response.cookies.set(OAUTH_STATE_COOKIE, "", expiredCookieOptions());
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // The user denied consent (or Spotify errored) — no code will be present.
  const spotifyError = params.get("error");
  if (spotifyError) {
    return redirectHome(
      request,
      SPOTIFY_ERROR_CODES.has(spotifyError) ? spotifyError : "spotify_error",
    );
  }

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
    return response;
  } catch (error) {
    if (error instanceof OAuthStateMismatchError) {
      return redirectHome(request, "state_mismatch");
    }
    console.error("OAuth callback failed", error);
    return redirectHome(request, "callback_failed");
  }
}
