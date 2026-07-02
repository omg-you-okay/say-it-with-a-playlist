// Cookie names and shared options for the auth flow. Setting/reading the
// cookies is HTTP transport and happens in the route handlers; this module just
// keeps the names and security options in one place so login and callback agree.

export const OAUTH_STATE_COOKIE = "spotify_oauth_state";

// The state cookie only has to survive the round trip to Spotify and back.
export const OAUTH_STATE_MAX_AGE = 60 * 10; // 10 minutes, in seconds

export interface BaseCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
}

/**
 * Shared cookie hardening: httpOnly (invisible to client JS, per ADR 0002),
 * SameSite=Lax, root path, and Secure only in production (the loopback dev URL
 * is plain http, which would drop a Secure cookie).
 */
export function baseCookieOptions(): BaseCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  };
}

/**
 * The one idiom for clearing a cookie: overwrite it with an immediately
 * expiring value carrying the same attributes (path, secure) it was set with —
 * a delete with mismatched attributes leaves the original cookie standing.
 */
export function expiredCookieOptions(): BaseCookieOptions & { maxAge: 0 } {
  return { ...baseCookieOptions(), maxAge: 0 };
}
