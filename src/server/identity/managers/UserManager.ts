import { requireEnv } from "@/server/shared/env";
import { createSessionToken } from "@/server/shared/session";

import { createAuthEngine, type AuthEngine } from "../engines/AuthEngine";
import {
  createTokenResource,
  type TokenResource,
} from "../resources/TokenResource";
import {
  createUserResource,
  type UserResource,
} from "../resources/UserResource";

// UserManager — orchestrates the Identity use cases (brief §4). It owns the
// coordination/sequencing ("validate state, then exchange, then store, then
// mint a session"); the business logic lives in AuthEngine and persistence in
// the Resources. Cookies are HTTP transport and stay in the route handlers —
// the manager only *mints* the session token.

export interface BeginLoginResult {
  authorizeUrl: string;
  state: string;
}

export interface CallbackInput {
  code: string;
  /** `state` query param returned by Spotify. */
  state: string;
  /** `state` value we stashed in the short-lived cookie at login. */
  storedState: string | undefined;
}

export interface CallbackResult {
  userId: string;
  sessionToken: string;
}

export interface UserManager {
  beginLogin(): BeginLoginResult;
  handleCallback(input: CallbackInput): Promise<CallbackResult>;
  getFreshAccessToken(userId: string): Promise<string>;
}

export interface UserManagerDeps {
  authEngine: AuthEngine;
  userResource: UserResource;
  tokenResource: TokenResource;
  /** Injectable for tests; defaults to the real signed-JWT minter. */
  createSession?: (userId: string) => Promise<string>;
  now?: () => number;
  /** Refresh the access token when it expires within this many ms. */
  refreshSkewMs?: number;
}

export class OAuthStateMismatchError extends Error {
  constructor() {
    super("OAuth state mismatch");
    this.name = "OAuthStateMismatchError";
  }
}

export class MissingTokensError extends Error {
  constructor(userId: string) {
    super(`No stored Spotify tokens for user ${userId}`);
    this.name = "MissingTokensError";
  }
}

export function makeUserManager(deps: UserManagerDeps): UserManager {
  const {
    authEngine,
    userResource,
    tokenResource,
    createSession = createSessionToken,
    now = Date.now,
    refreshSkewMs = 60_000,
  } = deps;

  return {
    beginLogin() {
      const state = authEngine.generateState();
      return { authorizeUrl: authEngine.buildAuthorizeUrl(state), state };
    },

    async handleCallback({ code, state, storedState }) {
      // CSRF defense: the state echoed back by Spotify must match the one we
      // set in the cookie at login. Reject before spending a token exchange.
      if (!storedState || state !== storedState) {
        throw new OAuthStateMismatchError();
      }

      const tokens = await authEngine.exchangeCode(code);
      const profile = await authEngine.fetchProfile(tokens.accessToken);

      const user = await userResource.upsertBySpotifyId({
        spotifyUserId: profile.spotifyUserId,
        displayName: profile.displayName,
        email: profile.email,
      });
      await tokenResource.save(user.id, tokens);

      const sessionToken = await createSession(user.id);
      return { userId: user.id, sessionToken };
    },

    async getFreshAccessToken(userId) {
      const stored = await tokenResource.get(userId);
      if (!stored) throw new MissingTokensError(userId);

      const stillValid = stored.expiresAt.getTime() - now() > refreshSkewMs;
      if (stillValid) return stored.accessToken;

      const refreshed = await authEngine.refreshAccessToken(
        stored.refreshToken,
      );
      await tokenResource.save(userId, refreshed);
      return refreshed.accessToken;
    },
  };
}

/**
 * Wire a UserManager from environment configuration. Lazy by design — env is
 * read when this is called (per request), never at module import, so
 * `next build` does not require Spotify credentials.
 */
export function createUserManager(): UserManager {
  const authEngine = createAuthEngine({
    clientId: requireEnv("SPOTIFY_CLIENT_ID"),
    clientSecret: requireEnv("SPOTIFY_CLIENT_SECRET"),
    redirectUri: requireEnv("SPOTIFY_REDIRECT_URI"),
  });
  return makeUserManager({
    authEngine,
    userResource: createUserResource(),
    tokenResource: createTokenResource(),
  });
}
