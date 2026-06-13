import { jwtVerify, SignJWT } from "jose";

import { requireEnv } from "./env";

// App session = an httpOnly, SameSite=Lax, signed JWT cookie whose payload is
// only the app user id (ADR 0002). Spotify tokens never go in here — they stay
// in the database. This module is the pure sign/verify core; setting and
// reading the cookie itself lives in the route handlers (HTTP transport).

export const SESSION_COOKIE = "siwap_session";

// 7 days, in seconds — used both for the JWT expiry and the cookie Max-Age.
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

// HS256 is only as strong as the secret. Reject anything too short to brute-force
// safely — a weak SESSION_SECRET makes session JWTs forgeable.
const MIN_SECRET_LENGTH = 32;

function secretKey(): Uint8Array {
  const secret = requireEnv("SESSION_SECRET");
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters (generate with: openssl rand -base64 32)`,
    );
  }
  return new TextEncoder().encode(secret);
}

/** Mint a signed session token carrying the app user id as the JWT subject. */
export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secretKey());
}

/**
 * Verify a session token and return the app user id, or `null` if the token is
 * missing, malformed, tampered with, or expired.
 */
export async function readSessionToken(
  token: string | undefined,
): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
