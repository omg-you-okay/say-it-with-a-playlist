import { requireEnv } from "@/server/shared/env";
import { createSessionToken } from "@/server/shared/session";

import {
  createAuthEngine,
  ReauthRequiredError,
  type AuthEngine,
  type SpotifyTokenSet,
} from "../engines/AuthEngine";
import {
  createTokenResource,
  type StoredTokens,
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

/**
 * What Identity will say about a user to anyone who asks. Deliberately narrower
 * than the resource's `AppUser` — the email and the Spotify id are Identity's
 * business, and nothing outside it has a reason to see them.
 */
export interface UserProfile {
  id: string;
  displayName: string | null;
}

export interface UserManager {
  beginLogin(): BeginLoginResult;
  handleCallback(input: CallbackInput): Promise<CallbackResult>;
  getFreshAccessToken(userId: string): Promise<string>;
  /** The signed-in user's public-facing details, or null if the id is unknown. */
  getProfile(userId: string): Promise<UserProfile | null>;
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

// Identity's two ways of saying "this user has to log in again" — no tokens at
// all, and a grant Spotify has rejected for good. The Manager is the subsystem's
// public front door (ADR 0009), so callers outside Identity — which may not
// reach past it to an Engine — get the re-auth type from here.
export { ReauthRequiredError };

// The engine's token shape and the resource's stored shape are deliberately
// separate types (ADR 0008). Map field-by-field so drift in either shape is a
// compile error here, not a silent structural coincidence.
function toStoredTokens(tokens: SpotifyTokenSet): StoredTokens {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    scope: tokens.scope,
    tokenType: tokens.tokenType,
    expiresAt: tokens.expiresAt,
  };
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
      await tokenResource.save(user.id, toStoredTokens(tokens));

      const sessionToken = await createSession(user.id);
      return { userId: user.id, sessionToken };
    },

    async getProfile(userId) {
      const user = await userResource.findById(userId);
      if (!user) return null;
      return { id: user.id, displayName: user.displayName };
    },

    async getFreshAccessToken(userId) {
      const isFresh = (tokens: StoredTokens) =>
        tokens.expiresAt.getTime() - now() > refreshSkewMs;

      // Fast path: the token is almost always still good, so read it without
      // paying for a lock.
      const stored = await tokenResource.get(userId);
      if (!stored) throw new MissingTokensError(userId);
      if (isFresh(stored)) return stored.accessToken;

      // Slow path. Refreshing is read-then-write and Spotify may rotate the
      // refresh token as it goes, so two callers racing here can each refresh
      // with the same token and the loser can write a dead one over the
      // winner's live one — logging the user out permanently. Serialize the
      // refresh so exactly one caller performs it (ADR 0017).
      return tokenResource.withLockedTokens(
        userId,
        async ({ tokens, save }) => {
          if (!tokens) throw new MissingTokensError(userId);
          // Re-check under the lock: whoever we queued behind may already have
          // refreshed, in which case there is nothing left to do but use theirs.
          if (isFresh(tokens)) return tokens.accessToken;

          const refreshed = await authEngine.refreshAccessToken(
            tokens.refreshToken,
          );
          await save(toStoredTokens(refreshed));
          return refreshed.accessToken;
        },
      );
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
