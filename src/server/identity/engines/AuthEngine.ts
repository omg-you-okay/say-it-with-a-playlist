import { randomBytes } from "node:crypto";

// AuthEngine — the Spotify OAuth 2.0 Authorization Code logic (brief §5).
//
// Owns the OAuth protocol: building the authorize URL, exchanging an auth code
// for tokens, and refreshing them. It performs the Spotify token/profile HTTP
// calls but holds no storage — persistence is a Resource concern, orchestration
// a Manager concern. The HTTP transport (`fetchFn`) and clock (`now`) are
// injected so the engine is fully unit-testable without a network.

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const PROFILE_URL = "https://api.spotify.com/v1/me";

// Node's fetch has no practical default timeout; without one a hung Spotify
// call hangs the whole callback request.
const REQUEST_TIMEOUT_MS = 10_000;

// Scopes: read the profile (id/email) to key the user record, plus the
// playlist-write scopes the app exists to use — requested now so the user does
// not have to re-consent when playlist creation lands (Iteration 3).
const DEFAULT_SCOPES = [
  "user-read-email",
  "user-read-private",
  "playlist-modify-public",
  "playlist-modify-private",
];

export interface AuthEngineConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
  fetchFn?: typeof fetch;
  now?: () => number;
}

/** Normalized Spotify token set, ready to persist. */
export interface SpotifyTokenSet {
  accessToken: string;
  refreshToken: string;
  scope: string;
  tokenType: string;
  expiresAt: Date;
}

/** The slice of the Spotify user profile the Identity subsystem cares about. */
export interface SpotifyProfile {
  spotifyUserId: string;
  displayName: string | null;
  email: string | null;
}

interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
}

export interface AuthEngine {
  generateState(): string;
  buildAuthorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<SpotifyTokenSet>;
  refreshAccessToken(refreshToken: string): Promise<SpotifyTokenSet>;
  fetchProfile(accessToken: string): Promise<SpotifyProfile>;
}

/**
 * The grant is dead and no retry will revive it — the user revoked the app in
 * their Spotify account, or the refresh token was rotated out from under us.
 * Distinct from a transient Spotify failure precisely because the only way
 * forward is for the user to log in again, so callers can route it to the
 * re-auth path instead of showing a generic error (ADR 0017).
 */
export class ReauthRequiredError extends Error {
  constructor(detail?: string) {
    super(
      detail
        ? `Spotify rejected the grant: ${detail}`
        : "Spotify rejected the grant",
    );
    this.name = "ReauthRequiredError";
  }
}

/**
 * Spotify reports a dead grant as a JSON body `{"error":"invalid_grant", …}`.
 * Read it off the raw text we already captured for the error message — the body
 * is a one-shot stream, so it cannot be re-read as JSON afterwards.
 */
function isInvalidGrant(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { error?: unknown }).error === "invalid_grant"
    );
  } catch {
    return false; // not JSON — some other failure
  }
}

export function createAuthEngine(config: AuthEngineConfig): AuthEngine {
  const fetchFn = config.fetchFn ?? fetch;
  const now = config.now ?? Date.now;
  const scopes = config.scopes ?? DEFAULT_SCOPES;

  const basicAuth =
    "Basic " +
    Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

  function computeExpiresAt(expiresIn: number): Date {
    return new Date(now() + expiresIn * 1000);
  }

  function normalize(
    body: SpotifyTokenResponse,
    fallbackRefreshToken?: string,
  ): SpotifyTokenSet {
    const refreshToken = body.refresh_token ?? fallbackRefreshToken;
    if (!refreshToken) {
      throw new Error("Spotify token response had no refresh token");
    }
    return {
      accessToken: body.access_token,
      refreshToken,
      scope: body.scope,
      tokenType: body.token_type,
      expiresAt: computeExpiresAt(body.expires_in),
    };
  }

  async function postToken(
    params: Record<string, string>,
    fallbackRefreshToken?: string,
  ): Promise<SpotifyTokenSet> {
    const res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: basicAuth,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // OAuth 2.0 spells a dead grant `invalid_grant` (RFC 6749 §5.2) — a
      // revoked or rotated-out refresh token. Retrying cannot fix it; only the
      // user re-consenting can, so it gets its own type.
      if (isInvalidGrant(detail)) {
        throw new ReauthRequiredError(detail);
      }
      throw new Error(
        `Spotify token request failed (${res.status}): ${detail}`,
      );
    }
    return normalize(
      (await res.json()) as SpotifyTokenResponse,
      fallbackRefreshToken,
    );
  }

  return {
    generateState() {
      return randomBytes(16).toString("hex");
    },

    buildAuthorizeUrl(state: string) {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: scopes.join(" "),
        state,
      });
      return `${AUTHORIZE_URL}?${params.toString()}`;
    },

    exchangeCode(code: string) {
      return postToken({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
      });
    },

    refreshAccessToken(refreshToken: string) {
      // Spotify may omit refresh_token on refresh — keep the existing one.
      return postToken(
        { grant_type: "refresh_token", refresh_token: refreshToken },
        refreshToken,
      );
    },

    async fetchProfile(accessToken: string) {
      const res = await fetchFn(PROFILE_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `Spotify profile request failed (${res.status}): ${detail}`,
        );
      }
      const body = (await res.json()) as {
        id: string;
        display_name?: string | null;
        email?: string | null;
      };
      return {
        spotifyUserId: body.id,
        displayName: body.display_name ?? null,
        email: body.email ?? null,
      };
    },
  };
}
